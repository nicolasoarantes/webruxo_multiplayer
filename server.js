// server.js
// Protótipo Tower Defense multiplayer cooperativo com Node.js e Socket.io
// Permite até 3 jogadores defendendo uma base central contra waves de inimigos

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Estrutura de dados para partidas (salas)
const rooms = {};
const MAX_PLAYERS = 3;
let WAVE_INTERVAL = 20000; // 20 segundos entre waves
let GAME_SPEED = 1; // 1x normal, 2x acelerado
const ENEMIES_PER_WAVE_BASE = 5;
const MAX_WAVES = 10;
const BASE_INITIAL_HP = 100;
const BASE_INITIAL_RESOURCES = 500;
const ENEMY_TYPES = [
    { type: 'basic', hp: 30, speed: 0.018, damage: 10, reward: 10 },
    { type: 'fast', hp: 15, speed: 0.035, damage: 7, reward: 12 },
    { type: 'tank', hp: 60, speed: 0.012, damage: 20, reward: 20 },
];

// Formas visuais possíveis para os inimigos
const ENEMY_SHAPES = ['sphere', 'cube', 'pyramid'];

// Gera caminho individual para cada inimigo
function generatePath() {
    return [
        { x: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10 },
        { x: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 },
        { x: 0, z: 0 }, // base
    ];
}

// Função utilitária para gerar posição inicial dos inimigos
function getEnemySpawnPosition(typeObj) {
    // Spawna em volta do mapa
    const angle = Math.random() * Math.PI * 2;
    const radius = 15 + Math.random() * 5;
    return {
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        path: generatePath(),
        waypointIndex: 0,
        hp: typeObj.hp,
        maxHp: typeObj.hp,
        speed: typeObj.speed,
        type: typeObj.type,
        shape: ENEMY_SHAPES[Math.floor(Math.random() * ENEMY_SHAPES.length)],
        damage: typeObj.damage,
        reward: typeObj.reward,
        id: Math.random().toString(36).substr(2, 9),
    };
}

// Função para criar uma nova sala
function createRoom(roomId) {
    rooms[roomId] = {
        players: {},
        enemies: [],
        wave: 0,
        lastWaveTime: Date.now(),
        baseHp: BASE_INITIAL_HP,
        resources: BASE_INITIAL_RESOURCES,
        score: 0,
        events: [],
        gameOver: false,
        victory: false,
        intervalActive: true,
        intervalEnd: Date.now() + WAVE_INTERVAL,
        towers: [], // [{x, z, type, level, id}]
    };
}

// Função para spawnar uma wave de inimigos
function spawnWave(room) {
    // Aumenta dificuldade progressivamente
    const waveNum = room.wave + 1;
    const numEnemies = ENEMIES_PER_WAVE_BASE + Math.floor(waveNum * 1.5);
    for (let i = 0; i < numEnemies; i++) {
        // Sorteia tipo de inimigo conforme wave
        let typeObj;
        if (waveNum < 3) typeObj = ENEMY_TYPES[0];
        else if (waveNum < 6) typeObj = ENEMY_TYPES[Math.random() < 0.7 ? 0 : 1];
        else typeObj = ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)];
        room.enemies.push(getEnemySpawnPosition(typeObj));
    }
    room.wave++;
    room.lastWaveTime = Date.now();
    room.intervalActive = false;
    room.events.push({ type: 'wave', wave: room.wave });
}

// Lógica de movimentação dos inimigos
function updateEnemies(room) {
    for (const enemy of room.enemies) {
        const wp = enemy.path[enemy.waypointIndex];
        if (!wp) continue;
        const dx = wp.x - enemy.x;
        const dz = wp.z - enemy.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 0.2) {
            if (enemy.waypointIndex < enemy.path.length - 1) {
                enemy.waypointIndex++;
            } else {
                // Chegou na base
                room.baseHp -= enemy.damage;
                enemy.hp = 0;
                room.events.push({ type: 'enemy_reached', id: enemy.id, damage: enemy.damage });
            }
        } else {
            // Move em direção ao waypoint
            enemy.x += (dx / dist) * enemy.speed;
            enemy.z += (dz / dist) * enemy.speed;
        }
    }
    // Remove inimigos mortos
    room.enemies = room.enemies.filter(e => e.hp > 0);
}

// Atualização do estado do jogo e envio para os clientes
setInterval(() => {
    for (const [roomId, room] of Object.entries(rooms)) {
        if (room.gameOver || room.victory) continue;
        // Intervalo entre waves
        if (room.intervalActive) {
            if (Date.now() > room.intervalEnd) {
                spawnWave(room);
            }
        } else {
            // Acelera lógica se GAME_SPEED > 1
            for (let s = 0; s < GAME_SPEED; s++) {
                updateEnemies(room);
                // Lógica de torres: atacar inimigos próximos
                for (const tower of room.towers) {
                    // Torre atira no inimigo mais próximo dentro do alcance
                    const range = 5 + tower.level * 1.5;
                    let target = null, minDist = 9999;
                    for (const enemy of room.enemies) {
                        const dx = tower.x - enemy.x;
                        const dz = tower.z - enemy.z;
                        const dist = Math.sqrt(dx * dx + dz * dz);
                        if (dist < range && dist < minDist) {
                            minDist = dist;
                            target = enemy;
                        }
                    }
                    if (target) {
                        // Dano depende do tipo e nível
                        let dmg = 8 + tower.level * 4;
                        if (tower.type === 'cannon') dmg += 6;
                        if (tower.type === 'magic') dmg = 5 + tower.level * 3;
                        target.hp -= dmg;
                        // Evento de hit para feedback visual
                        room.events.push({ type: 'enemy_hit', id: target.id, dmg });
                        if (target.hp <= 0) {
                            room.resources += target.reward;
                            room.score += target.reward;
                            room.events.push({ type: 'enemy_killed', id: target.id, reward: target.reward });
                        }
                    }
                }
                // Remove inimigos mortos
                room.enemies = room.enemies.filter(e => e.hp > 0);
                // Fim de wave
                if (room.enemies.length === 0) {
                    if (room.wave >= MAX_WAVES) {
                        room.victory = true;
                        room.events.push({ type: 'victory' });
                    } else {
                        room.intervalActive = true;
                        room.intervalEnd = Date.now() + WAVE_INTERVAL / GAME_SPEED;
                        room.events.push({ type: 'interval', until: room.intervalEnd });
                    }
                }
            }
        }
        // Fim de jogo
        if (room.baseHp <= 0 && !room.gameOver) {
            room.gameOver = true;
            room.events.push({ type: 'game_over' });
        }
        // Envia update para todos os jogadores da sala
        io.to(roomId).emit('game_update', {
            enemies: room.enemies,
            baseHp: room.baseHp,
            wave: room.wave,
            events: room.events,
            resources: room.resources,
            score: room.score,
            intervalActive: room.intervalActive,
            intervalEnd: room.intervalEnd,
            towers: room.towers,
            gameOver: room.gameOver,
            victory: room.victory,
        });
        // Limpa eventos já enviados
        room.events = [];
    }
}, 50); // 20 FPS

// Gerenciamento de conexões Socket.io
io.on('connection', (socket) => {
    // Permite acelerar/desacelerar o tempo de jogo por cliente
    socket.on('speed_toggle', (data) => {
        GAME_SPEED = data.fast ? 2 : 1;
    });
    let joinedRoom = null;
    // Encontrar ou criar sala com vaga
    for (const [roomId, room] of Object.entries(rooms)) {
        if (Object.keys(room.players).length < MAX_PLAYERS) {
            joinedRoom = roomId;
            break;
        }
    }
    if (!joinedRoom) {
        joinedRoom = 'room_' + Math.random().toString(36).substr(2, 6);
        createRoom(joinedRoom);
    }
    socket.join(joinedRoom);
    rooms[joinedRoom].players[socket.id] = { towers: [] };
    // Envia info inicial
    socket.emit('joined', { roomId: joinedRoom, playerId: socket.id });

    // Evento de criação de torre
    socket.on('place_tower', (data) => {
        // data: { x, z, type }
        const room = rooms[joinedRoom];
        if (!room || room.intervalActive !== true) return; // só pode construir entre waves
        // Custo por tipo
        const towerTypes = { archer: 100, cannon: 150, magic: 120 };
        const cost = towerTypes[data.type] || 100;
        if (room.resources < cost) return;
        room.resources -= cost;
        const tower = { x: data.x, z: data.z, type: data.type, level: 1, id: Math.random().toString(36).substr(2, 8) };
        room.towers.push(tower);
        room.events.push({ type: 'tower', playerId: socket.id, ...tower });
    });

    // Evento de upgrade de torre
    socket.on('upgrade_tower', (data) => {
        // data: { id }
        const room = rooms[joinedRoom];
        if (!room || room.intervalActive !== true) return;
        const tower = room.towers.find(t => t.id === data.id);
        if (!tower || tower.level >= 3) return;
        const upgradeCost = 80 + tower.level * 60;
        if (room.resources < upgradeCost) return;
        room.resources -= upgradeCost;
        tower.level++;
        room.events.push({ type: 'tower_upgrade', id: tower.id, level: tower.level });
    });

    socket.on('disconnect', () => {
        if (joinedRoom && rooms[joinedRoom]) {
            delete rooms[joinedRoom].players[socket.id];
            // Remove sala se vazia
            if (Object.keys(rooms[joinedRoom].players).length === 0) {
                delete rooms[joinedRoom];
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});

// main.js
// Cliente Three.js + Socket.io para protótipo Tower Defense multiplayer

// === Configuração básica Three.js ===
const canvas = document.getElementById('gameCanvas');
const mainMenu = document.getElementById('mainMenu');
const playBtn = document.getElementById('playBtn');
const speedToggle = document.getElementById('speedToggle');
const optionsMenu = document.getElementById('optionsMenu');
const restartBtn = document.getElementById('restartBtn');
const toggleSpeedBtn = document.getElementById('toggleSpeedBtn');
const closeMenuBtn = document.getElementById('closeMenuBtn');
const infoDiv = document.getElementById('info');
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setSize(window.innerWidth, window.innerHeight);

// Menu inicial: só mostra o jogo após clicar em Jogar
playBtn.onclick = () => {
    mainMenu.style.display = 'none';
    canvas.style.display = '';
    infoDiv.style.display = '';
    towerBar.style.display = '';
    statusBar.style.display = '';
};

// Opções de menu em jogo
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        optionsMenu.style.display = optionsMenu.style.display === 'flex' ? 'none' : 'flex';
    }
});
restartBtn.onclick = () => { location.reload(); };
toggleSpeedBtn.onclick = () => {
    speedToggle.checked = !speedToggle.checked;
    socket.emit('speed_toggle', { fast: speedToggle.checked });
};
closeMenuBtn.onclick = () => { optionsMenu.style.display = 'none'; };
// Esconde UI do jogo até clicar em Jogar
canvas.style.display = 'none';
infoDiv.style.display = 'none';
let towerBar, statusBar;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e2438)// Fundo com estrelas
const starGeo = new THREE.BufferGeometry();
const starVerts = [];
for (let i = 0; i < 1000; i++) {
    starVerts.push((Math.random() - 0.5) * 200, 20 + Math.random() * 80, (Math.random() - 0.5) * 200);
}
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.7 });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);


// Câmera perspectiva
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 18, 18);
camera.lookAt(0, 0, 0);

// Luz ambiente
scene.add(new THREE.AmbientLight(0xffffff, 0.7));

// Chão simples
const groundGeo = new THREE.PlaneGeometry(40, 40);
const groundMat = new THREE.MeshPhongMaterial({ color: 0x353a50 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const gridHelper = new THREE.GridHelper(40, 40, 0x444477, 0x444477);
scene.add(gridHelper);

// Caminhos no chão
const pathMat = new THREE.MeshPhongMaterial({ color: 0x555555 });
const cross1 = new THREE.Mesh(new THREE.BoxGeometry(28, 0.05, 4), pathMat);
cross1.position.y = 0.025;
scene.add(cross1);
const cross2 = cross1.clone();
cross2.rotation.y = Math.PI / 2;
scene.add(cross2);


// Base central
const baseGeo = new THREE.CylinderGeometry(1.5, 1.5, 1, 32);
const baseMat = new THREE.MeshPhongMaterial({ color: 0xffcc00 });
const base = new THREE.Mesh(baseGeo, baseMat);
base.position.set(0, 0.5, 0);
scene.add(base);
const ringGeo = new THREE.RingGeometry(3, 3.8, 32);
const ringMat = new THREE.MeshPhongMaterial({ color: 0x666666, side: THREE.DoubleSide });
const ring = new THREE.Mesh(ringGeo, ringMat);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.051;
scene.add(ring);

// === Socket.io ===
const socket = io();
let playerId = null;
let roomId = null;
let enemies = [];
let baseHp = 1000;
let wave = 0;
let towers = [];

// Mapas para objetos Three.js
const enemyMeshes = [];
const enemyHpBars = [];
const enemyDmgTexts = [];
const enemyHitFlashes = [];
const hitParticles = [];
// Atualização dos efeitos de hit
function updateHitEffects() {
    // Flashes de hit
    for (const flash of enemyHitFlashes) {
        flash.mesh.material.opacity -= 0.08;
        if (flash.mesh.material.opacity <= 0) scene.remove(flash.mesh);
    }
    for (let i = enemyHitFlashes.length-1; i >= 0; i--) {
        if (enemyHitFlashes[i].mesh.material.opacity <= 0) enemyHitFlashes.splice(i,1);
    }
    // Partículas de impacto
    for (const p of hitParticles) {
        p.mesh.position.add(p.dir.clone().multiplyScalar(p.speed));
        p.mesh.material.opacity -= 0.07;
        if (p.mesh.material.opacity <= 0) scene.remove(p.mesh);
    }
    for (let i = hitParticles.length-1; i >= 0; i--) {
        if (hitParticles[i].mesh.material.opacity <= 0) hitParticles.splice(i,1);
    }
}
const towerMeshes = [];
const shotParticles = [];
const shotTrails = [];

// Info UI moderna (barra superior)
infoDiv.style.position = 'absolute';
infoDiv.style.top = '2vh';
infoDiv.style.left = '50%';
infoDiv.style.transform = 'translateX(-50%)';
infoDiv.style.background = 'rgba(30,30,40,0.92)';
infoDiv.style.padding = '12px 32px';
infoDiv.style.borderRadius = '14px';
infoDiv.style.color = '#fff';
infoDiv.style.fontSize = '1.25em';
infoDiv.style.fontFamily = 'Segoe UI, Arial, sans-serif';
infoDiv.style.fontWeight = 'bold';
infoDiv.style.letterSpacing = '1px';
infoDiv.style.zIndex = 30;
infoDiv.style.boxShadow = '0 2px 16px #0008';

// UI para seleção de tipo de torre
let selectedTowerType = 'crystal';
const towerTypes = {
    crystal: { 
        name: 'Cristal Arcano', 
        color: 0x00ccff, 
        cost: 100,
        description: 'Dispara rajadas de energia arcana. Ataque equilibrado e confiável.',
        range: 8,
        damage: '10-15',
        rate: 'Rápido'
    },
    elemental: { 
        name: 'Elemental', 
        color: 0xff8800, 
        cost: 150,
        description: 'Alterna entre elementos para causar dano extra. Mais forte contra Golems.',
        range: 6,
        damage: '20-25',
        rate: 'Médio'
    },
    portal: { 
        name: 'Portal Rúnico', 
        color: 0x9933ff, 
        cost: 120,
        description: 'Cria armadilhas mágicas que retardam inimigos. Escala bem com melhorias.',
        range: 5,
        damage: '8-20',
        rate: 'Lento'
    },
};

// Cria barra de seleção de torres (UI moderna)
towerBar = document.createElement('div');
towerBar.style.position = 'absolute';
towerBar.style.right = '2vw';
towerBar.style.top = '70px';
towerBar.style.background = 'rgba(30,30,40,0.92)';
towerBar.style.padding = '10px';
towerBar.style.borderRadius = '12px';
towerBar.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
towerBar.style.display = 'none';

// Adiciona botões de torre com tooltips
for (const t in towerTypes) {
    const tower = towerTypes[t];
    const btn = document.createElement('button');
    btn.textContent = `${tower.name} ($${tower.cost})`;
    btn.style.display = 'block';
    btn.style.width = '180px';
    btn.style.padding = '8px';
    btn.style.margin = '5px 0';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.background = '#222';
    btn.style.color = '#bbb';
    btn.style.cursor = 'pointer';
    btn.style.transition = 'all 0.2s ease';
    btn.style.position = 'relative';

    // Tooltip customizado
    const tooltip = document.createElement('div');
    tooltip.style.position = 'absolute';
    tooltip.style.right = 'calc(100% + 10px)';
    tooltip.style.top = '50%';
    tooltip.style.transform = 'translateY(-50%)';
    tooltip.style.background = 'rgba(20,20,30,0.95)';
    tooltip.style.padding = '10px';
    tooltip.style.borderRadius = '8px';
    tooltip.style.width = '200px';
    tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    tooltip.style.display = 'none';
    tooltip.style.zIndex = '1000';
    tooltip.innerHTML = `
        <div style="color:#fff;font-weight:bold;margin-bottom:5px">${tower.name}</div>
        <div style="color:#aaa;font-size:0.9em;margin-bottom:8px">${tower.description}</div>
        <div style="color:#88ccff">Alcance: ${tower.range}</div>
        <div style="color:#ffaa88">Dano: ${tower.damage}</div>
        <div style="color:#88ff88">Velocidade: ${tower.rate}</div>
    `;
    btn.appendChild(tooltip);

    btn.onmouseover = () => { tooltip.style.display = 'block'; };
    btn.onmouseout = () => { tooltip.style.display = 'none'; };
    btn.onclick = () => { 
        selectedTowerType = t; 
        highlightTowerButtons();
        showTowerRange(t);
    };
    towerBar.appendChild(btn);
}
document.body.appendChild(towerBar);
function highlightTowerButtons() {
    for (const t in towerTypes) {
        const btn = document.getElementById('btn-tower-' + t);
        btn.style.background = (selectedTowerType === t) ? 'linear-gradient(90deg,#44c,#66e)' : '#222';
        btn.style.color = (selectedTowerType === t) ? '#fff' : '#bbb';
        btn.style.boxShadow = (selectedTowerType === t) ? '0 0 8px #44c8' : '';
        btn.style.transform = (selectedTowerType === t) ? 'scale(1.08)' : 'scale(1)';
    }
}
highlightTowerButtons();

// Barra inferior para status de wave/intervalo (UI moderna)
statusBar = document.createElement('div');
statusBar.style.position = 'absolute';
statusBar.style.left = '50%';
statusBar.style.transform = 'translateX(-50%)';
statusBar.style.top = '20px';
statusBar.style.background = 'rgba(30,30,40,0.92)';
statusBar.style.padding = '10px 20px';
statusBar.style.borderRadius = '12px';
statusBar.style.color = '#fff';
statusBar.style.display = 'none';
statusBar.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
statusBar.style.display = 'flex';
statusBar.style.gap = '20px';
statusBar.style.alignItems = 'center';
statusBar.innerHTML = `
    <div>
        <span style="color:#ffcc00">Base HP: </span>
        <span id="baseHp">100</span>
    </div>
    <div>
        <span style="color:#88ff88">Recursos: </span>
        <span id="resources">500</span>
    </div>
    <div>
        <span style="color:#ff88ff">Wave: </span>
        <span id="wave">0</span>
    </div>
    <div style="position:relative">
        <span style="color:#88ccff">Próxima Wave: </span>
        <span id="waveCountdown"></span>
        <div id="waveProgress" style="position:absolute;bottom:-5px;left:0;height:2px;background:#88ccff;width:100%"></div>
    </div>
`;
document.body.appendChild(statusBar);

// Atualização do status com animações
function updateStatus(gameState) {
    const baseHpEl = document.getElementById('baseHp');
    const resourcesEl = document.getElementById('resources');
    const waveEl = document.getElementById('wave');
    const waveCountdownEl = document.getElementById('waveCountdown');
    const waveProgressEl = document.getElementById('waveProgress');

    // Animate HP changes
    if (baseHpEl.textContent !== gameState.baseHp.toString()) {
        const oldHp = parseInt(baseHpEl.textContent);
        const newHp = gameState.baseHp;
        if (oldHp > newHp) {
            baseHpEl.style.color = '#ff4444';
            setTimeout(() => { baseHpEl.style.color = '#fff'; }, 500);
        }
        baseHpEl.textContent = newHp;
    }

    // Animate resource changes
    if (resourcesEl.textContent !== gameState.resources.toString()) {
        const oldRes = parseInt(resourcesEl.textContent);
        const newRes = gameState.resources;
        if (oldRes < newRes) {
            resourcesEl.style.color = '#88ff88';
            setTimeout(() => { resourcesEl.style.color = '#fff'; }, 500);
        }
        resourcesEl.textContent = newRes;
    }

    // Update wave info
    waveEl.textContent = gameState.wave;
    
    // Wave countdown
    const timeToNext = Math.max(0, Math.floor((gameState.intervalEnd - Date.now()) / 1000));
    waveCountdownEl.textContent = timeToNext + 's';
    const progress = Math.max(0, Math.min(1, timeToNext / (WAVE_INTERVAL / 1000)));
    waveProgressEl.style.width = (progress * 100) + '%';
    
    if (timeToNext <= 5) {
        waveCountdownEl.style.color = '#ff4444';
    } else {
        waveCountdownEl.style.color = '#fff';
    }
}

// Acelerar tempo: envia evento ao servidor
speedToggle.onchange = () => {
    socket.emit('speed_toggle', { fast: speedToggle.checked });
};

// Recebe confirmação de entrada na sala
socket.on('joined', (data) => {
    playerId = data.playerId;
    roomId = data.roomId;
    infoDiv.textContent = `Sala: ${roomId} | Jogador: ${playerId}`;
});

// Recebe updates do servidor
let resources = 0;
let score = 0;
let intervalActive = false;
let intervalEnd = 0;
let gameOver = false;
let victory = false;

socket.on('game_update', (data) => {
    enemies = data.enemies;
    baseHp = data.baseHp;
    wave = data.wave;
    resources = data.resources;
    score = data.score;
    intervalActive = data.intervalActive;
    intervalEnd = data.intervalEnd;
    towers = data.towers || [];
    gameOver = data.gameOver;
    victory = data.victory;
    // Eventos: novas torres, upgrades, etc
    if (data.events) {
        for (const ev of data.events) {
            if (ev.type === 'tower') {
                addTower(ev);
            }
            if (ev.type === 'tower_upgrade') {
                upgradeTowerVisual(ev.id, ev.level);
            }
        }
    }
});

// Função para adicionar torre na cena
function addTower(tower) {
    // tower: {x, z, type, level, id}
    const color = towerTypes[tower.type]?.color || 0x00ccff;
    const geo = new THREE.CylinderGeometry(0.5 + 0.2 * (tower.level-1), 0.5, 2 + tower.level, 16);
    const mat = new THREE.MeshPhongMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(tower.x, 1, tower.z);
    mesh.userData = { id: tower.id, type: tower.type, level: tower.level };
    scene.add(mesh);
    towerMeshes.push(mesh);
}

function upgradeTowerVisual(id, level) {
    for (const mesh of towerMeshes) {
        if (mesh.userData && mesh.userData.id === id) {
            mesh.scale.y = 1 + 0.3 * (level-1);
            mesh.material.color.setHex(towerTypes[mesh.userData.type]?.color || 0x00ccff);
            mesh.userData.level = level;
        }
    }
}

// Clique para criar torre OU selecionar torre para upgrade
canvas.addEventListener('click', (event) => {
    if (gameOver || victory) return;
    // Converte coordenadas do clique para mundo
    const mouse = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: -(event.clientY / window.innerHeight) * 2 + 1,
    };
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    // Primeiro: verifica se clicou em torre para upgrade
    const towerHits = raycaster.intersectObjects(towerMeshes);
    if (towerHits.length > 0) {
        const mesh = towerHits[0].object;
        if (mesh.userData && mesh.userData.level < 3 && intervalActive) {
            socket.emit('upgrade_tower', { id: mesh.userData.id });
        }
        return;
    }
    // Segundo: verifica se clicou no chão para construir
    const intersects = raycaster.intersectObject(ground);
    if (intersects.length > 0 && intervalActive) {
        const point = intersects[0].point;
        socket.emit('place_tower', { x: point.x, z: point.z, type: selectedTowerType });
    }
});

// Função para atualizar inimigos na cena
function updateEnemies() {
    // Remove meshes antigos
    for (const mesh of enemyMeshes) scene.remove(mesh);
    for (const bar of enemyHpBars) scene.remove(bar);
    for (const txt of enemyDmgTexts) scene.remove(txt.mesh);
    enemyMeshes.length = 0;
    enemyHpBars.length = 0;
    // Adiciona novos
    for (const enemy of enemies) {
        // Variação visual: cor e tamanho aleatório por id
        let color = 0xff3333;        if (enemy.type === 'sombra') color = 0x33ff99;
        if (enemy.type === 'wisp') color = 0x88ffff;
        if (enemy.type === 'golem') color = 0x888888;
        // Variação: cor levemente alterada por id
        if (enemy.id) {
            color += parseInt(enemy.id.substr(-2), 36) * 1000 % 0x10000;
        }
        const scale = 0.6 + (enemy.type === 'golem' ? 0.3 : (enemy.type === 'sombra' ? -0.2 : 0)) + ((enemy.id ? parseInt(enemy.id[0],36)%3 : 0)*0.07);
        let geo;
        if (enemy.shape === 'cube') geo = new THREE.BoxGeometry(scale*1.2, scale*1.2, scale*1.2);
        else if (enemy.shape === 'pyramid') geo = new THREE.ConeGeometry(scale, scale*1.6, 4);
        else geo = new THREE.SphereGeometry(scale, 12, 12);
        const mat = new THREE.MeshPhongMaterial({ color });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(enemy.x, scale, enemy.z);
        scene.add(mesh);
        enemyMeshes.push(mesh);
        // Barra de vida
        const hpPerc = Math.max(0, enemy.hp/enemy.maxHp);
        const barGeo = new THREE.PlaneGeometry(1.2, 0.13);
        const barMat = new THREE.MeshBasicMaterial({ color: 0x22ff22, transparent: true });
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.position.set(enemy.x, scale*2+0.2, enemy.z);
        bar.scale.x = hpPerc;
        scene.add(bar);
        enemyHpBars.push(bar);
    }
    // Dano flutuante
    for (const txt of enemyDmgTexts) {
        txt.mesh.position.y += 0.03;
        txt.life -= 1;
        if (txt.life <= 0) {
            scene.remove(txt.mesh);
        }
    }
    for (let i = enemyDmgTexts.length-1; i >= 0; i--) {
        if (enemyDmgTexts[i].life <= 0) enemyDmgTexts.splice(i,1);
    }
    // Partículas de tiro
    for (const p of shotParticles) {
        p.mesh.position.add(p.dir.clone().multiplyScalar(p.speed));
        p.life--;
        if (p.life <= 0) scene.remove(p.mesh);
    }
    for (let i = shotParticles.length-1; i >= 0; i--) {
        if (shotParticles[i].life <= 0) shotParticles.splice(i,1);
    }
    // Trilhas de tiro
    for (const t of shotTrails) {
        t.mesh.material.opacity -= 0.1;
        if (t.mesh.material.opacity <= 0) scene.remove(t.mesh);
    }
    for (let i = shotTrails.length-1; i >= 0; i--) {
        if (shotTrails[i].mesh.material.opacity <= 0) shotTrails.splice(i,1);
    }
}

// Loop de renderização
function animate() {
    requestAnimationFrame(animate);
    // Remove torres antigas e redesenha todas
    for (const mesh of towerMeshes) scene.remove(mesh);
    towerMeshes.length = 0;
    for (const t of towers) addTower(t);
    updateEnemies();
    updateHitEffects();
    // Atualiza UI
    let status = '';
    if (gameOver) status = '<span style="color:#f44">GAME OVER</span>';
    else if (victory) status = '<span style="color:#4f4">VITÓRIA!</span>';
    else if (intervalActive) {
        const secs = Math.max(0, Math.floor((intervalEnd - Date.now())/1000));
        status = `Intervalo: próxima wave em ${secs}s`;
    } else {
        status = 'Defenda a base!';
    }
    infoDiv.innerHTML = `
        <span style="font-size:1.1em;">🌊 Wave <b>${wave}</b> / 10</span>
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <span style="color:#ffb300;font-size:1.1em;">❤️ Base: <b>${baseHp}</b></span>
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <span style="color:#3fdc7a;font-size:1.1em;">💰 Recursos: <b>${resources}</b></span>
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <span style="color:#6cf;font-size:1.1em;">⭐ Pontos: <b>${score}</b></span>
    `;
    statusBar.innerHTML = status;
    renderer.render(scene, camera);
}
animate();

// === Efeitos visuais de tiro e dano ===
socket.on('game_update', (data) => {
    // ...existing code...
    if (data.events) {
        for (const ev of data.events) {
            if (ev.type === 'tower') {
                addTower(ev);
            }
            if (ev.type === 'tower_upgrade') {
                upgradeTowerVisual(ev.id, ev.level);
            }
            if (ev.type === 'enemy_killed' && ev.id && ev.reward) {
                // Dano flutuante verde GRANDE
                const mesh = createTextMesh('+'+ev.reward, 0x22ff22, 2.2);
                const enemy = enemies.find(e=>e.id===ev.id);
                if (enemy) {
                    mesh.position.set(enemy.x, 2.7, enemy.z);
                    scene.add(mesh);
                    enemyDmgTexts.push({mesh, life: 54});
                }
            }
            if (ev.type === 'enemy_reached' && ev.id && ev.damage) {
                // Dano flutuante vermelho GRANDE
                const mesh = createTextMesh('-'+ev.damage, 0xff2222, 2.2);
                const enemy = enemies.find(e=>e.id===ev.id);
                if (enemy) {
                    mesh.position.set(enemy.x, 2.7, enemy.z);
                    scene.add(mesh);
                    enemyDmgTexts.push({mesh, life: 54});
                }
            }
            if (ev.type === 'enemy_hit' && ev.id && ev.dmg) {
                // Flash branco no inimigo
                const enemy = enemies.find(e=>e.id===ev.id);
                if (enemy) {
                    const geo = new THREE.SphereGeometry(0.7, 10, 10);
                    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.7 });
                    const mesh = new THREE.Mesh(geo, mat);
                    mesh.position.set(enemy.x, 1.2, enemy.z);
                    scene.add(mesh);
                    enemyHitFlashes.push({mesh});
                    // Dano flutuante amarelo GRANDE
                    const txt = createTextMesh('-'+ev.dmg, 0xffff44, 1.5);
                    txt.position.set(enemy.x, 2.2, enemy.z);
                    scene.add(txt);
                    enemyDmgTexts.push({mesh:txt, life: 36});
                    // Partículas de impacto
                    for (let i=0;i<5;i++) {
                        const geo = new THREE.SphereGeometry(0.09, 6, 6);
                        const mat = new THREE.MeshBasicMaterial({ color: 0xffff44, transparent:true, opacity:0.8 });
                        const p = new THREE.Mesh(geo, mat);
                        p.position.set(enemy.x, 1.2, enemy.z);
                        scene.add(p);
                        const angle = Math.PI*2*i/5 + Math.random();
                        const dir = new THREE.Vector3(Math.cos(angle), 0.3+Math.random()*0.5, Math.sin(angle));
                        hitParticles.push({mesh:p, dir, speed:0.13+Math.random()*0.08});
                    }
                }
            }
        }
    }
    // Efeito de tiro: para cada torre, se houver inimigo próximo, cria partícula
    for (const t of towers) {
        let target = null, minDist = 9999;
        const range = 5 + t.level * 1.5;
        for (const e of enemies) {
            const dx = t.x - e.x;
            const dz = t.z - e.z;
            const dist = Math.sqrt(dx*dx+dz*dz);
            if (dist < range && dist < minDist) {
                minDist = dist;
                target = e;
            }
        }
        if (target && Math.random()<0.15) { // taxa de tiro visual
            const from = new THREE.Vector3(t.x, 2.2, t.z);
            const to = new THREE.Vector3(target.x, 1.2, target.z);
            const dir = to.clone().sub(from).normalize();
            const geo = new THREE.SphereGeometry(0.13, 8, 8);
            const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(from);
            scene.add(mesh);
            shotParticles.push({mesh, dir, speed:0.45, life:12});
            // Linha de trajetória
            const lineGeo = new THREE.BufferGeometry().setFromPoints([from, to]);
            const lineMat = new THREE.LineBasicMaterial({ color: 0xffee88, transparent:true, opacity:0.8 });
            const line = new THREE.Line(lineGeo, lineMat);
            scene.add(line);
            shotTrails.push({mesh: line});
        }
    }
});

// Função utilitária para texto 3D
function createTextMesh(text, color=0xffffff) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 32px Arial';
    ctx.fillStyle = '#000';
    ctx.fillRect(0,0,128,64);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 10, 42);
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, color });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.2,0.6,1);
    return sprite;
}

// Tower range indicator
let rangeIndicator = null;

function showTowerRange(towerType) {
    // Remove existing range indicator
    if (rangeIndicator) {
        scene.remove(rangeIndicator);
        rangeIndicator = null;
    }

    const range = towerTypes[towerType].range;
    const geometry = new THREE.RingGeometry(0, range, 32);
    const material = new THREE.MeshBasicMaterial({ 
        color: towerTypes[towerType].color,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide
    });
    rangeIndicator = new THREE.Mesh(geometry, material);
    rangeIndicator.rotation.x = -Math.PI / 2;
    rangeIndicator.position.y = 0.1;
    scene.add(rangeIndicator);
}

// Tower attack effects
function createAttackEffect(from, to, type) {
    const points = [];
    points.push(new THREE.Vector3(from.x, 1, from.z));
    
    // Add a slight arc to the attack
    const mid = new THREE.Vector3(
        (from.x + to.x) / 2,
        1.5 + Math.random(),
        (from.z + to.z) / 2
    );
    points.push(mid);
    points.push(new THREE.Vector3(to.x, 1, to.z));

    const curve = new THREE.QuadraticBezierCurve3(points[0], points[1], points[2]);
    const geometry = new THREE.TubeGeometry(curve, 20, 0.1, 8, false);
    
    let color;
    switch(type) {
        case 'crystal':
            color = 0x00ffff;
            break;
        case 'elemental':
            // Cycle between elements
            const elements = [0xff0000, 0x00ff00, 0x00ffff, 0xffff00];
            color = elements[Math.floor(Math.random() * elements.length)];
            break;
        case 'portal':
            color = 0xff00ff;
            break;
        default:
            color = 0xffffff;
    }

    const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.7
    });

    const effect = new THREE.Mesh(geometry, material);
    scene.add(effect);

    // Animate and remove
    const startTime = Date.now();
    const duration = 500;
    
    function animate() {
        const progress = (Date.now() - startTime) / duration;
        if (progress >= 1) {
            scene.remove(effect);
            effect.geometry.dispose();
            effect.material.dispose();
            return;
        }
        
        effect.material.opacity = 0.7 * (1 - progress);
        requestAnimationFrame(animate);
    }
    animate();
}

// === Movimentação de câmera (orbita e zoom) ===
let isDragging = false, lastX=0, lastY=0, theta=Math.PI/4, phi=1.1, radius=22;
canvas.addEventListener('mousedown', e=>{ isDragging=true; lastX=e.clientX; lastY=e.clientY; });
window.addEventListener('mouseup', ()=>{ isDragging=false; });
window.addEventListener('mousemove', e=>{
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    theta -= dx*0.01;
    phi -= dy*0.01;
    phi = Math.max(0.5, Math.min(1.5, phi));
    updateCamera();
});
canvas.addEventListener('wheel', e=>{
    radius += e.deltaY*0.01;
    radius = Math.max(10, Math.min(40, radius));
    updateCamera();
});
function updateCamera() {
    camera.position.x = Math.sin(theta)*radius;
    camera.position.y = Math.sin(phi)*radius+4;
    camera.position.z = Math.cos(theta)*radius;
    camera.lookAt(0,0,0);
}
updateCamera();

// Responsividade
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

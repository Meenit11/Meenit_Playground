// Separate-phones client disabled. The saved copy is outside the project
// (scratchpad mafia-before-revert/mafia.js). Server module server/games/mafia.js still supports it.
// ================================
// MAFIA - GAME LOGIC
// ================================

// Game State
let gameState = {
    gameId: null,
    totalPlayers: 5,
    setupPlayerNames: [],
    roleConfig: {
        doctor: 1,
        mafia: 1,
        detective: 0,
        jester: 0,
        bomber: 0,
        lover: 0,
        civilian: 3
    },
    players: [],
    currentRound: 1,
    currentPhase: 'night',
    viewingOrder: [],
    currentViewIndex: 0,
    gameEnded: false,
    pendingPhaseTransition: null,
    nightVictimId: null,
    votingQueue: [],
    loverTargets: {},   // loverId -> the partner that Lover protects
    bomberTargetId: null,
    bomberTriggered: false
};

// ================================
// INITIALIZATION
// ================================

// Reset state for new session
function init() {
    console.log('Mafia initializing...');

    gameState.gameEnded = false;
    gameState.setupPlayerNames = [];

    const playerCountDisplay = document.getElementById('player-count-display');
    if (playerCountDisplay) {
        gameState.totalPlayers = parseInt(playerCountDisplay.textContent, 10) || 5;
        playerCountDisplay.textContent = gameState.totalPlayers;
    }

    loadMafiaFromStorage();
    setupEventListeners();
    setupRulesModal();
    renderPlayerList();
    updateRoleDistribution();
    updatePlayersSummary();
}

// Run init immediately and on DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ================================
// EVENT LISTENERS
// ================================

function setupEventListeners() {
    // Player count adjustment
    const decBtn = document.getElementById('decrease-players');
    const incBtn = document.getElementById('increase-players');
    if (decBtn) decBtn.onclick = () => adjustPlayerCount(-1);
    if (incBtn) incBtn.onclick = () => adjustPlayerCount(1);

    // Mafia count adjustment
    const decMafia = document.getElementById('decrease-mafia');
    const incMafia = document.getElementById('increase-mafia');
    if (decMafia) decMafia.onclick = () => adjustMafiaCount(-1);
    if (incMafia) incMafia.onclick = () => adjustMafiaCount(1);

    // Doctor and Detective counts
    const decDoc = document.getElementById('decrease-doctor');
    const incDoc = document.getElementById('increase-doctor');
    const decDet = document.getElementById('decrease-detective');
    const incDet = document.getElementById('increase-detective');
    if (decDoc) decDoc.onclick = () => adjustRoleCount('doctor', -1);
    if (incDoc) incDoc.onclick = () => adjustRoleCount('doctor', 1);
    if (decDet) decDet.onclick = () => adjustRoleCount('detective', -1);
    if (incDet) incDet.onclick = () => adjustRoleCount('detective', 1);

    // Role toggles
    const detToggle = document.getElementById('detective-toggle');
    const jesToggle = document.getElementById('jester-toggle');
    const bomToggle = document.getElementById('bomber-toggle');
    const lovToggle = document.getElementById('lover-toggle');
    if (jesToggle) jesToggle.onchange = (e) => toggleRole('jester', e.target.checked);
    if (bomToggle) bomToggle.onchange = (e) => toggleRole('bomber', e.target.checked);
    const decLov = document.getElementById('decrease-lover');
    const incLov = document.getElementById('increase-lover');
    if (decLov) decLov.onclick = () => adjustRoleCount('lover', -1);
    if (incLov) incLov.onclick = () => adjustRoleCount('lover', 1);

    // Navigation Buttons
    const startBtn = document.getElementById('start-game-btn');
    const revealBtn = document.getElementById('reveal-role-btn');
    const doneBtn = document.getElementById('done-viewing-btn');
    const startNightBtn = document.getElementById('start-night-btn');
    const endNightBtn = document.getElementById('end-night-btn');
    const startDiscussionBtn = document.getElementById('start-discussion-btn');
    const confirmElimBtn = document.getElementById('confirm-elimination-btn');
    const skipDayBtn = document.getElementById('skip-elimination-btn');
    const playAgainBtn = document.getElementById('play-again-btn');

    if (startBtn) startBtn.onclick = startGame;

    const nameInput = document.getElementById('player-name-input');
    if (nameInput) {
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const name = nameInput.value.trim();
                if (name) {
                    addSetupPlayer(name);
                    nameInput.value = '';
                }
            }
        });
    }
    if (revealBtn) revealBtn.onclick = showRoleCard;
    const revealAllBtn = document.getElementById('reveal-all-roles-btn');
    if (revealAllBtn) revealAllBtn.onclick = showGMOverviewFromReveal;
    if (doneBtn) doneBtn.onclick = nextViewer;
    if (startNightBtn) startNightBtn.onclick = startNightPhase;
    if (endNightBtn) endNightBtn.onclick = showMorningPhase;
    if (startDiscussionBtn) startDiscussionBtn.onclick = startDayPhase;
    if (confirmElimBtn) confirmElimBtn.onclick = confirmEliminations;
    if (skipDayBtn) skipDayBtn.onclick = skipElimination;
    if (playAgainBtn) playAgainBtn.onclick = playAgain;
}

// ================================
// SETUP SCREEN
// ================================

function adjustPlayerCount(delta) {
    const display = document.getElementById('player-count-display');
    if (!display) return;
    let newValue = parseInt(display.textContent, 10) + delta;
    newValue = Math.max(5, Math.min(15, newValue));

    display.textContent = newValue;
    gameState.totalPlayers = newValue;
    updateRoleDistribution();
    updatePlayersSummary();
    saveMafiaToStorage();
}

function setupBackToSetup() {
    const btn = document.getElementById('ingame-back-btn');
    const modal = document.getElementById('back-setup-modal');
    if (!btn || !modal) return;
    const close = () => modal.classList.add('hidden');
    // On the winner screen the game is over: go straight home, no question.
    btn.onclick = () => {
        const winner = document.getElementById('screen-winner');
        if (winner && !winner.classList.contains('hidden')) { window.location.href = '../index.html'; return; }
        modal.classList.remove('hidden');
    };
    document.getElementById('back-setup-no').onclick = close;
    document.getElementById('back-setup-overlay').onclick = close;
    // Names and role settings are already saved, so a reload lands on a filled-in setup screen.
    document.getElementById('back-setup-yes').onclick = () => { saveMafiaToStorage(); location.reload(); };
}

function liftModalsToBody() {
    document.querySelectorAll('.modal').forEach(m => {
        if (m.parentElement !== document.body) document.body.appendChild(m);
    });
}

function setupRulesModal() {
    liftModalsToBody();
    setupBackToSetup();
    const rulesBtn = document.getElementById('rules-btn');
    const rulesModal = document.getElementById('rules-modal');
    const closeBtn = document.getElementById('close-rules');
    const overlay = document.getElementById('rules-modal-overlay');
    const backLink = document.querySelector('#screen-setup a[href="../index.html"]');
    const resetMafiaStorageBtn = document.getElementById('reset-mafia-storage-btn');
    if (rulesBtn) rulesBtn.addEventListener('click', () => {
        if (rulesModal) {
            rulesModal.classList.remove('hidden');
            const rulesScroll = rulesModal.querySelector('.rules-scroll');
            if (rulesScroll) rulesScroll.scrollTop = 0;
        }
        if (backLink) backLink.style.display = 'none';
    });
    const hideRules = () => {
        if (rulesModal) rulesModal.classList.add('hidden');
        if (backLink) backLink.style.display = '';
    };
    if (closeBtn) closeBtn.addEventListener('click', hideRules);
    if (overlay) overlay.addEventListener('click', hideRules);

    if (resetMafiaStorageBtn) {
        resetMafiaStorageBtn.addEventListener('click', () => {
            try {
                localStorage.removeItem('mafia_players');
                localStorage.removeItem('mafia_totalPlayers');
                localStorage.removeItem('mafia_roleConfig');
            } catch (e) { /* ignore */ }
            location.reload();
        });
    }
}

function addSetupPlayer(name) {
    if (gameState.setupPlayerNames.length < gameState.totalPlayers && name.trim()) {
        gameState.setupPlayerNames.push(name.trim());
        saveMafiaToStorage();
        renderPlayerList();
    }
}

function removeSetupPlayer(index) {
    gameState.setupPlayerNames.splice(index, 1);
    saveMafiaToStorage();
    renderPlayerList();
}

function moveSetupPlayer(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= gameState.setupPlayerNames.length) return;
    const temp = gameState.setupPlayerNames[index];
    gameState.setupPlayerNames[index] = gameState.setupPlayerNames[newIndex];
    gameState.setupPlayerNames[newIndex] = temp;
    saveMafiaToStorage();
    renderPlayerList();
}

function saveMafiaToStorage() {
    try {
        localStorage.setItem('mafia_players', JSON.stringify(gameState.setupPlayerNames));
        localStorage.setItem('mafia_totalPlayers', gameState.totalPlayers);
        localStorage.setItem('mafia_roleConfig', JSON.stringify(gameState.roleConfig));
    } catch (e) { /* ignore */ }
}

function loadMafiaFromStorage() {
    try {
        const saved = localStorage.getItem('mafia_players');
        if (saved) gameState.setupPlayerNames = JSON.parse(saved);
        const total = localStorage.getItem('mafia_totalPlayers');
        if (total) {
            gameState.totalPlayers = parseInt(total, 10);
            const display = document.getElementById('player-count-display');
            if (display) display.textContent = gameState.totalPlayers;
        }
        const rc = localStorage.getItem('mafia_roleConfig');
        if (rc) {
            const parsed = JSON.parse(rc);
            Object.assign(gameState.roleConfig, parsed);
            // Restore UI toggles
            const mafiaInput = document.getElementById('mafia-count');
            if (mafiaInput) mafiaInput.value = gameState.roleConfig.mafia;
            gameState.roleConfig.doctor = Math.max(1, parseInt(gameState.roleConfig.doctor, 10) || 1);
            gameState.roleConfig.detective = Math.max(0, parseInt(gameState.roleConfig.detective, 10) || 0);
            gameState.roleConfig.mafia = Math.max(1, parseInt(gameState.roleConfig.mafia, 10) || 1);
            if (mafiaInput) mafiaInput.value = gameState.roleConfig.mafia;
            gameState.roleConfig.lover = Math.max(0, parseInt(gameState.roleConfig.lover, 10) || 0);
            ['jester', 'bomber'].forEach(role => {
                const toggle = document.getElementById(role + '-toggle');
                if (toggle) toggle.checked = !!gameState.roleConfig[role];
            });
        }
    } catch (e) { /* ignore */ }
}

function renderPlayerList() {
    const container = document.getElementById('player-list');
    if (!container) return;
    container.innerHTML = '';
    const total = gameState.setupPlayerNames.length;
    gameState.setupPlayerNames.forEach((name, index) => {
        const chip = document.createElement('div');
        chip.className = 'player-chip';
        chip.innerHTML = `
            <button type="button" class="move-btn" ${index === 0 ? 'disabled' : ''} data-dir="-1" data-idx="${index}">▲</button>
            <button type="button" class="move-btn" ${index === total - 1 ? 'disabled' : ''} data-dir="1" data-idx="${index}">▼</button>
            <span class="player-chip-name">${escapeHtml(name)}</span>
            <button type="button" class="remove-player" data-index="${index}" aria-label="Remove">×</button>
        `;
        chip.querySelector('.remove-player').addEventListener('click', () => removeSetupPlayer(index));
        chip.querySelectorAll('.move-btn').forEach(btn => {
            btn.addEventListener('click', () => moveSetupPlayer(parseInt(btn.dataset.idx), parseInt(btn.dataset.dir)));
        });
        container.appendChild(chip);
    });
    updatePlayersSummary();
}

function updatePlayersSummary() {
    const el = document.getElementById('players-summary');
    if (!el) return;
    const n = gameState.totalPlayers;
    const names = gameState.setupPlayerNames;
    const left = n - names.length;
    if (names.length === 0) {
        el.textContent = `${n} players: add ${n} names below`;
    } else if (left > 0) {
        el.textContent = `${names.length} of ${n} added. ${left} more to go.`;
    } else {
        el.textContent = `All ${n} players are in. Ready to start.`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function adjustMafiaCount(delta) {
    const input = document.getElementById('mafia-count');
    let newValue = parseInt(input.value) + delta;
    newValue = Math.max(1, Math.min(5, newValue));

    input.value = newValue;
    gameState.roleConfig.mafia = newValue;

    document.getElementById('decrease-mafia').disabled = (newValue <= 1);
    document.getElementById('increase-mafia').disabled = (newValue >= 5);

    updateRoleDistribution();
    saveMafiaToStorage();
}

// Doctor: at least 1. Detective: 0 or more. Both must stay fewer than Civilians.
function adjustRoleCount(role, delta) {
    const min = role === 'doctor' ? 1 : 0;
    const current = gameState.roleConfig[role] || 0;
    const next = Math.max(min, current + delta);
    if (delta > 0 && !roleCanGrow(role)) return;
    gameState.roleConfig[role] = next;
    updateRoleDistribution();
    saveMafiaToStorage();
}

// Adding one more of this role takes one Civilian away; the role must still be fewer than Civilians.
function roleCanGrow(role) {
    const civilians = gameState.roleConfig.civilian;
    return (gameState.roleConfig[role] + 1) < (civilians - 1);
}

function toggleRole(role, isEnabled) {
    gameState.roleConfig[role] = isEnabled ? 1 : 0;
    updateRoleDistribution();
    saveMafiaToStorage();
}

function updateRoleDistribution() {
    const total = gameState.totalPlayers;
    const sum = gameState.roleConfig.doctor +
        gameState.roleConfig.mafia +
        gameState.roleConfig.detective +
        gameState.roleConfig.jester +
        gameState.roleConfig.bomber +
        gameState.roleConfig.lover;

    const civilians = total - sum;
    gameState.roleConfig.civilian = civilians;

    const countEl = document.getElementById('civilian-count');
    if (countEl) countEl.textContent = civilians;

    const docs = gameState.roleConfig.doctor;
    const dets = gameState.roleConfig.detective;
    const lovs = gameState.roleConfig.lover;
    const docInput = document.getElementById('doctor-count');
    const detInput = document.getElementById('detective-count');
    if (docInput) docInput.value = docs;
    if (detInput) detInput.value = dets;
    const lovInput = document.getElementById('lover-count');
    if (lovInput) lovInput.value = lovs;
    const decLov = document.getElementById('decrease-lover');
    const incLov = document.getElementById('increase-lover');
    if (decLov) decLov.disabled = lovs <= 0;
    if (incLov) incLov.disabled = !roleCanGrow('lover');
    const decDoc = document.getElementById('decrease-doctor');
    const decDet = document.getElementById('decrease-detective');
    const incDoc = document.getElementById('increase-doctor');
    const incDet = document.getElementById('increase-detective');
    if (decDoc) decDoc.disabled = docs <= 1;
    if (decDet) decDet.disabled = dets <= 0;
    if (incDoc) incDoc.disabled = !roleCanGrow('doctor');
    if (incDet) incDet.disabled = !roleCanGrow('detective');

    let problem = '';
    if (civilians < 1) problem = 'Not enough players for these roles.';
    else if (docs >= civilians) problem = 'Doctors must be fewer than Civilians.';
    else if (dets > 0 && dets >= civilians) problem = 'Detectives must be fewer than Civilians.';
    else if (lovs > 0 && lovs >= civilians) problem = 'Lovers must be fewer than Civilians.';
    const note = document.getElementById('role-limit-note');
    if (note) note.textContent = problem;

    const startBtn = document.getElementById('start-game-btn');
    if (problem) {
        if (startBtn) startBtn.disabled = true;
        if (countEl) countEl.style.color = 'var(--danger)';
    } else {
        if (startBtn) startBtn.disabled = false;
        if (countEl) countEl.style.color = 'var(--accent)';
    }
}

// ================================
// GAME START
// ================================

function startGame() {
    gameState.totalPlayers = parseInt(document.getElementById('player-count-display').textContent, 10) || 5;
    const names = gameState.setupPlayerNames.slice(0, gameState.totalPlayers);

    if (names.length < gameState.totalPlayers) {
        alert('Please enter all player names. Add names one by one and press Enter.');
        return;
    }

    const validation = validatePlayerNames(names);
    if (!validation.valid) {
        alert(validation.error);
        return;
    }

    assignRoles(names);

    const randomStartIndex = getRandomInt(0, gameState.totalPlayers - 1);
    gameState.viewingOrder = [];
    for (let i = 0; i < gameState.totalPlayers; i++) {
        gameState.viewingOrder.push((randomStartIndex + i) % gameState.totalPlayers);
    }
    gameState.currentViewIndex = 0;

    gameState.gameId = generateId().slice(0, 8).toUpperCase();
    saveGame('mafia', gameState);

    showScreen('screen-role-viewing');
    showNextViewer();
}

function assignRoles(names) {
    gameState.players = [];
    const roles = [];

    roles.push('doctor');
    for (let i = 0; i < gameState.roleConfig.mafia; i++) roles.push('mafia');
    for (let i = 1; i < gameState.roleConfig.doctor; i++) roles.push('doctor');
    for (let i = 0; i < gameState.roleConfig.detective; i++) roles.push('detective');
    if (gameState.roleConfig.jester) roles.push('jester');
    if (gameState.roleConfig.bomber) roles.push('bomber');
    for (let i = 0; i < gameState.roleConfig.lover; i++) roles.push('lover');
    for (let i = 0; i < gameState.roleConfig.civilian; i++) roles.push('civilian');

    const shuffledRoles = shuffleArray(roles);

    names.forEach((name, index) => {
        gameState.players.push({
            id: generateId(),
            name: name,
            role: shuffledRoles[index],
            isAlive: true
        });
    });
}

// ================================
// ROLE VIEWING
// ================================

function showNextViewer() {
    if (gameState.currentViewIndex >= gameState.viewingOrder.length) {
        showScreen('screen-gm-reveal');
        showGMRevealScreen();
        return;
    }

    const playerIndex = gameState.viewingOrder[gameState.currentViewIndex];
    const player = gameState.players[playerIndex];
    document.getElementById('next-viewer-name').textContent = player.name;
    document.getElementById('reveal-role-btn').textContent = 'Reveal My Role';
    document.getElementById('reveal-role-btn').onclick = showRoleCard;
    showScreen('screen-role-viewing');
}

function showRoleCard() {
    const playerIndex = gameState.viewingOrder[gameState.currentViewIndex];
    const player = gameState.players[playerIndex];
    const roleData = getRoleData(player.role);

    document.getElementById('role-image').src = roleData.image;
    document.getElementById('role-name').textContent = roleData.name;
    document.getElementById('role-description').textContent = roleData.description;

    showScreen('screen-role-card');
    updatePassPhoneButton();
}

function updatePassPhoneButton() {
    const nextPlayerSpan = document.getElementById('next-player-name');
    const nextIndex = gameState.currentViewIndex + 1;

    let nextName;
    if (nextIndex >= gameState.viewingOrder.length) {
        nextName = 'the Game Master';
    } else {
        const nextPlayerIdx = gameState.viewingOrder[nextIndex];
        nextName = gameState.players[nextPlayerIdx].name;
    }
    nextPlayerSpan.textContent = nextName === 'the Game Master' ? 'Game Master' : nextName;
    const hint = document.getElementById('next-player-hint');
    if (hint) hint.textContent = nextName;
}

function nextViewer() {
    gameState.currentViewIndex++;
    saveGame('mafia', gameState);
    showNextViewer();
}

// ================================
// GAME PHASES
// ================================

function showGMRevealScreen() {
    document.body.classList.add('mafia-god');
}

function showGMOverviewFromReveal() {
    showScreen('screen-gm-overview');
    displayGMOverview();
}

function displayGMOverview() {
    const container = document.getElementById('all-roles-list');
    container.innerHTML = '';

    gameState.players.forEach(player => {
        const roleData = getRoleData(player.role);
        const itemDiv = document.createElement('div');
        itemDiv.className = 'role-grid-item';
        itemDiv.innerHTML = `
            <div class="player-name-header">${player.name}</div>
            <img src="${roleData.image}" alt="${roleData.name}" class="role-image-small">
            <div class="role-name-badge ${player.role}">${roleData.name}</div>
        `;
        container.appendChild(itemDiv);
    });
}

function startNightPhase() {
    gameState.currentPhase = 'night';
    document.body.classList.remove('day');
    document.body.classList.add('night');
    saveGame('mafia', gameState);
    showScreen('screen-night');
    displayNightInstructions();
}

function displayNightInstructions() {
    document.getElementById('night-round-number').textContent = gameState.currentRound;
    const container = document.getElementById('night-order-list');
    container.innerHTML = '';

    const mafiaPlayers = gameState.players.filter(p => p.role === 'mafia' && p.isAlive).map(p => p.name).join(', ');
    const doctorNames = gameState.players.filter(p => p.role === 'doctor' && p.isAlive).map(p => p.name).join(', ');
    const instructions = [];
    instructions.push('🏙️ City goes to sleep! Eyes shut, no peeking!');
    instructions.push(`🔪 Mafia wake up! (${mafiaPlayers || '—'}) Choose your victim... Mafia, go to sleep.`);
    instructions.push(`😇 Doctor wake up! (${doctorNames || '—'}) Who are we saving tonight? Doctor, go to sleep.`);

    const detectiveNames = gameState.players.filter(p => p.role === 'detective' && p.isAlive).map(p => p.name).join(', ');
    if (detectiveNames) {
        instructions.push(`🕵️ Detective wake up! (${detectiveNames}) Suspect someone... Detective, go to sleep.`);
    }

    const aliveLovers = gameState.players.filter(p => p.role === 'lover' && p.isAlive);
    const lovContainer = document.getElementById('lover-selection-container');

    if (aliveLovers.length && gameState.currentRound === 1) {
        const many = aliveLovers.length > 1;
        instructions.push(`💖 ${many ? 'Lovers' : 'Lover'} wake up! (${aliveLovers.map(p => p.name).join(', ')}) Blow a flying kiss... ${many ? 'Lovers' : 'Lover'}, go to sleep.`);
        showElement(lovContainer);
        displayLoverSelection();
    } else {
        hideElement(lovContainer);
    }

    instructions.forEach(ins => {
        const li = document.createElement('li');
        li.textContent = ins;
        container.appendChild(li);
    });
}

function displayLoverSelection() {
    const container = document.getElementById('lover-target-list');
    container.innerHTML = '';
    const lovers = gameState.players.filter(p => p.role === 'lover' && p.isAlive);
    const question = document.getElementById('lover-question');
    if (question) question.textContent = lovers.length > 1 ? '💖 Who did each Lover kiss?' : '💖 Who did the Lover kiss?';

    lovers.forEach(lover => {
        if (lovers.length > 1) {
            const label = document.createElement('p');
            label.className = 'lover-for';
            label.textContent = `${lover.name} kissed:`;
            container.appendChild(label);
        }
        const group = document.createElement('div');
        group.className = 'lover-group';
        gameState.players.filter(p => p.id !== lover.id).forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline btn-full';
            btn.textContent = p.name;
            btn.onclick = () => {
                gameState.loverTargets[lover.id] = p.id;
                updateLoverSelectionHighlight(btn, group);
            };
            if (gameState.loverTargets[lover.id] === p.id) {
                btn.classList.add('btn-primary');
                btn.classList.remove('btn-outline');
            }
            group.appendChild(btn);
        });
        container.appendChild(group);
    });
}

// The alive Lover (if any) who would die in place of this player.
function loverProtecting(playerId) {
    return gameState.players.find(l => l.role === 'lover' && l.isAlive && l.id !== playerId &&
        gameState.loverTargets[l.id] === playerId) || null;
}

function updateLoverSelectionHighlight(activeBtn, container) {
    container.querySelectorAll('button').forEach(btn => {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
    });
    activeBtn.classList.remove('btn-outline');
    activeBtn.classList.add('btn-primary');
}

function showMorningPhase() {
    document.body.classList.remove('night', 'day');
    document.body.classList.add('morning');
    showScreen('screen-morning-results');
    const container = document.getElementById('night-outcome-list');
    const announcement = document.getElementById('morning-announcement');
    const startDiscussionBtn = document.getElementById('start-discussion-btn');

    container.innerHTML = '';
    announcement.textContent = 'EVERYONE wake up! Let’s see who survived the night...';
    startDiscussionBtn.disabled = true;
    gameState.nightVictimId = null;

    const noneBtn = document.createElement('button');
    noneBtn.className = 'btn btn-outline btn-full btn-lg mb-md morning-outcome-btn';
    noneBtn.textContent = 'no one was found dead';
    noneBtn.onclick = () => {
        highlightSelection(noneBtn, container);
        announcement.textContent = 'The city wakes up finding no one was found dead';
        gameState.nightVictimId = 'none';
        startDiscussionBtn.disabled = false;
    };
    container.appendChild(noneBtn);

    gameState.players.filter(p => p.isAlive).forEach(p => {
        const pBtn = document.createElement('button');
        pBtn.className = 'btn btn-outline btn-full mb-sm morning-outcome-btn';
        pBtn.textContent = p.name;
        pBtn.onclick = () => {
            highlightSelection(pBtn, container);
            const lover = loverProtecting(p.id);
            if (lover) {
                announcement.textContent = `The city wakes up finding ${lover.name} dead (Sacrificed for ${p.name})`;
            } else {
                announcement.textContent = `The city wakes up finding ${p.name} dead`;
            }
            gameState.nightVictimId = p.id;
            startDiscussionBtn.disabled = false;
        };
        container.appendChild(pBtn);
    });
}

function highlightSelection(activeBtn, container) {
    const btns = container.querySelectorAll('.morning-outcome-btn');
    btns.forEach(btn => {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
    });
    if (activeBtn) {
        activeBtn.classList.remove('btn-outline');
        activeBtn.classList.add('btn-primary');
    }
}

function startDayPhase() {
    document.body.classList.remove('morning');
    const victimId = gameState.nightVictimId;
    if (victimId && victimId !== 'none') {
        eliminatePlayer(victimId, 'night');
        if (gameState.gameEnded) return;
    }
    if (checkWinConditions()) return;
    document.body.classList.remove('night');
    document.body.classList.add('day');
    showScreen('screen-day');
    displayDayPhase();
}

function displayDayPhase() {
    document.getElementById('day-round-number').textContent = gameState.currentRound;
    const container = document.getElementById('alive-players-container');
    container.innerHTML = '';

    gameState.players.filter(p => p.isAlive).forEach(p => {
        const item = document.createElement('div');
        item.className = 'elimination-player-item';
        item.innerHTML = `
            <div class="player-selection-row" onclick="togglePlayerSelection('${p.id}')">
                <input type="checkbox" class="elimination-checkbox" id="check-${p.id}" data-player-id="${p.id}" onclick="event.stopPropagation(); enforceSingleSelect('${p.id}'); updateEliminationButton();">
                <span class="player-name">${p.name}</span>
            </div>
        `;
        container.appendChild(item);
    });

    updateEliminationButton();
}

function enforceSingleSelect(clickedId) {
    document.querySelectorAll('.elimination-checkbox').forEach(cb => {
        if (cb.id !== `check-${clickedId}`) cb.checked = false;
    });
}
function togglePlayerSelection(id) {
    const cb = document.getElementById(`check-${id}`);
    if (!cb) return;
    const allChecked = document.querySelectorAll('.elimination-checkbox:checked');
    if (!cb.checked) {
        allChecked.forEach(c => { c.checked = false; });
    }
    cb.checked = !cb.checked;
    updateRowHighlights();
    updateEliminationButton();
}

window.togglePlayerSelection = togglePlayerSelection;

function updateRowHighlights() {
    document.querySelectorAll('.elimination-player-item').forEach(item => {
        const cb = item.querySelector('.elimination-checkbox');
        item.classList.toggle('selected', !!cb && cb.checked);
    });
}

function updateEliminationButton() {
    const checked = document.querySelectorAll('.elimination-checkbox:checked');
    const btn = document.getElementById('confirm-elimination-btn');
    btn.disabled = checked.length !== 1;
    updateRowHighlights();
}

function confirmEliminations() {
    const checked = document.querySelectorAll('.elimination-checkbox:checked');
    const ids = Array.from(checked).map(cb => cb.dataset.playerId);

    if (ids.length !== 1) {
        alert('Select exactly 1 player to eliminate, or use "No Selection" to skip.');
        return;
    }

    if (!confirm('Eliminate this player?')) return;

    gameState.bomberTriggered = false;
    ids.forEach((id) => {
        eliminatePlayer(id, 'day');
    });

    if (!gameState.gameEnded && !gameState.bomberTriggered) {
        nextRound();
    }
}

function skipElimination() {
    nextRound();
}

function eliminatePlayer(id, phase) {
    let finalId = id;
    const lover = loverProtecting(id);

    // LOVER SACRIFICE LOGIC
    if (lover) {
        const targetPlayer = gameState.players.find(p => p.id === id);
        showBannerNotification(`💖 SACRIFICE! ${lover.name} died for ${targetPlayer.name}`, 2500);
        showLoverSacrificeModal(lover, targetPlayer);
        finalId = lover.id;
    }

    const player = gameState.players.find(p => p.id === finalId);
    if (!player || !player.isAlive) return;

    player.isAlive = false;

    // JESTER: Win if voted out in Day phase
    if (phase === 'day' && player.role === 'jester') {
        showWinner('Jester');
        return;
    }

    // BOMBER: Only activate if voted out (Day phase)
    if (phase === 'day' && player.role === 'bomber') {
        gameState.bomberTriggered = true;
        showBomberModal();
        return;
    }

    checkWinConditions();
}

function showBomberModal() {
    const modal = document.getElementById('bomber-modal');
    const container = document.getElementById('bomber-target-list');
    container.innerHTML = '';

    gameState.players.filter(p => p.isAlive).forEach(player => {
        const row = document.createElement('div');
        row.className = 'bomber-target-row';
        row.innerHTML = `
            <span class="player-name">${player.name}</span>
            <button class="bomber-kill-btn" title="Eliminate ${player.name}">❌</button>
        `;

        const killBtn = row.querySelector('.bomber-kill-btn');
        killBtn.onclick = () => {
            // Immediate closure of modal
            hideElement('#bomber-modal');
            gameState.bomberTriggered = false;

            // Elimination logic
            eliminatePlayer(player.id, 'day'); // Treat as day elim to allow win check

            if (!gameState.gameEnded) {
                nextRound();
            }
        };

        container.appendChild(row);
    });

    modal.classList.add('bomber-boom');
    showElement(modal);
    setTimeout(() => modal.classList.remove('bomber-boom'), 800);
}

function showLoverSacrificeModal(lover, targetPlayer) {
    const modal = document.getElementById('lover-modal');
    if (!modal) return;
    const loverNameEl = document.getElementById('lover-name');
    const targetNameEl = document.getElementById('lover-target-name');
    const targetImg = modal.querySelector('.lover-target-img');
    if (loverNameEl) loverNameEl.textContent = lover.name;
    if (targetNameEl) targetNameEl.textContent = targetPlayer ? targetPlayer.name : '';
    if (targetImg && targetPlayer) {
        const data = getRoleData(targetPlayer.role);
        targetImg.src = data.image || '../images/Civilian.png';
        targetImg.alt = data.name || 'Player';
    }
    modal.classList.add('lover-heartbreak');
    showElement(modal);
    setTimeout(() => modal.classList.remove('lover-heartbreak'), 2000);
}

function showBannerNotification(message, duration = 2000) {
    const banner = document.getElementById('notification-banner');
    if (!banner) return;

    banner.textContent = message;
    banner.classList.remove('hidden');

    setTimeout(() => {
        banner.classList.add('hidden');
    }, duration);
}

function checkWinConditions() {
    const alive = gameState.players.filter(p => p.isAlive);
    const mafia = alive.filter(p => p.role === 'mafia');
    const others = alive.filter(p => p.role !== 'mafia');

    if (mafia.length === 0) {
        showWinner('Civilians');
        return true;
    }

    if (mafia.length >= others.length) {
        showWinner('Mafia');
        return true;
    }

    return false;
}

function showWinner(team) {
    gameState.gameEnded = true;
    document.body.classList.remove('night', 'day', 'winner-mafia', 'winner-jester', 'winner-civilians');
    document.body.classList.add('winner-celebration');
    if (team === 'Mafia') document.body.classList.add('winner-mafia');
    else if (team === 'Jester') document.body.classList.add('winner-jester');
    else document.body.classList.add('winner-civilians');
    document.getElementById('winner-title').textContent = `${team} Wins!`;
    const list = document.getElementById('final-roles-list');
    const h3 = document.getElementById('winner-roles-label');
    if (h3) h3.textContent = team === 'Mafia' ? 'Mafia' : team === 'Jester' ? 'Jester' : 'Winners';
    list.innerHTML = '';
    let playersToShow = [];
    if (team === 'Mafia') playersToShow = gameState.players.filter(p => p.role === 'mafia');
    else if (team === 'Jester') playersToShow = gameState.players.filter(p => p.role === 'jester');
    else playersToShow = gameState.players.filter(p => p.role !== 'mafia' && p.role !== 'jester');
    const confettiColors = ['#d4b84a', '#c9a82c', '#b8962a', '#e8d070'];
    playersToShow.forEach(p => {
        const data = getRoleData(p.role);
        list.innerHTML += `
            <div class="final-role-item-winner">
                <img src="${data.image}" alt="${data.name}" class="final-role-img">
                <span class="player-name">${p.name}</span>
            </div>
        `;
    });
    document.body.classList.remove('night');
    document.body.classList.add('day');
    showScreen('screen-winner');
    showGoldenParticles(document.getElementById('confetti-container'));
}

function nextRound() {
    gameState.currentRound++;
    startNightPhase();
}

function playAgain() { location.reload(); }

function validatePlayerNames(names) {
    if (!names || names.length === 0) return { valid: false, error: 'Enter at least one player name.' };
    const trimmed = names.map(n => (n || '').trim()).filter(Boolean);
    if (trimmed.length < names.length) return { valid: false, error: 'All names must be non-empty.' };
    const lower = trimmed.map(n => n.toLowerCase());
    const seen = new Set();
    for (const n of lower) {
        if (seen.has(n)) return { valid: false, error: 'Duplicate names not allowed.' };
        seen.add(n);
    }
    return { valid: true };
}

// Uniform random integer in [0, n) from the browser's cryptographic generator,
// with rejection sampling so no value is favoured. Falls back to Math.random.
function randomBelow(n) {
    const c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues) {
        const limit = Math.floor(0x100000000 / n) * n;
        const buf = new Uint32Array(1);
        do { c.getRandomValues(buf); } while (buf[0] >= limit);
        return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
}

function getRandomInt(min, max) {
    return min + randomBelow(max - min + 1);
}

// Fisher-Yates shuffle: every arrangement of roles is equally likely, fresh every game.
function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = randomBelow(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function getRoleData(role) {
    const roleMap = {
        doctor: { name: 'Doctor', image: '../images/Doctor.png', description: 'Can save one life every night.' },
        mafia: { name: 'Mafia', image: '../images/Mafia.png', description: 'Eliminate civilians at night.' },
        detective: { name: 'Detective', image: '../images/Detective.png', description: 'Suspect players to find Mafia.' },
        jester: { name: 'Jester', image: '../images/Jester.png', description: 'Try to get voted out to win!' },
        bomber: { name: 'Bomber', image: '../images/Bomber.png', description: 'Take someone with you if voted out.' },
        lover: { name: 'Lover', image: '../images/Lover.png', description: 'Protects someone by sacrifice.' },
        civilian: { name: 'Civilian', image: '../images/Civilian.png', description: 'Find the Mafia!' }
    };
    return roleMap[role] || roleMap.civilian;
}

function showScreen(id) {
    const screens = ['screen-setup', 'screen-role-viewing', 'screen-role-card', 'screen-gm-reveal', 'screen-gm-overview', 'screen-night', 'screen-morning-results', 'screen-day', 'screen-winner'];
    document.body.classList.remove('mafia-gangster', 'mafia-god', 'mafia-god-golden');
    if (id === 'screen-setup') document.body.classList.add('mafia-gangster');
    if (['screen-role-viewing', 'screen-role-card', 'screen-gm-reveal'].includes(id)) document.body.classList.add('mafia-god');
    if (id === 'screen-gm-overview') document.body.classList.add('mafia-god', 'mafia-god-golden');
    const backBtn = document.getElementById('ingame-back-btn');
    if (backBtn) backBtn.classList.toggle('hidden', id === 'screen-setup');
    screens.forEach(s => {
        const el = document.getElementById(s);
        if (el) {
            if (s === id) { el.classList.remove('hidden'); el.classList.add('animate-fadeIn'); }
            else { el.classList.add('hidden'); }
        }
    });
    // Phase scenery follows the visible screen (decorative only, see PHASE SCENERY).
    if (typeof mafiaScene !== 'undefined') mafiaScene.onScreen(id);
}

function showElement(el) {
    if (typeof el === 'string') el = document.querySelector(el) || document.getElementById(el);
    if (el) el.classList.remove('hidden');
}

function hideElement(el) {
    if (typeof el === 'string') el = document.querySelector(el) || document.getElementById(el);
    if (el) el.classList.add('hidden');
}

// The old falling gold dots are replaced by the per-team winner scene.
function showGoldenParticles(container) {
    if (typeof mafiaScene !== 'undefined') mafiaScene.winnerParticles(container);
}

// ================================
// PHASE SCENERY (decorative, additive)
// One continuous sky behind the screens: night, dawn (morning reveal), day,
// dusk (day to night) and a sky per winning team. Reveal beats play on
// the scene and on #mafia-fx-top. Nothing here changes game state, and no
// element here takes taps.
// ================================
var mafiaScene = (function () {
    var root = null, fxTop = null, sceneFx = null;
    var state = 'off', phaseTimer = null, shootTimer = null, resizeTimer = null;
    var cityWidth = 0, shakeFlip = false, beatTimers = [];
    var HEART_SVG = '<svg viewBox="0 0 32 29" aria-hidden="true"><path d="M16 29 2.4 15.6A8 8 0 0 1 16 4.3a8 8 0 0 1 13.6 11.3z"/></svg>';

    function reduced() {
        try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
        catch (e) { return false; }
    }
    function rand(a, b) { return a + Math.random() * (b - a); }
    function r2(n) { return Math.round(n * 100) / 100; }
    function $(id) { return document.getElementById(id); }

    function mount() {
        if (root) return true;
        root = $('mafia-scene');
        if (!root) return false;
        fxTop = $('mafia-fx-top');
        sceneFx = $('scene-fx');
        buildStars();
        buildCity();
        bindBeats();
        window.addEventListener('resize', onResize);
        return true;
    }

    // ---------- Stars ----------
    function buildStars() {
        var box = $('scene-stars');
        if (!box) return;
        var n = (window.innerWidth || 400) < 600 ? 56 : 84;
        var html = '';
        for (var i = 0; i < n; i++) {
            var big = Math.random() < 0.12;
            var s = r2(big ? rand(2.2, 3.2) : rand(0.8, 1.8));
            html += '<span class="scene-star' + (big ? ' is-bright' : '') + '" style="left:' + r2(rand(1, 99)) + '%;top:' +
                r2(rand(1, 96)) + '%;width:' + s + 'px;height:' + s + 'px;--t:' + r2(rand(2.4, 6.5)) + 's;--dl:-' + r2(rand(0, 6)) + 's"></span>';
        }
        box.innerHTML = html;
    }

    // ---------- City skyline (inline SVG sized to the viewport) ----------
    function skyline(W, H, minF, maxF, minW, maxW, withWindows) {
        var d = '', wins = '', count = 0, x = -rand(0, 18);
        while (x < W) {
            var bw = Math.round(rand(minW, maxW));
            var bh = Math.round(H * rand(minF, maxF));
            var top = H - bh;
            d += 'M' + x + ' ' + H + 'V' + top + 'H' + (x + bw) + 'V' + H + 'Z';
            var roll = Math.random();
            if (roll < 0.3) {
                var sh = Math.round(rand(6, 14));
                d += 'M' + r2(x + bw * 0.2) + ' ' + top + 'V' + (top - sh) + 'H' + r2(x + bw * 0.8) + 'V' + top + 'Z';
            } else if (roll < 0.45) {
                var ax = r2(x + bw * rand(0.3, 0.7));
                d += 'M' + ax + ' ' + top + 'V' + (top - Math.round(rand(10, 22))) + 'h2V' + top + 'Z';
            }
            if (withWindows) {
                var cols = Math.floor((bw - 8) / 8), rows = Math.floor((bh - 14) / 10);
                for (var r = 0; r < rows; r++) {
                    for (var c = 0; c < cols; c++) {
                        if (count >= 170 || Math.random() > 0.3) continue;
                        count++;
                        var cls = 'scene-win' + (Math.random() < 0.5 ? ' keep' : '') + (Math.random() < 0.35 ? ' early' : '');
                        var rect = '<rect class="' + cls + '" x="' + r2(x + 5 + c * 8) + '" y="' + (top + 8 + r * 10) +
                            '" width="3.5" height="5" style="--d:' + r2(rand(0, 1.3)) + 's"/>';
                        if (Math.random() < 0.1) {
                            rect = '<g class="scene-flick" style="--f:' + r2(rand(7, 16)) + 's;--fd:-' + r2(rand(0, 12)) + 's">' + rect + '</g>';
                        }
                        wins += rect;
                    }
                }
            }
            x += bw + Math.round(rand(0, 4));
        }
        return { d: d, wins: wins };
    }

    function buildCity() {
        var box = $('scene-city');
        if (!box) return;
        var W = Math.max(360, Math.round(window.innerWidth || 400));
        var H = Math.round(Math.min(220, Math.max(120, (window.innerHeight || 700) * 0.22)));
        cityWidth = W;
        root.style.setProperty('--city-h', H + 'px');
        var back = skyline(W, H, 0.5, 0.92, 26, 52, false);
        var front = skyline(W, H, 0.24, 0.66, 30, 60, true);
        var open = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMax slice" focusable="false" class="';
        var shapes = '"><path class="bk" d="' + back.d + '"/><path class="fr" d="' + front.d + '"/></svg>';
        box.innerHTML = open + 'city-night' + shapes + open + 'city-day' + shapes + open + 'city-blood' + shapes +
            open + 'city-windows">' + front.wins + '</svg>';
    }

    function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if (Math.abs(Math.max(360, window.innerWidth || 400) - cityWidth) > 60) buildCity();
        }, 250);
    }

    // ---------- Phase state ----------
    function set(s) {
        clearTimeout(phaseTimer);
        phaseTimer = null;
        state = s;
        root.setAttribute('data-scene', s);
        if (s === 'night') scheduleShoot(); else stopShoot();
        smoke(s === 'win-mafia');
    }

    function onScreen(id) {
        if (!mount()) return;
        var b = document.body.classList;
        var next = 'off';
        if (id === 'screen-night') next = 'night';
        else if (id === 'screen-morning-results') next = 'dawn';
        else if (id === 'screen-day') next = 'day';
        else if (id === 'screen-winner') next = b.contains('winner-mafia') ? 'win-mafia' : b.contains('winner-jester') ? 'win-jester' : 'win-civ';
        clearShake();
        if (next === 'night' && (state === 'day' || state === 'dusk')) {
            // Sunset first: dusky orange, then dark, stars and windows follow.
            set('dusk');
            phaseTimer = setTimeout(function () { set('night'); }, reduced() ? 0 : 750);
        } else if (next !== state) {
            set(next);
        }
        if (id === 'screen-winner') winnerIntro();
    }

    // ---------- Shooting star ----------
    function scheduleShoot() {
        if (shootTimer || reduced()) return;
        shootTimer = setTimeout(function () {
            shootTimer = null;
            if (state !== 'night') return;
            if (!document.hidden) {
                var s = $('scene-shooting');
                if (s) {
                    s.style.left = r2(rand(4, 55)) + '%';
                    s.style.top = r2(rand(5, 30)) + '%';
                    replay(s, 'is-on', 1250);
                }
            }
            scheduleShoot();
        }, rand(5000, 12000));
    }
    function stopShoot() { clearTimeout(shootTimer); shootTimer = null; }

    // ---------- Helpers ----------
    function replay(el, cls, ms) {
        if (!el) return;
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        clearTimeout(el._sceneT);
        el._sceneT = setTimeout(function () { el.classList.remove(cls); }, ms);
    }
    function later(fn, ms) { beatTimers.push(setTimeout(fn, ms)); }
    function resetBeat() {
        beatTimers.forEach(clearTimeout);
        beatTimers = [];
        if (sceneFx) sceneFx.innerHTML = '';
    }
    function fx(cls) { return fxTop ? fxTop.querySelector('.' + cls) : null; }
    function centreOf(el) {
        var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (!r || !r.width) return { x: (window.innerWidth || 400) / 2, y: (window.innerHeight || 700) * 0.3 };
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    function spawn(parent, cls, x, y, ms, html) {
        if (!parent) return null;
        var el = document.createElement('div');
        el.className = cls;
        el.style.left = Math.round(x) + 'px';
        el.style.top = Math.round(y) + 'px';
        if (html) el.innerHTML = html;
        parent.appendChild(el);
        setTimeout(function () { el.remove(); }, ms);
        return el;
    }
    function calm(rose) {
        var v = fx('fx-vignette');
        if (!v) return;
        v.classList.toggle('is-rose', !!rose);
        replay(v, 'is-calm', 1200);
    }
    function vignette(cls, rose) {
        var v = fx('fx-vignette');
        if (!v) return;
        v.classList.remove('is-on', 'is-short');
        v.classList.toggle('is-rose', !!rose);
        replay(v, cls, cls === 'is-on' ? 2700 : 1700);
    }
    function shake() {
        var el = $('screen-morning-results');
        if (!el) return;
        el.classList.remove('scene-shake-a', 'scene-shake-b');
        void el.offsetWidth;
        shakeFlip = !shakeFlip;
        el.classList.add(shakeFlip ? 'scene-shake-a' : 'scene-shake-b');
    }
    function clearShake() {
        var el = $('screen-morning-results');
        if (el) el.classList.remove('scene-shake-a', 'scene-shake-b');
    }

    // ---------- Reveal beats ----------
    function beatKill(anchor) {
        resetBeat();
        if (reduced()) { calm(false); return; }
        replay(fx('fx-dim'), 'is-on', 1800);
        vignette('is-on', false);
        var c = centreOf(anchor);
        [350, 650, 950].forEach(function (d) { later(function () { spawn(sceneFx, 'scene-ripple', c.x, c.y, 2600); }, d); });
        shake();
    }
    function beatRelief(anchor) {
        resetBeat();
        clearShake();
        if (reduced()) return;
        var c = centreOf(anchor);
        spawn(sceneFx, 'scene-relief', c.x, c.y, 2800);
    }
    function beatHeart(anchor, withShake) {
        resetBeat();
        if (reduced()) { calm(true); return; }
        vignette('is-short', true);
        var c = centreOf(anchor);
        spawn(sceneFx, 'scene-heart', c.x, c.y, 2400, '<i>' + HEART_SVG + '</i><i>' + HEART_SVG + '</i>');
        [500, 800].forEach(function (d) { later(function () { spawn(sceneFx, 'scene-ripple is-rose', c.x, c.y, 2600); }, d); });
        if (withShake) shake();
    }
    function beatBomber() {
        resetBeat();
        if (reduced()) { calm(false); return; }
        replay(fx('fx-flash'), 'is-on', 850);
        vignette('is-short', false);
        var c = { x: (window.innerWidth || 400) / 2, y: (window.innerHeight || 700) * 0.45 };
        spawn(fxTop, 'scene-ripple is-blast', c.x, c.y, 1300);
        later(function () { spawn(fxTop, 'scene-ripple is-blast', c.x, c.y, 1300); }, 180);
    }
    function beatGhost(info) {
        resetBeat();
        if (reduced()) { calm(false); return; }
        var r = info.rect, W = window.innerWidth || 400, H = window.innerHeight || 700;
        var box = (r && r.width) ? { l: r.left, t: r.top, w: r.width, h: r.height } : { l: W * 0.1, t: H * 0.4, w: W * 0.8, h: 52 };
        var g = document.createElement('div');
        g.className = 'fx-ghost';
        g.style.cssText = 'left:' + Math.round(box.l) + 'px;top:' + Math.round(box.t) + 'px;width:' + Math.round(box.w) + 'px;height:' + Math.round(box.h) + 'px';
        g.textContent = info.name || '';
        if (fxTop) fxTop.appendChild(g);
        setTimeout(function () { g.remove(); }, 1600);
        vignette('is-short', false);
        spawn(sceneFx, 'scene-ripple', box.l + box.w / 2, box.t + box.h / 2, 2600);
    }

    function bindBeats() {
        // Morning: the Game Master taps who died. Runs after the button's own handler.
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('#night-outcome-list .morning-outcome-btn') : null;
            if (!btn) return;
            var v = gameState.nightVictimId;
            var anchor = $('morning-announcement');
            if (v === 'none') beatRelief(anchor);
            else if (v) {
                if (loverProtecting(v)) beatHeart(anchor, true);
                else beatKill(anchor);
            }
        });
        // Day vote and Bomber target: note who is selected before the game logic runs,
        // then play the beat once it has finished.
        document.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest('#confirm-elimination-btn')) {
                var cb = document.querySelector('.elimination-checkbox:checked');
                if (!cb) return;
                var id = cb.dataset.playerId;
                var row = cb.closest('.elimination-player-item') || cb;
                var nameEl = row.querySelector('.player-name');
                var info = { id: id, rect: row.getBoundingClientRect(), name: nameEl ? nameEl.textContent : '', lover: !!loverProtecting(id) };
                setTimeout(function () {
                    var p = gameState.players.find(function (x) { return x.id === info.id; });
                    if (info.lover) beatHeart(null, false);
                    else if (p && !p.isAlive) beatGhost(info);
                }, 0);
            } else if (t.closest('.bomber-kill-btn')) {
                setTimeout(beatBomber, 0);
            }
        }, true);
    }

    // ---------- Winner ----------
    function winnerIntro() {
        var el = $('screen-winner');
        if (!el) return;
        el.classList.remove('scene-intro');
        void el.offsetWidth;
        el.classList.add('scene-intro');
    }
    function smoke(on) {
        var layer = $('scene-smoke');
        if (!layer) return;
        if (!on) { layer.innerHTML = ''; return; }
        if (layer.childElementCount || reduced()) return;
        for (var i = 0; i < 7; i++) {
            var s = document.createElement('div');
            s.className = 'scene-smoke';
            s.style.cssText = 'left:' + r2(rand(8, 92)) + '%;--t:' + r2(rand(8, 12)) + 's;--dl:' + r2(rand(0.4, 7)) + 's';
            layer.appendChild(s);
        }
    }
    function motes(container, n) {
        for (var i = 0; i < n; i++) {
            var m = document.createElement('span');
            var s = r2(rand(3, 7));
            m.className = 'scene-mote';
            m.style.cssText = 'left:' + r2(rand(3, 97)) + '%;width:' + s + 'px;height:' + s + 'px;--t:' + r2(rand(6, 10)) +
                's;--dl:' + r2(rand(0.8, 7)) + 's;--dx:' + Math.round(rand(-40, 40)) + 'px';
            container.appendChild(m);
        }
    }
    function confetti(container, n) {
        var cols = ['#8b5cf6', '#a855f7', '#6d28d9', '#c4b5fd', '#d4b84a', '#f0dc88'];
        for (var i = 0; i < n; i++) {
            var c = document.createElement('span');
            var t = rand(3.6, 6), dl = rand(0, 0.9);
            c.className = 'scene-confetti';
            c.style.cssText = 'left:' + r2(rand(2, 98)) + '%;background:' + cols[i % cols.length] + ';--t:' + r2(t) + 's;--dl:' + r2(dl) +
                's;--dx:' + Math.round(rand(-90, 90)) + 'px;--rot:' + Math.round(rand(360, 900) * (Math.random() < 0.5 ? -1 : 1)) + 'deg';
            container.appendChild(c);
            (function (el, life) { setTimeout(function () { el.remove(); }, life); })(c, (t + dl) * 1000 + 200);
        }
    }
    // Calm winner: one light confetti burst in the winning team's colours, nothing repeating.
    function winnerParticles(container) {
        if (!container) return;
        mount();
        container.innerHTML = '';
        if (reduced()) return;
        var b = document.body.classList;
        var cols = b.contains('winner-mafia') ? ['#e0434f', '#8b3a4a', '#c9a86c', '#f0dc88']
            : b.contains('winner-jester') ? ['#8b5cf6', '#c4b5fd', '#d4b84a', '#f0dc88']
                : ['#60a5fa', '#bfdbfe', '#d4b84a', '#f0dc88'];
        setTimeout(function () {
            for (var i = 0; i < 26; i++) {
                var c = document.createElement('span');
                var t = rand(2.2, 3.2), dl = rand(0, 0.35);
                c.className = 'scene-confetti calm';
                c.style.cssText = 'left:' + r2(rand(4, 96)) + '%;background:' + cols[i % cols.length] + ';--t:' + r2(t) + 's;--dl:' + r2(dl) +
                    's;--dx:' + Math.round(rand(-50, 50)) + 'px;--rot:' + Math.round(rand(180, 420) * (Math.random() < 0.5 ? -1 : 1)) + 'deg';
                container.appendChild(c);
                (function (el, life) { setTimeout(function () { el.remove(); }, life); })(c, (t + dl) * 1000 + 200);
            }
        }, 450);
        var cards = document.querySelectorAll('#screen-winner .final-role-item-winner');
        for (var k = 0; k < cards.length; k++) cards[k].style.setProperty('--wi', k);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();

    return { onScreen: onScreen, winnerParticles: winnerParticles, mount: mount, state: function () { return state; } };
})();

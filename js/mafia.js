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
    loverTargetId: null,
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

    // Role toggles
    const detToggle = document.getElementById('detective-toggle');
    const jesToggle = document.getElementById('jester-toggle');
    const bomToggle = document.getElementById('bomber-toggle');
    const lovToggle = document.getElementById('lover-toggle');
    if (detToggle) detToggle.onchange = (e) => toggleRole('detective', e.target.checked);
    if (jesToggle) jesToggle.onchange = (e) => toggleRole('jester', e.target.checked);
    if (bomToggle) bomToggle.onchange = (e) => toggleRole('bomber', e.target.checked);
    if (lovToggle) lovToggle.onchange = (e) => toggleRole('lover', e.target.checked);

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

function setupRulesModal() {
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
            ['detective', 'jester', 'bomber', 'lover'].forEach(role => {
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
    if (names.length === 0) {
        el.textContent = `Total: ${n} players — add names below`;
    } else {
        el.textContent = `Total: ${n} players — ${names.join(', ')}`;
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
    newValue = Math.max(0, Math.min(5, newValue));

    input.value = newValue;
    gameState.roleConfig.mafia = newValue;

    document.getElementById('decrease-mafia').disabled = (newValue <= 0);
    document.getElementById('increase-mafia').disabled = (newValue >= 5);

    updateRoleDistribution();
    saveMafiaToStorage();
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

    const startBtn = document.getElementById('start-game-btn');
    if (civilians < 1) {
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
    if (gameState.roleConfig.detective) roles.push('detective');
    if (gameState.roleConfig.jester) roles.push('jester');
    if (gameState.roleConfig.bomber) roles.push('bomber');
    if (gameState.roleConfig.lover) roles.push('lover');
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

    if (nextIndex >= gameState.viewingOrder.length) {
        nextPlayerSpan.textContent = 'Game Master';
    } else {
        const nextPlayerIdx = gameState.viewingOrder[nextIndex];
        const nextPlayer = gameState.players[nextPlayerIdx];
        nextPlayerSpan.textContent = nextPlayer.name;
    }
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
    const doctor = gameState.players.find(p => p.role === 'doctor' && p.isAlive);
    const instructions = [];
    instructions.push('🏙️ City goes to sleep! Eyes shut, no peeking!');
    instructions.push(`🔪 Mafia wake up! (${mafiaPlayers || '—'}) Choose your victim... Mafia, go to sleep.`);
    instructions.push(`😇 Doctor wake up! (${doctor ? doctor.name : '—'}) Who are we saving tonight? Doctor, go to sleep.`);

    const aliveDetective = gameState.players.find(p => p.role === 'detective' && p.isAlive);
    if (aliveDetective) {
        instructions.push(`🕵️ Detective wake up! (${aliveDetective.name}) Suspect someone... Detective, go to sleep.`);
    }

    const aliveLover = gameState.players.find(p => p.role === 'lover' && p.isAlive);
    const lovContainer = document.getElementById('lover-selection-container');

    if (aliveLover && gameState.currentRound === 1) {
        instructions.push(`💖 Lover wake up! (${aliveLover.name}) Blow a flying kiss... Lover, go to sleep.`);
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
    const lover = gameState.players.find(p => p.role === 'lover');

    gameState.players.filter(p => !lover || p.id !== lover.id).forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-outline btn-full';
        btn.textContent = p.name;
        btn.onclick = () => {
            gameState.loverTargetId = p.id;
            updateLoverSelectionHighlight(btn, container);
        };
        if (gameState.loverTargetId === p.id) {
            btn.classList.add('btn-primary');
            btn.classList.remove('btn-outline');
        }
        container.appendChild(btn);
    });
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
            const lover = gameState.players.find(pl => pl.role === 'lover');
            if (p.id === gameState.loverTargetId && lover && lover.isAlive) {
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
    const lover = gameState.players.find(p => p.role === 'lover');

    // LOVER SACRIFICE LOGIC
    if (id === gameState.loverTargetId && lover && lover.isAlive) {
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

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
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
    screens.forEach(s => {
        const el = document.getElementById(s);
        if (el) {
            if (s === id) { el.classList.remove('hidden'); el.classList.add('animate-fadeIn'); }
            else { el.classList.add('hidden'); }
        }
    });
}

function showElement(el) {
    if (typeof el === 'string') el = document.querySelector(el) || document.getElementById(el);
    if (el) el.classList.remove('hidden');
}

function hideElement(el) {
    if (typeof el === 'string') el = document.querySelector(el) || document.getElementById(el);
    if (el) el.classList.add('hidden');
}

function showGoldenParticles(container) {
    if (!container) return;
    const cols = ['#d4b84a', '#c9a82c', '#b8962a', '#e8d070', '#f0dc88'];
    const count = 45;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        const size = 4 + Math.random() * 6;
        const left = Math.random() * 100;
        const delay = Math.random() * 1.5;
        const duration = 8 + Math.random() * 4;
        p.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:${cols[i % cols.length]};left:${left}%;top:-30px;border-radius:50%;opacity:0.7;animation:mafiaGoldenFall ${duration}s ease-in ${delay}s forwards;`;
        container.appendChild(p);
        setTimeout(() => p.remove(), (duration + delay) * 1000);
    }
}

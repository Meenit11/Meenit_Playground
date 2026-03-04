// ================================
// UNDERCOVER - COMPLETE GAME LOGIC
// ================================

let gameState = {
    totalPlayers: 4,
    players: [],
    mrWhiteCount: 1,
    spiesCount: 0,
    agentsCount: 3,
    currentPlayerIndex: 0,
    agentWord: '',
    spyWord: '',
    wordPairs: [],
    playerRoles: [],
    alivePlayers: [],
    startPlayerIndex: 0,
    eliminatedMrWhite: null,
    selectedPlayerIndex: null,
    roundNumber: 1
};

// Load words from JSON
async function loadWords() {
    try {
        const response = await fetch('../words.json');
        const data = await response.json();
        gameState.wordPairs = data.word_pairs;
    } catch (error) {
        console.error('Error loading words:', error);
        gameState.wordPairs = [
            ["Coffee", "Tea"],
            ["Cat", "Dog"],
            ["Pizza", "Burger"]
        ];
    }
}

loadWords();

// DOM Elements
const playerCountDisplay = document.getElementById('player-count-display');
const playerNameInput = document.getElementById('player-name-input');
const playerList = document.getElementById('player-list');
const mrWhiteCountEl = document.getElementById('mrwhite-count');
const spiesCountEl = document.getElementById('spies-count');
const agentsCountEl = document.getElementById('agents-count');

const startGameBtn = document.getElementById('start-game-btn');
const rulesBtn = document.getElementById('rules-btn');
const resetStorageBtn = document.getElementById('reset-uc-storage-btn');
const rulesModal = document.getElementById('rules-modal');
const closeRulesBtn = document.getElementById('close-rules');
const modalOverlay = document.getElementById('modal-overlay');

const screenSetup = document.getElementById('screen-setup');
const screenRoleViewing = document.getElementById('screen-role-viewing');
const screenRoleDisplay = document.getElementById('screen-role-display');
const screenGameStart = document.getElementById('screen-game-start');
const screenElimination = document.getElementById('screen-elimination');
const screenRoleReveal = document.getElementById('screen-role-reveal');
const screenMrWhiteGuess = document.getElementById('screen-mrwhite-guess');
const screenGameOver = document.getElementById('screen-game-over');

// ================================
// PLAYER COUNT CONTROLS
// ================================
document.getElementById('decrease-players').addEventListener('click', () => {
    if (gameState.totalPlayers > 4) {
        gameState.totalPlayers--;
        updatePlayerCount();
        calculateAgents();
        savePlayersToStorage();
    }
});

document.getElementById('increase-players').addEventListener('click', () => {
    gameState.totalPlayers++;
    updatePlayerCount();
    calculateAgents();
    savePlayersToStorage();
});

function updatePlayerCount() {
    playerCountDisplay.textContent = gameState.totalPlayers;
    updatePlayersSummary();
}

function updatePlayersSummary() {
    const el = document.getElementById('players-summary');
    if (!el) return;
    const n = gameState.totalPlayers;
    const names = gameState.players;
    if (names.length === 0) {
        el.textContent = `Total: ${n} players — add names below`;
    } else {
        el.textContent = `Total: ${n} players — ${names.join(', ')}`;
    }
}

// ================================
// PLAYER NAME INPUT
// ================================
playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && playerNameInput.value.trim()) {
        addPlayer(playerNameInput.value.trim());
        playerNameInput.value = '';
    }
});

function addPlayer(name) {
    if (gameState.players.length < gameState.totalPlayers) {
        gameState.players.push(name);
        savePlayersToStorage();
        renderPlayerList();
    }
}

function removePlayer(index) {
    gameState.players.splice(index, 1);
    savePlayersToStorage();
    renderPlayerList();
}

function movePlayer(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= gameState.players.length) return;
    const temp = gameState.players[index];
    gameState.players[index] = gameState.players[newIndex];
    gameState.players[newIndex] = temp;
    savePlayersToStorage();
    renderPlayerList();
}

function savePlayersToStorage() {
    try {
        localStorage.setItem('uc_players', JSON.stringify(gameState.players));
        localStorage.setItem('uc_totalPlayers', gameState.totalPlayers);
        localStorage.setItem('uc_mrWhiteCount', gameState.mrWhiteCount);
        localStorage.setItem('uc_spiesCount', gameState.spiesCount);
    } catch (e) { /* ignore */ }
}

function loadPlayersFromStorage() {
    try {
        const saved = localStorage.getItem('uc_players');
        if (saved) gameState.players = JSON.parse(saved);
        const total = localStorage.getItem('uc_totalPlayers');
        if (total) gameState.totalPlayers = parseInt(total, 10);
        const mw = localStorage.getItem('uc_mrWhiteCount');
        if (mw !== null) gameState.mrWhiteCount = parseInt(mw, 10);
        const sp = localStorage.getItem('uc_spiesCount');
        if (sp !== null) gameState.spiesCount = parseInt(sp, 10);
    } catch (e) { /* ignore */ }
}

function renderPlayerList() {
    playerList.innerHTML = '';
    const total = gameState.players.length;
    gameState.players.forEach((name, index) => {
        const chip = document.createElement('div');
        chip.className = 'player-chip';
        chip.innerHTML = `
            <button class="move-btn" ${index === 0 ? 'disabled' : ''} data-dir="-1" data-idx="${index}">▲</button>
            <button class="move-btn" ${index === total - 1 ? 'disabled' : ''} data-dir="1" data-idx="${index}">▼</button>
            <span class="player-chip-name">${name}</span>
            <button class="remove-player" data-idx="${index}">×</button>
        `;
        chip.querySelector('.remove-player').addEventListener('click', () => removePlayer(index));
        chip.querySelectorAll('.move-btn').forEach(btn => {
            btn.addEventListener('click', () => movePlayer(parseInt(btn.dataset.idx), parseInt(btn.dataset.dir)));
        });
        playerList.appendChild(chip);
    });
    updatePlayersSummary();
}

window.removePlayer = removePlayer;

// ================================
// ROLE COUNT CONTROLS
// ================================
document.getElementById('decrease-mrwhite').addEventListener('click', () => {
    if (gameState.mrWhiteCount > 0) {
        gameState.mrWhiteCount--;
        updateRoleCounts();
        calculateAgents();
    }
});

document.getElementById('increase-mrwhite').addEventListener('click', () => {
    if (gameState.mrWhiteCount + gameState.spiesCount < gameState.totalPlayers - 1) {
        gameState.mrWhiteCount++;
        updateRoleCounts();
        calculateAgents();
    }
});

document.getElementById('decrease-spies').addEventListener('click', () => {
    if (gameState.spiesCount > 0) {
        gameState.spiesCount--;
        updateRoleCounts();
        calculateAgents();
    }
});

document.getElementById('increase-spies').addEventListener('click', () => {
    if (gameState.mrWhiteCount + gameState.spiesCount < gameState.totalPlayers - 1) {
        gameState.spiesCount++;
        updateRoleCounts();
        calculateAgents();
    }
});

function updateRoleCounts() {
    mrWhiteCountEl.textContent = gameState.mrWhiteCount;
    spiesCountEl.textContent = gameState.spiesCount;
    savePlayersToStorage();
}

function calculateAgents() {
    gameState.agentsCount = gameState.totalPlayers - gameState.mrWhiteCount - gameState.spiesCount;
    agentsCountEl.textContent = gameState.agentsCount;

    if (gameState.agentsCount <= (gameState.mrWhiteCount + gameState.spiesCount)) {
        const minAgents = gameState.mrWhiteCount + gameState.spiesCount + 1;
        gameState.totalPlayers = minAgents + gameState.mrWhiteCount + gameState.spiesCount;
        updatePlayerCount();
        calculateAgents();
    }
}

// ================================
// RULES MODAL
// ================================
rulesBtn.addEventListener('click', () => {
    rulesModal.classList.remove('hidden');
});

if (resetStorageBtn) {
    resetStorageBtn.addEventListener('click', () => {
        try {
            localStorage.removeItem('uc_players');
            localStorage.removeItem('uc_totalPlayers');
            localStorage.removeItem('uc_mrWhiteCount');
            localStorage.removeItem('uc_spiesCount');
            localStorage.removeItem('uc_usedPairs');
        } catch (e) { /* ignore */ }
        location.reload();
    });
}

closeRulesBtn.addEventListener('click', () => {
    rulesModal.classList.add('hidden');
});

modalOverlay.addEventListener('click', () => {
    rulesModal.classList.add('hidden');
});

// ================================
// START GAME
// ================================
startGameBtn.addEventListener('click', () => {
    if (gameState.players.length !== gameState.totalPlayers) {
        alert(`Please add exactly ${gameState.totalPlayers} player names!`);
        return;
    }

    if (gameState.mrWhiteCount === 0 && gameState.spiesCount === 0) {
        alert('You need at least 1 Mr. White OR 1 Spy!');
        return;
    }

    if (gameState.agentsCount <= (gameState.mrWhiteCount + gameState.spiesCount)) {
        alert('Agents must be greater than Spy + Mr. White combined!');
        return;
    }

    assignRoles();
    showRoleViewing();
});

// ================================
// ROLE ASSIGNMENT
// ================================
function assignRoles() {
    // Word pair selection with cooldown
    const available = getAvailablePairs();
    const chosen = available[Math.floor(Math.random() * available.length)];
    markPairUsed(chosen.idx);

    // Randomly swap which word is agent vs spy
    if (Math.random() < 0.5) {
        gameState.agentWord = chosen.pair[0];
        gameState.spyWord = chosen.pair[1];
    } else {
        gameState.agentWord = chosen.pair[1];
        gameState.spyWord = chosen.pair[0];
    }

    // Create roles array
    const roles = [];
    for (let i = 0; i < gameState.mrWhiteCount; i++) roles.push('Mr. White');
    for (let i = 0; i < gameState.spiesCount; i++) roles.push('Spy');
    for (let i = 0; i < gameState.agentsCount; i++) roles.push('Agent');

    // Fisher-Yates shuffle for proper randomization
    const shuffledRoles = fisherYatesShuffle([...roles]);

    // Assign shuffled roles to players in order
    gameState.playerRoles = gameState.players.map((name, index) => {
        const actualRole = shuffledRoles[index];
        let word, displayRole;

        if (actualRole === 'Mr. White') {
            displayRole = 'Mr. White';
            word = null;
        } else if (actualRole === 'Spy') {
            displayRole = 'Spy / Agent';
            word = gameState.spyWord;
        } else {
            displayRole = 'Spy / Agent';
            word = gameState.agentWord;
        }

        return { name, actualRole, displayRole, word, isAlive: true };
    });

    // Select random starting player
    gameState.startPlayerIndex = Math.floor(Math.random() * gameState.playerRoles.length);
    gameState.currentPlayerIndex = 0;
    gameState.alivePlayers = [...gameState.playerRoles];
    gameState.roundNumber = 1;
}

// Fisher-Yates (Knuth) shuffle — unbiased
function fisherYatesShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Word pair cooldown system — avoids repeating pairs for 2 hours
function getAvailablePairs() {
    const now = Date.now();
    const COOLDOWN = 2 * 60 * 60 * 1000; // 2 hours
    let used = [];
    try {
        used = JSON.parse(localStorage.getItem('uc_usedPairs') || '[]');
    } catch (e) { used = []; }
    // Remove expired cooldowns
    used = used.filter(entry => (now - entry.time) < COOLDOWN);
    try {
        localStorage.setItem('uc_usedPairs', JSON.stringify(used));
    } catch (e) { /* ignore */ }

    const usedIndices = new Set(used.map(e => e.idx));
    const available = gameState.wordPairs
        .map((pair, idx) => ({ pair, idx }))
        .filter(item => !usedIndices.has(item.idx));

    // If all pairs are on cooldown, reset and return all
    if (available.length === 0) {
        try { localStorage.removeItem('uc_usedPairs'); } catch (e) { }
        return gameState.wordPairs.map((pair, idx) => ({ pair, idx }));
    }
    return available;
}

function markPairUsed(idx) {
    let used = [];
    try {
        used = JSON.parse(localStorage.getItem('uc_usedPairs') || '[]');
    } catch (e) { used = []; }
    used.push({ idx, time: Date.now() });
    try {
        localStorage.setItem('uc_usedPairs', JSON.stringify(used));
    } catch (e) { /* ignore */ }
}

// ================================
// SEQUENTIAL ROLE VIEWING
// ================================
function showRoleViewing() {
    hideAllScreens();
    setUndercoverTheme('uc-theme-role-view');
    screenRoleViewing.classList.remove('hidden');

    // Calculate actual player index in sequential order
    // If startPlayerIndex = 3 (player 4) and currentPlayerIndex = 0, show player 4
    // If startPlayerIndex = 3 and currentPlayerIndex = 1, show player 5
    // If startPlayerIndex = 3 and currentPlayerIndex = 3, show player 1 (wraps around)
    const totalPlayers = gameState.playerRoles.length;
    const actualIndex = (gameState.startPlayerIndex + gameState.currentPlayerIndex) % totalPlayers;

    const nextViewerName = document.getElementById('next-viewer-name');
    nextViewerName.textContent = gameState.playerRoles[actualIndex].name;
}

document.getElementById('reveal-role-btn').addEventListener('click', () => {
    showRoleDisplay();
});

function showRoleDisplay() {
    hideAllScreens();
    setUndercoverTheme('uc-theme-role-display');
    screenRoleDisplay.classList.remove('hidden');

    const totalPlayers = gameState.playerRoles.length;
    const actualIndex = (gameState.startPlayerIndex + gameState.currentPlayerIndex) % totalPlayers;
    const currentPlayer = gameState.playerRoles[actualIndex];

    const roleImage = document.getElementById('role-image');
    const roleNameDisplay = document.getElementById('role-name-display');
    const roleDescription = document.getElementById('role-description');
    const wordDisplay = document.getElementById('word-display');
    const playerWord = document.getElementById('player-word');
    const nextPlayerBtn = document.getElementById('next-player-btn');
    const nextPlayerName = document.getElementById('next-player-name');

    if (currentPlayer.actualRole === 'Mr. White') {
        roleImage.src = '../images/Mr. White.png';
        roleNameDisplay.textContent = "You're Mr. White";
        roleDescription.textContent = "You are Mr. White. Blend in and guess the word!";
        wordDisplay.style.display = 'none';
    } else {
        roleImage.src = '../images/Spy Agent.png';
        roleNameDisplay.textContent = "Agent / Spy";
        roleDescription.textContent = "You may be Agent or Spy. Be clever!";
        wordDisplay.style.display = 'block';
        playerWord.textContent = currentPlayer.word;
    }

    // Update next button
    if (gameState.currentPlayerIndex < gameState.playerRoles.length - 1) {
        const nextIndex = (gameState.startPlayerIndex + gameState.currentPlayerIndex + 1) % totalPlayers;
        nextPlayerName.textContent = gameState.playerRoles[nextIndex].name;
    } else {
        nextPlayerName.textContent = 'Game Master';
    }
}

document.getElementById('next-player-btn').addEventListener('click', () => {
    gameState.currentPlayerIndex++;

    if (gameState.currentPlayerIndex < gameState.playerRoles.length) {
        showRoleViewing();
    } else {
        showGameStart();
    }
});

// ================================
// GAME START - NEW RANDOM SPEAKER EACH ROUND
// ================================
function showGameStart() {
    hideAllScreens();
    setUndercoverTheme('uc-theme-speaking');
    screenGameStart.classList.remove('hidden');

    // Show round number (incremented when coming from elimination flow)
    const roundEl = document.getElementById('game-round-badge');
    if (roundEl) roundEl.textContent = 'Round ' + gameState.roundNumber;

    // Pick a new random speaker from all alive players for this round
    const randomIndex = Math.floor(Math.random() * gameState.alivePlayers.length);
    const currentSpeaker = gameState.alivePlayers[randomIndex].name;

    document.getElementById('current-speaker-name').textContent = currentSpeaker;
}

// ================================
// ELIMINATION - SELECT THEN ELIMINATE
// ================================
document.getElementById('eliminate-btn').addEventListener('click', () => {
    showEliminationScreen();
});

function showEliminationScreen() {
    hideAllScreens();
    setUndercoverTheme('uc-theme-elimination');
    screenElimination.classList.remove('hidden');
    gameState.selectedPlayerIndex = null;

    const eliminationList = document.getElementById('player-elimination-list');
    const confirmBtn = document.getElementById('confirm-eliminate-btn');
    confirmBtn.disabled = true;

    eliminationList.innerHTML = '';

    gameState.alivePlayers.forEach((player, index) => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'elimination-player';
        playerDiv.innerHTML = `<span class="elimination-player-name">${player.name}</span>`;
        playerDiv.addEventListener('click', () => selectPlayerForElimination(index, playerDiv));
        eliminationList.appendChild(playerDiv);
    });
}

function selectPlayerForElimination(index, element) {
    // Remove previous selection
    document.querySelectorAll('.elimination-player').forEach(el => {
        el.classList.remove('selected');
    });

    // Select this player
    element.classList.add('selected');
    gameState.selectedPlayerIndex = index;

    // Enable eliminate button
    document.getElementById('confirm-eliminate-btn').disabled = false;
}

document.getElementById('confirm-eliminate-btn').addEventListener('click', () => {
    if (gameState.selectedPlayerIndex !== null) {
        eliminatePlayer(gameState.selectedPlayerIndex);
    }
});

function eliminatePlayer(index) {
    const eliminatedPlayer = gameState.alivePlayers[index];
    gameState.alivePlayers.splice(index, 1);

    showRoleReveal(eliminatedPlayer);
}

// ================================
// ROLE REVEAL AFTER ELIMINATION
// ================================
function showRoleReveal(player) {
    hideAllScreens();
    setUndercoverTheme('uc-theme-speaking');
    document.body.classList.remove('uc-reveal-mrwhite', 'uc-reveal-agent', 'uc-reveal-spy');
    screenRoleReveal.classList.remove('hidden');

    document.getElementById('eliminated-player-name').textContent = player.name;
    document.getElementById('eliminated-role-image').src = `../images/${player.actualRole}.png`;
    document.getElementById('eliminated-role-name').textContent = player.actualRole;

    if (player.actualRole === 'Mr. White') {
        gameState.eliminatedMrWhite = player;
    }
}

document.getElementById('continue-after-elimination-btn').addEventListener('click', () => {
    if (gameState.eliminatedMrWhite) {
        showMrWhiteGuess();
        return;
    }

    checkWinConditions();
});

// ================================
// MR. WHITE GUESS
// ================================
function showMrWhiteGuess() {
    hideAllScreens();
    setUndercoverTheme('uc-theme-guess');
    screenMrWhiteGuess.classList.remove('hidden');

    document.getElementById('mrwhite-guess-input').value = '';
}

document.getElementById('submit-guess-btn').addEventListener('click', () => {
    const guess = document.getElementById('mrwhite-guess-input').value.trim().toLowerCase();

    // If at least one Agent is alive, Mr. White must guess the Agent word; if no Agents remain but a Spy is alive, guess the Spy word
    const aliveAgents = gameState.alivePlayers.filter(p => p.actualRole === 'Agent');
    const wordToGuess = aliveAgents.length >= 1 ? gameState.agentWord : gameState.spyWord;

    if (guess === wordToGuess.toLowerCase()) {
        showGameOver('Mr. White Wins!', 'Mr. White correctly guessed the word upon elimination!', 'mrwhite');
    } else {
        gameState.eliminatedMrWhite = null;
        checkWinConditions();
    }
});

// ================================
// WIN CONDITIONS
// ================================
function checkWinConditions() {
    const aliveAgents = gameState.alivePlayers.filter(p => p.actualRole === 'Agent');
    const aliveSpies = gameState.alivePlayers.filter(p => p.actualRole === 'Spy');
    const aliveMrWhite = gameState.alivePlayers.filter(p => p.actualRole === 'Mr. White');
    const totalAlive = gameState.alivePlayers.length;

    // 1. Only Mr. White remain (2 or 3 players) — they all win (they didn't get eliminated)
    if (aliveAgents.length === 0 && aliveSpies.length === 0 && aliveMrWhite.length >= 1) {
        showGameOver('Mr. White Wins!', 'All remaining players are Mr. White — they didn\'t get eliminated!', 'mrwhite');
        // 2. Exactly 2 players left: Agent + Spy → Spy wins
        return;
    }

    if (totalAlive === 2 && aliveAgents.length === 1 && aliveSpies.length === 1) {
        // 3. Exactly 2 players left: Mr. White + Agent (or Mr. White + Spy) → Mr. White wins automatically
        showGameOver('Spy Wins!', 'Spy wins in a 1 vs 1!', 'spy');
        return;
    }

    // 4. Agents win: all Spies and all Mr. White eliminated (only Agents remain)
    if (totalAlive === 2 && aliveMrWhite.length === 1) {
        showGameOver('Mr. White Wins!', 'Mr. White wins — only one opponent left!', 'mrwhite');
        return;
    }
    // 5. Spies win: all Mr. White eliminated AND Spy parity (living Spies >= living Agents)

    if (aliveSpies.length === 0 && aliveMrWhite.length === 0) {
        showGameOver('Agents Win!', 'All Spies and Mr. White have been eliminated!', 'agents');
        return;
    }

    if (aliveMrWhite.length === 0 && aliveSpies.length >= aliveAgents.length) {
        showGameOver('Spies Win!', 'All Mr. White are out and Spies have parity or more!', 'spies');
        return;
    }

    // Continue game (Mr. White solo win by correct guess is handled in showMrWhiteGuess)
    gameState.eliminatedMrWhite = null;
    gameState.roundNumber = (gameState.roundNumber || 1) + 1;
    showGameStart();
}

// ================================
// GAME OVER WITH CONFETTI
// ================================
function showGameOver(title, message, winnerType) {
    hideAllScreens();
    setUndercoverTheme('uc-theme-gameover');
    document.body.classList.remove('uc-winner-agents', 'uc-winner-spies', 'uc-winner-mrwhite');
    if (winnerType === 'agents') document.body.classList.add('uc-winner-agents');
    else if (winnerType === 'spy' || winnerType === 'spies') document.body.classList.add('uc-winner-spies');
    else if (winnerType === 'mrwhite') document.body.classList.add('uc-winner-mrwhite');
    screenGameOver.classList.remove('hidden');

    document.getElementById('winner-title').textContent = title;
    document.getElementById('reveal-agent-word').textContent = gameState.agentWord || '';
    document.getElementById('reveal-spy-word').textContent = gameState.spyWord || '';

    const listEl = document.getElementById('winner-players-list');
    listEl.innerHTML = '';
    let playersToShow = [];
    if (winnerType === 'agents') playersToShow = (gameState.playerRoles || []).filter(p => p.actualRole === 'Agent');
    else if (winnerType === 'spy' || winnerType === 'spies') playersToShow = (gameState.playerRoles || []).filter(p => p.actualRole === 'Spy');
    else if (winnerType === 'mrwhite') playersToShow = (gameState.playerRoles || []).filter(p => p.actualRole === 'Mr. White');
    if (winnerType && playersToShow.length) {
        playersToShow.forEach(p => {
            const div = document.createElement('div');
            div.className = 'winner-player-item';
            div.innerHTML = `<img src="../images/${p.actualRole}.png" alt="${p.actualRole}" class="winner-role-img"><span class="winner-player-name">${p.name}</span>`;
            listEl.appendChild(div);
        });
    }

    createConfetti(winnerType);
}

function createConfetti(winnerType) {
    const container = document.getElementById('confetti-container');
    container.innerHTML = '';

    const colorSets = {
        agents: ['#8b6914', '#6b4a0a', '#a08020', '#5c4010'],
        spy: ['#2d2d2d', '#1a1a1a', '#404040', '#0d0d0d'],
        spies: ['#2d2d2d', '#1a1a1a', '#404040', '#0d0d0d'],
        mrwhite: ['#e8e8e8', '#f5f5f5', '#d0d0d0', '#ffffff']
    };
    const colors = colorSets[winnerType] || ['#d97706', '#b91c1c', '#fbbf24'];

    const count = 70;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        const size = 6 + Math.random() * 10;
        const left = Math.random() * 100;
        const delay = Math.random() * 0.6;
        p.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:${colors[i % colors.length]};left:${left}%;top:-20px;border-radius:2px;animation:ucPartyFall 3s ease-in ${delay}s forwards;`;
        container.appendChild(p);
        setTimeout(() => p.remove(), 3600);
    }
}

document.getElementById('play-again-btn').addEventListener('click', () => {
    location.reload();
});

document.getElementById('end-game-btn').addEventListener('click', () => {
    if (confirm('Are you sure you want to end the game?')) {
        location.reload();
    }
});

// ================================
// UTILITY
// ================================
function hideAllScreens() {
    [screenSetup, screenRoleViewing, screenRoleDisplay, screenGameStart,
        screenElimination, screenRoleReveal, screenMrWhiteGuess, screenGameOver].forEach(screen => {
            screen.classList.add('hidden');
        });
}

function setUndercoverTheme(theme) {
    document.body.classList.remove('uc-theme-setup', 'uc-theme-role-view', 'uc-theme-role-display', 'uc-theme-speaking', 'uc-theme-elimination', 'uc-theme-reveal', 'uc-theme-guess', 'uc-theme-gameover');
    if (theme) document.body.classList.add(theme);
}

// ================================
// INITIALIZE
// ================================
setUndercoverTheme('uc-theme-setup');
loadPlayersFromStorage();
updatePlayerCount();
updateRoleCounts();
calculateAgents();
renderPlayerList();

// ================================
// ODD ONE IN – Multi-device game via JSONBlob.com
// Each player on their own phone. Sync via shared JSON.
// No API key needed. Free & simple.
// ================================

// JSONBlob public API endpoint (no auth needed)
// Docs: https://api.jsonblob.com
const JSONBLOB_API = 'https://api.jsonblob.com/api/jsonBlob';

// Question cooldown window – prevent repeats for ~2 hours per device
const OOI_QUESTION_COOLDOWN_MS = 2 * 60 * 60 * 1000;

// Round theme palette (10 non-red, non-grey theme keys)
const OOI_ROUND_THEMES = [
  'ooi-theme-round-1',
  'ooi-theme-round-2',
  'ooi-theme-round-3',
  'ooi-theme-round-4',
  'ooi-theme-round-5',
  'ooi-theme-round-6',
  'ooi-theme-round-7',
  'ooi-theme-round-8',
  'ooi-theme-round-9',
  'ooi-theme-round-10',
];

let localState = {
  myName: '',
  myId: '',
  isGM: false,
  roomCode: '',
  blobId: '',     // JSONBlob ID for this room's data
  lastUpdate: 0,
  pollTimer: null,
  timerInterval: null,
  getReadyInterval: null,
};

let allQuestions = { tier1: [], tier2: [], tier3: [] };

// ================================
// INIT
// ================================
document.addEventListener('DOMContentLoaded', () => {
  loadQuestions();
  setupEventListeners();
  tryRejoin();
  // Default theme before joining / creating a room
  applyOddOneTheme(null);
});

async function loadQuestions() {
  try {
    const res = await fetch('../questions.json');
    const data = await res.json();
    allQuestions.tier1 = data.tier1_broad?.questions || [];
    allQuestions.tier2 = data.tier2_medium?.questions || [];
    allQuestions.tier3 = data.tier3_narrow?.questions || [];
  } catch (e) {
    console.error('Failed to load questions', e);
    allQuestions.tier1 = ['Name a fruit.', 'Name an animal.', 'Name a color.'];
    allQuestions.tier2 = ['Name a primary color.', 'Name a season.'];
    allQuestions.tier3 = ['What color is grass?', 'How many days in a week?'];
  }
}

function setupEventListeners() {
  // Mode select
  document.getElementById('create-room-btn').addEventListener('click', () => showScreen('screen-create'));
  document.getElementById('join-room-btn').addEventListener('click', () => showScreen('screen-join'));

  // Create room
  document.getElementById('do-create-btn').addEventListener('click', createRoom);
  document.getElementById('back-from-create-btn').addEventListener('click', () => showScreen('screen-mode-select'));
  document.getElementById('create-name-input').addEventListener('keypress', e => e.key === 'Enter' && createRoom());

  // Join room
  document.getElementById('do-join-btn').addEventListener('click', joinRoom);
  document.getElementById('back-from-join-btn').addEventListener('click', () => showScreen('screen-mode-select'));
  document.getElementById('join-name-input').addEventListener('keypress', e => e.key === 'Enter' && joinRoom());

  // Lobby
  document.getElementById('start-game-btn').addEventListener('click', gmStartGame);
  document.getElementById('leave-lobby-btn').addEventListener('click', leaveRoom);
  document.getElementById('share-whatsapp-btn').addEventListener('click', shareWhatsApp);
  document.getElementById('share-copy-btn').addEventListener('click', shareCopyLink);

  // Question
  document.getElementById('submit-answer-btn').addEventListener('click', submitAnswer);
  document.getElementById('answer-input').addEventListener('keypress', e => e.key === 'Enter' && submitAnswer());
  document.getElementById('gm-pause-btn').addEventListener('click', gmPause);
  document.getElementById('gm-reset-btn').addEventListener('click', gmReset);
  document.getElementById('gm-skip-btn').addEventListener('click', gmSkip);

  // Review
  document.getElementById('eliminate-selected-btn').addEventListener('click', eliminateSelected);
  document.getElementById('next-round-no-elim-btn').addEventListener('click', nextRoundNoElim);

  // Winner
  document.getElementById('play-again-btn').addEventListener('click', playAgain);

  // Reset saved data (cooldowns + session) from main mode-select screen
  const resetBtn = document.getElementById('reset-ooi-storage-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      try {
        clearSession();
        localStorage.removeItem('ooi_used_tier1_broad');
        localStorage.removeItem('ooi_used_tier2_medium');
        localStorage.removeItem('ooi_used_tier3_narrow');
      } catch (e) { /* ignore */ }
      applyOddOneTheme(null);
      showScreen('screen-mode-select');
      alert('Saved Odd One In data has been reset on this device.');
    });
  }

  // Rules modal (Game Setup)
  const rulesBtn = document.getElementById('rules-btn');
  const rulesModal = document.getElementById('rules-modal');
  const rulesOverlay = document.getElementById('ooi-rules-overlay');
  const closeRulesBtn = document.getElementById('close-rules');

  if (rulesBtn && rulesModal && rulesOverlay && closeRulesBtn) {
    rulesBtn.addEventListener('click', () => rulesModal.classList.remove('hidden'));
    closeRulesBtn.addEventListener('click', () => rulesModal.classList.add('hidden'));
    rulesOverlay.addEventListener('click', () => rulesModal.classList.add('hidden'));
  }

  // Auto-join from URL params (?blob=BLOBID)
  const params = new URLSearchParams(window.location.search);
  if (params.get('blob')) {
    document.getElementById('room-code-input').value = params.get('blob');
    showScreen('screen-join');
  }
}

// ================================
// SCREEN MANAGEMENT + THEMES
// ================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function applyOddOneTheme(roomData) {
  const body = document.body;
  if (!body) return;

  const allClasses = [
    'ooi-theme-setup',
    'ooi-theme-review',
    'ooi-theme-winner',
    'ooi-theme-round-1',
    'ooi-theme-round-2',
    'ooi-theme-round-3',
    'ooi-theme-round-4',
    'ooi-theme-round-5',
    'ooi-theme-round-6',
    'ooi-theme-round-7',
    'ooi-theme-round-8',
    'ooi-theme-round-9',
    'ooi-theme-round-10',
  ];

  allClasses.forEach(cls => body.classList.remove(cls));

  // Default when no room yet or in lobby/setup
  if (!roomData || roomData.gameState === 'lobby' || !roomData.gameState) {
    body.classList.add('ooi-theme-setup');
    return;
  }

  if (roomData.gameState === 'question') {
    const theme = roomData.roundTheme && OOI_ROUND_THEMES.includes(roomData.roundTheme)
      ? roomData.roundTheme
      : OOI_ROUND_THEMES[0];
    body.classList.add(theme);
    return;
  }

  if (roomData.gameState === 'review') {
    body.classList.add('ooi-theme-review');
    return;
  }

  if (roomData.gameState === 'winner') {
    body.classList.add('ooi-theme-winner');
  }
}

// ================================
// JSONBlob HELPERS (no API key!)
// ================================
async function createBlob(data) {
  const res = await fetch(JSONBLOB_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    console.error('JSONBlob create failed', res.status, res.statusText);
    throw new Error('Failed to create blob');
  }

  // JSONBlob may return the ID in different headers depending on deployment
  // Prefer the Location header, then fall back to x-blob-uuid/read-only hash.
  const location = res.headers.get('Location') || res.headers.get('location') || '';
  let blobId = location.split('/').pop();

  if (!blobId) {
    blobId =
      res.headers.get('x-blob-uuid') ||
      res.headers.get('X-Blob-UUID') ||
      res.headers.get('x-blob-read-only-hash') ||
      res.headers.get('X-Blob-Read-Only-Hash') ||
      '';
  }

  if (!blobId) {
    // As a final fallback, try to derive it from the response URL (if present)
    try {
      const url = res.url || '';
      blobId = url.split('/').pop() || '';
    } catch (_) {
      // ignore
    }
  }

  if (!blobId) {
    console.error('JSONBlob: no blob ID returned in headers or URL');
    throw new Error('No blob ID returned from JSON store');
  }

  return blobId;
}

async function readBlob(blobId) {
  const res = await fetch(`${JSONBLOB_API}/${blobId}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error('Failed to read blob');
  return await res.json();
}

async function updateBlob(blobId, data) {
  const res = await fetch(`${JSONBLOB_API}/${blobId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update blob');
}



// ================================
// ROOM MANAGEMENT
// ================================
function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generatePlayerId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function createRoom() {
  const name = document.getElementById('create-name-input').value.trim();
  if (name.length < 2) { showError('create-error', 'Name must be at least 2 characters'); return; }

  const btn = document.getElementById('do-create-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    localState.myName = name;
    localState.myId = generatePlayerId();
    localState.isGM = true;
    localState.roomCode = generateRoomCode();

    const roomData = buildFreshRoom(localState.roomCode, localState.myId, name);
    localState.blobId = await createBlob(roomData);

    saveSession();
    enterLobby(roomData);
  } catch (e) {
    showError('create-error', 'Failed to create room. Try again.');
    console.error(e);
  }

  btn.disabled = false;
  btn.textContent = 'Create Room';
}

function buildFreshRoom(code, gmId, gmName) {
  return {
    roomCode: code,
    gameMaster: gmId,
    players: [{ id: gmId, name: gmName, isGM: true, isEliminated: false }],
    gameState: 'lobby',
    currentRound: 0,
    currentQuestion: '',
    answers: {},
    selectedForElim: [],
    timerSeconds: 10,
    timerPaused: false,
    timerPhase: '', // getready, answering, done
    getReadyCountdown: 3,
    winnerNames: [],
    lastUpdate: Date.now(),
    roomActive: true,
  };
}

async function joinRoom() {
  const blobOrCode = document.getElementById('room-code-input').value.trim();
  const name = document.getElementById('join-name-input').value.trim();

  if (!blobOrCode) { showError('join-error', 'Enter the room ID from the share link'); return; }
  if (name.length < 2) { showError('join-error', 'Name must be at least 2 characters'); return; }

  const btn = document.getElementById('do-join-btn');
  btn.disabled = true;
  btn.textContent = 'Joining...';

  // The room-code-input now accepts the blob ID directly
  const blobId = blobOrCode;

  try {
    const roomData = await readBlob(blobId);
    if (!roomData.roomActive) {
      showError('join-error', 'Room is closed');
      btn.disabled = false; btn.textContent = 'Join Room'; return;
    }
    if (roomData.gameState !== 'lobby') {
      showError('join-error', 'Game in progress — cannot join');
      btn.disabled = false; btn.textContent = 'Join Room'; return;
    }
    if (roomData.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      showError('join-error', 'Name already taken!');
      btn.disabled = false; btn.textContent = 'Join Room'; return;
    }

    localState.myName = name;
    localState.myId = generatePlayerId();
    localState.isGM = false;
    localState.roomCode = roomData.roomCode || blobId.slice(-4);
    localState.blobId = blobId;

    roomData.players.push({ id: localState.myId, name: name, isGM: false, isEliminated: false });
    roomData.lastUpdate = Date.now();
    await updateBlob(blobId, roomData);

    saveSession();
    enterLobby(roomData);
  } catch (e) {
    showError('join-error', 'Room not found! Ask the host to share the link.');
    console.error(e);
  }

  btn.disabled = false;
  btn.textContent = 'Join Room';
}

// ================================
// SESSION PERSISTENCE (survive refresh)
// ================================
function saveSession() {
  localStorage.setItem('ooi_session', JSON.stringify({
    myName: localState.myName,
    myId: localState.myId,
    isGM: localState.isGM,
    roomCode: localState.roomCode,
    blobId: localState.blobId,
    lastSeenAt: Date.now(),
  }));
}

function clearSession() {
  localStorage.removeItem('ooi_session');
}

function tryRejoin() {
  try {
    const saved = JSON.parse(localStorage.getItem('ooi_session'));
    if (saved?.blobId) {
      const MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30 minutes
      if (saved.lastSeenAt && (Date.now() - saved.lastSeenAt) > MAX_SESSION_AGE_MS) {
        clearSession();
        return;
      }
      Object.assign(localState, saved);
      rejoinRoom();
    }
  } catch (e) { /* no session */ }
}

async function rejoinRoom() {
  try {
    const roomData = await readBlob(localState.blobId);
    if (!roomData.roomActive || roomData.gameState === 'winner') {
      // If room is closed or already finished, don't jump back into old state.
      clearSession();
      showScreen('screen-mode-select');
      applyOddOneTheme(null);
      return;
    }
    const me = roomData.players.find(p => p.id === localState.myId);
    if (!me) { clearSession(); return; }
    localState.isGM = me.isGM;
    routeToScreen(roomData);
    startPolling();
  } catch (e) {
    clearSession();
  }
}

// ================================
// LOBBY
// ================================
function enterLobby(roomData) {
  showScreen('screen-lobby');
  renderLobby(roomData);
  startPolling();
}

function renderLobby(roomData) {
  document.getElementById('lobby-room-code').textContent = roomData.roomCode;

  const count = roomData.players.length;
  document.getElementById('lobby-player-count').textContent = `${count} player${count !== 1 ? 's' : ''} in lobby`;

  const list = document.getElementById('lobby-player-list');
  list.innerHTML = '';
  roomData.players.forEach(p => {
    const item = document.createElement('div');
    item.className = 'lobby-player-item';
    let html = `<span class="lobby-player-name">${p.isGM ? '👑 ' : ''}${esc(p.name)}</span>`;
    if (localState.isGM && !p.isGM) {
      html += `<button class="lobby-kick-btn" data-id="${p.id}">❌</button>`;
    }
    item.innerHTML = html;
    list.appendChild(item);
  });

  // Kick handlers
  list.querySelectorAll('.lobby-kick-btn').forEach(btn => {
    btn.addEventListener('click', () => kickPlayer(btn.dataset.id));
  });

  const startBtn = document.getElementById('start-game-btn');
  const startHint = document.getElementById('start-game-hint');
  const waitMsg = document.getElementById('lobby-waiting');

  if (localState.isGM) {
    startBtn.classList.remove('hidden');
    startBtn.disabled = count < 3;
    startHint.textContent = count < 3 ? 'Need at least 3 players to start' : `${count} players ready!`;
    startHint.classList.remove('hidden');
    waitMsg.classList.add('hidden');
    document.getElementById('leave-lobby-btn').textContent = 'Close Room & Go Home';
  } else {
    startBtn.classList.add('hidden');
    startHint.classList.add('hidden');
    waitMsg.classList.remove('hidden');
    document.getElementById('leave-lobby-btn').textContent = 'Leave Room';
  }
}

async function kickPlayer(playerId) {
  try {
    const rd = await readBlob(localState.blobId);
    rd.players = rd.players.filter(p => p.id !== playerId);
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) { console.error(e); }
}

async function leaveRoom() {
  try {
    const rd = await readBlob(localState.blobId);
    if (localState.isGM) {
      rd.roomActive = false;
    } else {
      rd.players = rd.players.filter(p => p.id !== localState.myId);
    }
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) { /* best effort */ }
  stopPolling();
  clearSession();
  window.location.href = '../index.html';
}

function shareWhatsApp() {
  const url = `${window.location.origin}${window.location.pathname}?blob=${localState.blobId}`;
  const msg = `Join my Odd One In game! 🎮\nRoom: ${localState.roomCode}\nJoin here: ${url}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

function shareCopyLink() {
  const url = `${window.location.origin}${window.location.pathname}?blob=${localState.blobId}`;
  navigator.clipboard.writeText(url).then(() => {
    const fb = document.getElementById('copy-feedback');
    fb.classList.remove('hidden');
    setTimeout(() => fb.classList.add('hidden'), 2500);
  }).catch(() => {
    prompt('Copy this link:', url);
  });
}

// ================================
// GAME START (GM only)
// ================================
async function gmStartGame() {
  if (!localState.isGM) return;
  try {
    const rd = await readBlob(localState.blobId);
    if (rd.players.length < 3) return;

    const alive = rd.players.filter(p => !p.isEliminated);
    rd.gameState = 'question';
    rd.currentRound = 1;
    rd.answers = {};
    rd.selectedForElim = [];
    const picked = pickQuestion(alive.length);
    rd.currentQuestion = picked.question;
    rd.questionTier = picked.tierKey;
    rd.roundTheme = pickRoundTheme(rd);
    rd.timerSeconds = 10;
    rd.timerPaused = false;
    rd.timerPhase = 'getready';
    rd.getReadyCountdown = 3;
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) { console.error(e); }
}

function getAvailableQuestionsForTier(tierKey, pool) {
  const now = Date.now();
  let used = [];
  try {
    used = JSON.parse(localStorage.getItem(`ooi_used_${tierKey}`) || '[]');
  } catch (e) {
    used = [];
  }

  used = used.filter(entry => (now - entry.time) < OOI_QUESTION_COOLDOWN_MS);

  try {
    localStorage.setItem(`ooi_used_${tierKey}`, JSON.stringify(used));
  } catch (e) { /* ignore */ }

  const usedIndices = new Set(used.map(e => e.idx));
  let available = pool.map((q, idx) => ({ q, idx })).filter(item => !usedIndices.has(item.idx));

  // If everything is on cooldown, reset and allow full pool again
  if (!available.length) {
    try { localStorage.removeItem(`ooi_used_${tierKey}`); } catch (e) { /* ignore */ }
    available = pool.map((q, idx) => ({ q, idx }));
  }

  return available;
}

function markQuestionUsed(tierKey, idx) {
  let used = [];
  try {
    used = JSON.parse(localStorage.getItem(`ooi_used_${tierKey}`) || '[]');
  } catch (e) {
    used = [];
  }
  used.push({ idx, time: Date.now() });
  try {
    localStorage.setItem(`ooi_used_${tierKey}`, JSON.stringify(used));
  } catch (e) { /* ignore */ }
}

function pickQuestion(count) {
  let pool;
  let tierKey;
  if (count >= 10) {
    pool = allQuestions.tier1;
    tierKey = 'tier1_broad';
  } else if (count >= 5) {
    pool = allQuestions.tier2;
    tierKey = 'tier2_medium';
  } else {
    pool = allQuestions.tier3;
    tierKey = 'tier3_narrow';
  }

  if (!pool || !pool.length) {
    pool = allQuestions.tier1;
    tierKey = 'tier1_broad';
  }
  if (!pool || !pool.length) {
    return { question: 'Name something!', tierKey: 'fallback' };
  }

  const available = getAvailableQuestionsForTier(tierKey, pool);
  const choice = available[Math.floor(Math.random() * available.length)];
  markQuestionUsed(tierKey, choice.idx);

  return { question: choice.q, tierKey };
}

function pickRoundTheme(rd) {
  rd.usedRoundThemes = rd.usedRoundThemes || [];
  const usedSet = new Set(rd.usedRoundThemes);
  const remaining = OOI_ROUND_THEMES.filter(t => !usedSet.has(t));
  const pool = remaining.length ? remaining : OOI_ROUND_THEMES;
  const choice = pool[Math.floor(Math.random() * pool.length)];
  if (!usedSet.has(choice)) {
    rd.usedRoundThemes.push(choice);
  }
  return choice;
}

// ================================
// POLLING — Real-time sync
// ================================
function startPolling() {
  stopPolling();
  // Faster poll to reduce perceived latency for joins, pauses, and state changes.
  localState.pollTimer = setInterval(pollRoom, 900);
  pollRoom(); // immediate first poll
}

async function pollRoom() {
  try {
    const rd = await readBlob(localState.blobId);

    if (!rd.roomActive) {
      stopPolling(); clearSession();
      alert('Room has been closed by the Game Master.');
      showScreen('screen-mode-select'); return;
    }

    const me = rd.players.find(p => p.id === localState.myId);
    if (!me) {
      stopPolling(); clearSession();
      alert('You were removed from the room.');
      showScreen('screen-mode-select'); return;
    }

    if (rd.lastUpdate > localState.lastUpdate) {
      localState.lastUpdate = rd.lastUpdate;
      // Refresh last-seen timestamp so rejoin works across refreshes,
      // but still expires if you come back much later.
      saveSession();
      routeToScreen(rd);
    }
  } catch (e) { console.error('Poll error', e); }
}

function stopPolling() {
  if (localState.pollTimer) { clearInterval(localState.pollTimer); localState.pollTimer = null; }
  clearTimers();
}

function clearTimers() {
  if (localState.timerInterval) { clearInterval(localState.timerInterval); localState.timerInterval = null; }
  if (localState.getReadyInterval) { clearInterval(localState.getReadyInterval); localState.getReadyInterval = null; }
}

// ================================
// SCREEN ROUTING
// ================================
function routeToScreen(rd) {
  applyOddOneTheme(rd);
  switch (rd.gameState) {
    case 'lobby': showScreen('screen-lobby'); renderLobby(rd); break;
    case 'question': showScreen('screen-question'); renderQuestion(rd); break;
    case 'review': showScreen('screen-review'); renderReview(rd); break;
    case 'winner': showScreen('screen-winner'); renderWinner(rd); break;
  }
}

// ================================
// QUESTION ROUND
// ================================
function renderQuestion(rd) {
  document.getElementById('round-num').textContent = rd.currentRound;
  document.getElementById('question-text').textContent = rd.currentQuestion;

  const me = rd.players.find(p => p.id === localState.myId);
  const isEliminated = me?.isEliminated;
  const hasAnswered = rd.answers.hasOwnProperty(localState.myId);

  const getReadyEl = document.getElementById('get-ready-phase');
  const answerPhaseEl = document.getElementById('answer-phase');
  const answerSection = document.getElementById('answer-section');
  const submittedMsg = document.getElementById('answer-submitted-msg');
  const eliminatedMsg = document.getElementById('eliminated-msg');
  const gmControls = document.getElementById('gm-controls');
  const gmStatusMsg = document.getElementById('gm-status-msg');

  // Grey-out theme for eliminated players (spectator view)
  document.body.classList.toggle('ooi-eliminated-view', !!isEliminated);

  // Get Ready phase
  if (rd.timerPhase === 'getready') {
    getReadyEl.classList.remove('hidden');
    answerPhaseEl.classList.add('hidden');
    document.getElementById('get-ready-countdown').textContent = rd.getReadyCountdown || 3;

    // GM drives the countdown
    if (localState.isGM && !localState.getReadyInterval) {
      localState.getReadyInterval = setInterval(async () => {
        try {
          const d = await readBlob(localState.blobId);
          if (d.timerPhase !== 'getready') { clearInterval(localState.getReadyInterval); localState.getReadyInterval = null; return; }
          const current = typeof d.getReadyCountdown === 'number' ? d.getReadyCountdown : 3;
          if (current <= 1) {
            // After showing "1", immediately move to answering with a true ~3s feel.
            d.timerPhase = 'answering';
            d.timerSeconds = 10;
            d.getReadyCountdown = 0;
          } else {
            d.getReadyCountdown = current - 1;
          }
          d.lastUpdate = Date.now();
          await updateBlob(localState.blobId, d);
        } catch (e) { /* retry */ }
      }, 1000);
    }
    gmControls.classList.add('hidden');
    gmStatusMsg.classList.add('hidden');
    return;
  }

  // Answer phase
  getReadyEl.classList.add('hidden');
  answerPhaseEl.classList.remove('hidden');
  if (localState.getReadyInterval) { clearInterval(localState.getReadyInterval); localState.getReadyInterval = null; }

  // Timer
  const timerEl = document.getElementById('timer-display');
  timerEl.textContent = rd.timerSeconds;
  timerEl.classList.toggle('timer-urgent', rd.timerSeconds <= 3 && rd.timerSeconds > 0);
  timerEl.classList.toggle('timer-done', rd.timerSeconds <= 0);

  // Answer input state
  if (rd.timerPhase === 'done' || rd.timerSeconds <= 0) {
    answerSection.classList.add('hidden');
    submittedMsg.classList.remove('hidden');
    submittedMsg.querySelector('p').textContent = '⏰ Time\'s up!';
    eliminatedMsg.classList.add('hidden');
  } else if (isEliminated) {
    answerSection.classList.add('hidden');
    submittedMsg.classList.add('hidden');
    eliminatedMsg.classList.remove('hidden');
  } else if (hasAnswered) {
    answerSection.classList.add('hidden');
    submittedMsg.classList.remove('hidden');
    submittedMsg.querySelector('p').textContent = '✓ Answer Submitted';
    eliminatedMsg.classList.add('hidden');
  } else {
    answerSection.classList.remove('hidden');
    submittedMsg.classList.add('hidden');
    eliminatedMsg.classList.add('hidden');
    const inputEl = document.getElementById('answer-input');
    const submitBtn = document.getElementById('submit-answer-btn');
    if (inputEl) {
      inputEl.disabled = false;
      // Clear any previous round answer text when a new question starts.
      if (!hasAnswered) inputEl.value = '';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Answer';
    }
  }

  // GM controls
  if (localState.isGM) {
    gmControls.classList.remove('hidden');
    document.getElementById('gm-pause-btn').textContent = rd.timerPaused ? '▶️ Resume' : '⏸️ Pause';
  } else {
    gmControls.classList.add('hidden');
  }

  // Paused indicator
  if (rd.timerPaused) {
    gmStatusMsg.textContent = '⏸️ Timer paused by Game Master';
    gmStatusMsg.classList.remove('hidden');
  } else {
    gmStatusMsg.classList.add('hidden');
  }

  // GM drives the countdown timer
  if (localState.isGM && rd.timerPhase === 'answering' && !rd.timerPaused && !localState.timerInterval) {
    localState.timerInterval = setInterval(async () => {
      try {
        const d = await readBlob(localState.blobId);
        if (d.timerPhase !== 'answering' || d.timerPaused) {
          clearInterval(localState.timerInterval); localState.timerInterval = null; return;
        }
        d.timerSeconds = Math.max(0, d.timerSeconds - 1);
        if (d.timerSeconds <= 0) {
          d.timerPhase = 'done';
          // Auto-submit blanks
          d.players.forEach(p => {
            if (!p.isEliminated && !d.answers.hasOwnProperty(p.id)) {
              d.answers[p.id] = '';
            }
          });
          d.gameState = 'review';
          clearInterval(localState.timerInterval); localState.timerInterval = null;
        }
        d.lastUpdate = Date.now();
        await updateBlob(localState.blobId, d);
      } catch (e) { /* retry */ }
    }, 1000);
  }
}

async function submitAnswer() {
  const input = document.getElementById('answer-input');
  const answer = input.value.trim();
  input.disabled = true;
  document.getElementById('submit-answer-btn').disabled = true;
  document.getElementById('submit-answer-btn').textContent = 'Submitted ✓';

  try {
    const rd = await readBlob(localState.blobId);
    rd.answers[localState.myId] = answer;
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) {
    console.error(e);
    input.disabled = false;
    document.getElementById('submit-answer-btn').disabled = false;
    document.getElementById('submit-answer-btn').textContent = 'Submit Answer';
  }
}

// GM controls
async function gmPause() {
  try {
    const rd = await readBlob(localState.blobId);
    rd.timerPaused = !rd.timerPaused;
    if (rd.timerPaused) { clearInterval(localState.timerInterval); localState.timerInterval = null; }
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) { console.error(e); }
}

async function gmReset() {
  try {
    const rd = await readBlob(localState.blobId);
    rd.timerSeconds = 10;
    rd.timerPaused = false;
    rd.timerPhase = 'answering';
    rd.answers = {};
    clearInterval(localState.timerInterval); localState.timerInterval = null;
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) { console.error(e); }
}

async function gmSkip() {
  try {
    const rd = await readBlob(localState.blobId);
    rd.timerPhase = 'done';
    rd.timerSeconds = 0;
    rd.players.forEach(p => {
      if (!p.isEliminated && !rd.answers.hasOwnProperty(p.id)) rd.answers[p.id] = '';
    });
    rd.gameState = 'review';
    clearInterval(localState.timerInterval); localState.timerInterval = null;
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) { console.error(e); }
}

// ================================
// ANSWER REVIEW
// ================================
function renderReview(rd) {
  clearTimers();
  document.getElementById('review-round-num').textContent = rd.currentRound;

  const container = document.getElementById('answers-container');
  container.innerHTML = '';

  const alive = rd.players.filter(p => !p.isEliminated);
  const answerList = alive.map(p => ({
    id: p.id,
    name: p.name,
    answer: (rd.answers[p.id] || '').trim() || '(No Answer)',
  }));

  // Sort: blanks first, then by answer text
  answerList.sort((a, b) => {
    const aB = a.answer === '(No Answer)' ? 0 : 1;
    const bB = b.answer === '(No Answer)' ? 0 : 1;
    if (aB !== bB) return aB - bB;
    return a.answer.toLowerCase().localeCompare(b.answer.toLowerCase());
  });

  // Duplicate detection
  const counts = {};
  answerList.forEach(a => { const k = a.answer.toLowerCase(); counts[k] = (counts[k] || 0) + 1; });

  const selected = new Set(rd.selectedForElim || []);

  answerList.forEach(ans => {
    const isDup = counts[ans.answer.toLowerCase()] > 1 && ans.answer !== '(No Answer)';
    const isBlank = ans.answer === '(No Answer)';
    const isSel = selected.has(ans.id);

    const item = document.createElement('div');
    item.className = `answer-item${isDup ? ' answer-duplicate' : ''}${isBlank ? ' answer-blank' : ''}${isSel ? ' answer-selected' : ''}`;
    item.innerHTML = `
      <div class="ans-content">
        <span class="ans-text">${esc(ans.answer)}</span>
        <span class="ans-author">— ${esc(ans.name)}</span>
      </div>
    `;

    if (localState.isGM) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => toggleSelection(ans.id));
    }
    container.appendChild(item);
  });

  const elimControls = document.getElementById('elimination-controls');
  const subtitle = document.getElementById('review-subtitle');
  if (localState.isGM) {
    elimControls.classList.remove('hidden');
    subtitle.textContent = 'Tap answers to select, then eliminate or skip';
  } else {
    elimControls.classList.add('hidden');
    subtitle.textContent = 'Game Master is deciding...';
    // Show selections in real time
    if (selected.size > 0) {
      subtitle.textContent = `Game Master selected ${selected.size} player${selected.size > 1 ? 's' : ''}...`;
    }
  }
}

async function toggleSelection(playerId) {
  try {
    const rd = await readBlob(localState.blobId);
    rd.selectedForElim = rd.selectedForElim || [];
    const idx = rd.selectedForElim.indexOf(playerId);
    if (idx >= 0) rd.selectedForElim.splice(idx, 1);
    else rd.selectedForElim.push(playerId);
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) { console.error(e); }
}

async function eliminateSelected() {
  try {
    const rd = await readBlob(localState.blobId);
    if (!rd.selectedForElim || rd.selectedForElim.length === 0) {
      alert('Select at least one player to eliminate');
      return;
    }

    rd.selectedForElim.forEach(pid => {
      const p = rd.players.find(pl => pl.id === pid);
      if (p) p.isEliminated = true;
    });

    const alive = rd.players.filter(p => !p.isEliminated);
    if (alive.length <= 2) {
      rd.gameState = 'winner';
      rd.winnerNames = alive.map(p => p.name);
    } else {
      rd.currentRound++;
      rd.gameState = 'question';
      rd.answers = {};
      rd.selectedForElim = [];
      const picked = pickQuestion(alive.length);
      rd.currentQuestion = picked.question;
      rd.questionTier = picked.tierKey;
      rd.roundTheme = pickRoundTheme(rd);
      rd.timerSeconds = 10;
      rd.timerPaused = false;
      rd.timerPhase = 'getready';
      rd.getReadyCountdown = 3;
    }
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) { console.error(e); }
}

async function nextRoundNoElim() {
  try {
    const rd = await readBlob(localState.blobId);
    const alive = rd.players.filter(p => !p.isEliminated);
    rd.currentRound++;
    rd.gameState = 'question';
    rd.answers = {};
    rd.selectedForElim = [];
    const picked = pickQuestion(alive.length);
    rd.currentQuestion = picked.question;
    rd.questionTier = picked.tierKey;
    rd.roundTheme = pickRoundTheme(rd);
    rd.timerSeconds = 10;
    rd.timerPaused = false;
    rd.timerPhase = 'getready';
    rd.getReadyCountdown = 3;
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) { console.error(e); }
}

// ================================
// WINNER
// ================================
function renderWinner(rd) {
  clearTimers();
  const names = rd.winnerNames || [];
  document.getElementById('winner-name').textContent = names.length === 1 ? names[0] : names.join(' & ');

  const title = document.querySelector('#screen-winner .game-title');
  title.textContent = names.length <= 1 ? '🏆 Winner! 🏆' : '🏆 Winners! 🏆';

  spawnConfetti();

  document.getElementById('play-again-btn').classList.toggle('hidden', !localState.isGM);
}

function spawnConfetti() {
  const c = document.getElementById('confetti-container');
  c.innerHTML = '';
  const cols = ['#00d4aa', '#ff6b6b', '#ffd93d', '#6c5ce7', '#fd79a8', '#00b894', '#e17055'];
  for (let i = 0; i < 50; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + '%';
    p.style.backgroundColor = cols[Math.floor(Math.random() * cols.length)];
    p.style.animationDelay = Math.random() * 2 + 's';
    p.style.animationDuration = (2 + Math.random() * 2) + 's';
    c.appendChild(p);
  }
}

async function playAgain() {
  if (!localState.isGM) return;
  try {
    const rd = await readBlob(localState.blobId);
    // Close this room for everyone, then send all devices back to start.
    rd.roomActive = false;
    rd.lastUpdate = Date.now();
    await updateBlob(localState.blobId, rd);
  } catch (e) { console.error(e); }
  // Locally reset to the mode-select screen with fresh state.
  stopPolling();
  clearSession();
  applyOddOneTheme(null);
  showScreen('screen-mode-select');
}

// ================================
// UTILITIES
// ================================
function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

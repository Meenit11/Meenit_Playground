/**
 * Simple Odd One In API – in-memory room store.
 * Run: node server.js  (default port 3001)
 * Players on different phones use the same server URL (e.g. your machine's IP:3001).
 */
const http = require('http');

const PORT = process.env.PORT || 3001;
const rooms = new Map(); // code -> game state

function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generateId() {
  return Math.random().toString(36).substring(2, 9).toUpperCase();
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, status, data) {
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const router = {
  'POST /api/rooms': async (req, res, body) => {
    const { gmName, initialState } = body;
    if (!gmName || !String(gmName).trim()) {
      return send(res, 400, { error: 'gmName required' });
    }
    let code;
    do {
      code = generateCode();
    } while (rooms.has(code));
    
    const gmId = generateId();
    // If frontend provided a full state, use it (but update code and gmId)
    let state = initialState || {
      roomCode: code,
      gameMaster: gmId,
      players: [{ id: gmId, name: String(gmName).trim(), isGM: true, isEliminated: false }],
      gameState: 'lobby',
      currentRound: 0,
      currentQuestion: '',
      answers: {},
      selectedForElim: [],
      timerSeconds: 10,
      timerPaused: false,
      timerPhase: '',
      getReadyCountdown: 3,
      winnerNames: [],
      lastUpdate: Date.now(),
      roomActive: true,
    };
    
    // Ensure room code and GM are correct
    state.roomCode = code;
    state.gameId = code; // compatibility
    state.players[0].id = gmId;
    state.gameMaster = gmId;

    rooms.set(code, state);
    return send(res, 200, { code, state });
  },

  'GET /api/rooms/:code': (req, res, _body, code) => {
    const state = rooms.get(code);
    if (!state) return send(res, 404, { error: 'Game not found' });
    return send(res, 200, { state });
  },

  'POST /api/rooms/:code/join': async (req, res, body, code) => {
    const state = rooms.get(code);
    if (!state) return send(res, 404, { error: 'Game not found' });
    if (state.gameState !== 'lobby' && state.isStarted !== false) {
      return send(res, 400, { error: 'Game already started' });
    }
    const playerName = body.playerName ? String(body.playerName).trim() : '';
    if (!playerName) return send(res, 400, { error: 'playerName required' });
    
    const exists = state.players.some((p) => p.name.toLowerCase() === playerName.toLowerCase());
    if (exists) return send(res, 400, { error: 'Name already taken' });
    
    const id = generateId();
    state.players.push({ id, name: playerName, isGM: false, isEliminated: false });
    state.lastUpdate = Date.now();
    
    return send(res, 200, { playerId: id, state });
  },

  'POST /api/rooms/:code/state': async (req, res, body, code) => {
    const state = rooms.get(code);
    if (!state) return send(res, 404, { error: 'Game not found' });
    const { state: newState } = body;
    if (!newState) return send(res, 400, { error: 'Invalid state' });
    
    // Merge or replace
    newState.lastUpdate = Date.now();
    rooms.set(code, newState);
    return send(res, 200, { state: newState });
  },

  'POST /api/rooms/:code/answer': async (req, res, body, code) => {
    const state = rooms.get(code);
    if (!state) return send(res, 404, { error: 'Game not found' });
    const { playerId, answer } = body;
    if (!playerId) return send(res, 400, { error: 'playerId required' });
    
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return send(res, 400, { error: 'Player not in game' });
    
    // Support both answers object and answers array
    if (Array.isArray(state.answers)) {
       if (!state.answers.some((a) => a.playerId === playerId)) {
         state.answers.push({
           playerId,
           playerName: player.name,
           answer: String(answer || '').trim(),
         });
       }
    } else {
       // Object format used by odd-one-in.js
       state.answers = state.answers || {};
       state.answers[playerId] = String(answer || '').trim();
    }
    
    state.lastUpdate = Date.now();
    return send(res, 200, { state });
  },
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = (req.url || '').split('?')[0];
  const body = await parseBody(req);

  // Improved routing
  const parts = url.split('/').filter(Boolean); // e.g. ["api", "rooms", "CODE", "join"]
  
  let path = `${req.method} /${parts.join('/')}`;
  let code = null;

  if (parts[0] === 'api' && parts[1] === 'rooms') {
    if (parts.length === 2) {
      path = `${req.method} /api/rooms`;
    } else if (parts.length >= 3) {
      code = parts[2];
      const action = parts[3];
      if (action) {
        path = `${req.method} /api/rooms/:code/${action}`;
      } else {
        path = `${req.method} /api/rooms/:code`;
      }
    }
  }

  const handler = router[path];
  if (handler) {
    try {
      await handler(req, res, body, code);
    } catch (e) {
      console.error('Handler error:', e);
      send(res, 500, { error: 'Server error' });
    }
    return;
  }

  console.log(`No handler for: ${path}`);
  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Odd One In API running at http://localhost:${PORT}`);
});

/**
 * Simple Odd One In API – in-memory room store.
 * Run: node server.js  (default port 3001)
 * Players on different phones use the same server URL (e.g. your machine's IP:3001).
 */
const http = require('http');

const PORT = process.env.PORT || 3001;
const rooms = new Map(); // code -> game state

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
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
    const { gmName } = body;
    if (!gmName || !String(gmName).trim()) {
      return send(res, 400, { error: 'gmName required' });
    }
    let code;
    do {
      code = generateCode();
    } while (rooms.has(code));
    const gmId = generateId();
    const state = {
      gameId: code,
      gmId,
      players: [{ id: gmId, name: String(gmName).trim(), isGM: true, isEliminated: false }],
      currentRound: 1,
      currentQuestion: '',
      answers: [],
      usedQuestions: [],
      isStarted: false,
      timerState: 'idle',
      timerValue: 10,
      eliminatedIds: [],
    };
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
    if (state.isStarted) return send(res, 400, { error: 'Game already started' });
    const playerName = body.playerName ? String(body.playerName).trim() : '';
    if (!playerName) return send(res, 400, { error: 'playerName required' });
    const exists = state.players.some((p) => p.name.toLowerCase() === playerName.toLowerCase());
    if (exists) return send(res, 400, { error: 'Name already taken' });
    const id = generateId();
    state.players.push({ id, name: playerName, isGM: false, isEliminated: false });
    return send(res, 200, { playerId: id, state });
  },

  'POST /api/rooms/:code/state': async (req, res, body, code) => {
    const state = rooms.get(code);
    if (!state) return send(res, 404, { error: 'Game not found' });
    const { state: newState } = body;
    if (!newState || newState.gameId !== code) return send(res, 400, { error: 'Invalid state' });
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
    if (state.answers.some((a) => a.playerId === playerId)) return send(res, 200, { state });
    state.answers.push({
      playerId,
      playerName: player.name,
      answer: String(answer || '').trim(),
    });
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
  const match = url.match(/^\/api\/rooms(?:\/([A-Z0-9]{6}))?$/);
  const code = match && match[1] ? match[1] : null;
  const path = code != null ? `${req.method} /api/rooms/:code` : `${req.method} /api/rooms`;
  const handler = router[path];
  if (handler) {
    try {
      await handler(req, res, body, code);
    } catch (e) {
      send(res, 500, { error: 'Server error' });
    }
    return;
  }
  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Odd One In API running at http://localhost:${PORT}`);
});

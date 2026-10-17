'use strict';
/**
 * Meenit's Playground room server.
 *
 * Run:  node server.js            (PORT defaults to 3001)
 * Env:  PORT, PG_DATA_FILE (default ./data/rooms.json), PG_LOG=0 to silence
 *
 * REST and WebSocket interface: see PROTOCOL.md section 2.
 * Game rules: ./games/<game>.js (PROTOCOL.md section 3).
 *
 * Exports createApp() so tests can boot the whole server in-process on a
 * random port and reboot it against the same data file.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createEngine, HttpError, CODE_RE, PLAYER_ID_RE } = require('./engine');

const BODY_LIMIT = 64 * 1024; // bytes
const WS_HEARTBEAT_MS = 30 * 1000;
const PKG_VERSION = require('./package.json').version;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** Split req.url into a normalised pathname and URLSearchParams. */
function parseUrl(rawUrl) {
  const [rawPath, rawQuery = ''] = String(rawUrl || '/').split('?', 2);
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  pathname = pathname.replace(/\/+$/, '') || '/';
  return { pathname, query: new URLSearchParams(rawQuery) };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = Number(req.headers['content-length']) > BODY_LIMIT;
    const fail = (err) => { tooLarge = true; chunks.length = 0; reject(err); };
    if (tooLarge) reject(new HttpError(413, 'Request too large'));
    req.on('data', (chunk) => {
      if (tooLarge) return; // keep draining so the client gets the 413 instead of a reset socket
      size += chunk.length;
      if (size > BODY_LIMIT) return fail(new HttpError(413, 'Request too large'));
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new HttpError(400, 'Request body must be a JSON object'));
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'Request failed')));
  });
}

function createApp(options = {}) {
  const log = options.log || ((...a) => console.log(new Date().toISOString(), ...a));
  const engine = createEngine({ ...options, log });
  const startedAt = Date.now();

  // ---------- routes ----------
  const routes = [
    {
      method: 'GET', pattern: /^\/$/,
      handle: () => [200, { ok: true, name: "Meenit's Playground server", version: PKG_VERSION }],
    },
    {
      method: 'GET', pattern: /^\/api\/health$/,
      handle: () => [200, { ok: true, uptime: Math.round((Date.now() - startedAt) / 1000), rooms: engine.roomCount, version: PKG_VERSION }],
    },
    {
      method: 'POST', pattern: /^\/api\/rooms$/,
      handle: ({ body }) => [201, engine.createRoom({ game: body.game, hostName: body.hostName, settings: body.settings })],
    },
    {
      method: 'POST', pattern: /^\/api\/rooms\/(\d{4})\/join$/,
      handle: ({ body, params }) => [200, engine.join(params[0], { name: body.name, playerId: body.playerId })],
    },
    {
      method: 'GET', pattern: /^\/api\/rooms\/(\d{4})$/,
      handle: ({ params, query }) => [200, { state: engine.getView(params[0], query.get('playerId')) }],
    },
    {
      method: 'POST', pattern: /^\/api\/rooms\/(\d{4})\/action$/,
      handle: ({ body, params }) => [200, { state: engine.action(params[0], body.playerId, body.type, body.payload) }],
    },
    {
      method: 'POST', pattern: /^\/api\/rooms\/(\d{4})\/leave$/,
      handle: ({ body, params }) => [200, engine.leave(params[0], body.playerId)],
    },
  ];

  async function handleRequest(req, res) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    const parsed = parseUrl(req.url);
    if (!parsed) return sendJson(res, 400, { error: 'Bad request' });
    const { pathname, query } = parsed;
    if (STATIC_DIR && pathname === '/' && (req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, '/')) return;
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    let matchedPath = false;
    for (const route of routes) {
      const m = pathname.match(route.pattern);
      if (!m) continue;
      matchedPath = true;
      if (route.method !== method) continue;
      try {
        const body = method === 'POST' ? await readBody(req) : {};
        const [status, data] = route.handle({ body, params: m.slice(1), query, req });
        if (req.method === 'HEAD') {
          res.writeHead(status, CORS_HEADERS);
          return res.end();
        }
        return sendJson(res, status, data);
      } catch (e) {
        if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
        log('unhandled error', req.method, pathname, e);
        return sendJson(res, 500, { error: 'Something went wrong on the server' });
      }
    }
    if (matchedPath) return sendJson(res, 405, { error: 'Method not allowed' });
    if (pathname.startsWith('/api/rooms/')) return sendJson(res, 404, { error: 'Room not found' });
    if (STATIC_DIR && (req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/')) {
      if (serveStatic(req, res, pathname)) return;
    }
    sendJson(res, 404, { error: 'Not found' });
  }

  // ---------- optional static site (local testing: one port for site and server) ----------
  // Set PG_STATIC_DIR to the site folder. HTML pages get window.PG_SERVER_URL set to the
  // page's own origin, so the browser talks to this same port whatever address it used.
  const STATIC_DIR = process.env.PG_STATIC_DIR ? path.resolve(process.env.PG_STATIC_DIR) : null;
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  };
  function serveStatic(req, res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.resolve(STATIC_DIR, '.' + rel);
    if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + path.sep)) return false; // no path traversal
    const base = path.basename(file);
    if (base.startsWith('.') || file.includes(path.sep + 'node_modules' + path.sep) || file.includes(path.sep + 'data' + path.sep)) return false;
    let stat;
    try { stat = fs.statSync(file); } catch { return false; }
    if (!stat.isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    let body = fs.readFileSync(file);
    if (ext === '.html') {
      body = Buffer.from(body.toString('utf8').replace('<head>', '<head><script>window.PG_SERVER_URL=location.origin;</script>'));
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': body.length });
    if (req.method === 'HEAD') return res.end(), true;
    res.end(body);
    return true;
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      log('request crashed', e);
      try { sendJson(res, 500, { error: 'Something went wrong on the server' }); } catch { /* ignore */ }
    });
  });
  server.keepAliveTimeout = 65 * 1000;
  server.headersTimeout = 70 * 1000;

  // ---------- websocket ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: BODY_LIMIT, clientTracking: true });

  function rejectUpgrade(socket, status, text) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  server.on('upgrade', (req, socket, head) => {
    const parsed = parseUrl(req.url);
    if (!parsed) return rejectUpgrade(socket, 400, 'Bad Request');
    if (parsed.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
    const code = parsed.query.get('code') || '';
    const playerId = parsed.query.get('playerId') || '';
    if (!CODE_RE.test(code) || !PLAYER_ID_RE.test(playerId)) return rejectUpgrade(socket, 400, 'Bad Request');
    if (!engine.has(code)) return rejectUpgrade(socket, 404, 'Not Found');
    try {
      engine.getView(code, playerId);
    } catch (e) {
      return rejectUpgrade(socket, e.status || 400, e.status === 403 ? 'Forbidden' : 'Bad Request');
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, { code, playerId }));
  });

  function wsSend(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  wss.on('connection', (ws, req, { code, playerId }) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    let unsubscribe;
    try {
      unsubscribe = engine.subscribe(code, playerId, {
        onState: (state) => wsSend(ws, { type: 'state', state }),
        onClose: (reason) => {
          wsSend(ws, { type: 'error', error: reason === 'removed' ? 'You are no longer in this room' : reason, closed: true });
          ws.close(4000, reason === 'removed' ? 'removed' : 'closed');
        },
      });
    } catch (e) {
      wsSend(ws, { type: 'error', error: e.message, closed: true });
      return ws.close(4000, 'rejected');
    }
    ws.on('message', (raw) => {
      ws.isAlive = true;
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return wsSend(ws, { type: 'error', error: 'Invalid message' });
      }
      if (!msg || typeof msg !== 'object') return wsSend(ws, { type: 'error', error: 'Invalid message' });
      if (msg.type === 'ping') return wsSend(ws, { type: 'pong' });
      if (msg.type === 'action') {
        const action = msg.action && typeof msg.action === 'object' ? msg.action : {};
        try {
          const state = engine.action(code, playerId, action.type, action.payload);
          if (msg.id !== undefined) wsSend(ws, { type: 'ack', id: msg.id, state });
        } catch (e) {
          wsSend(ws, { type: 'error', id: msg.id, error: e instanceof HttpError ? e.message : 'Something went wrong on the server', status: e.status || 500 });
          if (!(e instanceof HttpError)) log('ws action crashed', e);
        }
        return;
      }
      wsSend(ws, { type: 'error', error: 'Unknown message type' });
    });
    ws.on('close', () => { if (unsubscribe) unsubscribe(); });
    ws.on('error', () => { /* close follows */ });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, WS_HEARTBEAT_MS);
  if (heartbeat.unref) heartbeat.unref();

  // ---------- lifecycle ----------
  function listen(port = 0, host) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve(server.address().port);
      });
    });
  }

  function close() {
    clearInterval(heartbeat);
    engine.close();
    for (const ws of wss.clients) ws.terminate();
    return new Promise((resolve) => {
      wss.close(() => server.close(() => resolve()));
      if (server.closeAllConnections) server.closeAllConnections();
    });
  }

  return { server, wss, engine, listen, close };
}

if (require.main === module) {
  const quiet = process.env.PG_LOG === '0';
  const log = quiet ? () => {} : (...a) => console.log(new Date().toISOString(), ...a);
  const app = createApp({
    dataFile: process.env.PG_DATA_FILE || path.join(__dirname, 'data', 'rooms.json'),
    log,
  });
  const restored = app.engine.load();
  app.engine.startSweeper();
  const port = Number(process.env.PORT) || 3001;
  app.listen(port).then((actual) => {
    console.log(`Playground server listening on port ${actual} (${restored} rooms restored)`);
  }).catch((e) => {
    console.error('Could not start server:', e.message);
    process.exit(1);
  });
  const shutdown = (signal) => {
    log(`${signal} received, saving rooms and exiting`);
    app.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { createApp };

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

const HOST = '127.0.0.1';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-'));
}

async function boot(options = {}) {
  const dir = options.dir || tempDir();
  const dataFile = options.dataFile === null ? null : path.join(dir, 'rooms.json');
  const app = createApp({ dataFile, log: () => {}, persistDebounceMs: 20, ...options });
  app.engine.load();
  const port = await app.listen(0, HOST);
  const base = 'http://' + HOST + ':' + port;
  const wsBase = 'ws://' + HOST + ':' + port;
  const api = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  return { app, engine: app.engine, port, base, wsBase, dir, dataFile, api, close: () => app.close() };
}

/** Open a WebSocket and collect messages. */
function openSocket(wsBase, code, playerId) {
  const ws = new WebSocket(`${wsBase}/ws?code=${code}&playerId=${playerId}`);
  const messages = [];
  const waiters = [];
  let cursor = 0; // messages before this index were consumed by next()
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    messages.push(msg);
    for (const w of waiters.splice(0)) w();
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('socket failed')), { once: true });
  });
  const closed = new Promise((resolve) => ws.addEventListener('close', (e) => resolve(e.code), { once: true }));
  return {
    ws,
    messages,
    opened,
    closed,
    send: (m) => ws.send(JSON.stringify(m)),
    /** Resolve with the first not-yet-consumed message matching pred (already received or future). */
    next(pred = () => true, timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
        const scan = () => {
          for (let i = cursor; i < messages.length; i++) {
            if (pred(messages[i])) { cursor = i + 1; clearTimeout(t); resolve(messages[i]); return; }
          }
          waiters.push(scan);
        };
        scan();
      });
    },
    lastState() {
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i].type === 'state') return messages[i].state;
      return null;
    },
    close: () => ws.close(),
  };
}

async function createRoom(api, hostName = 'Meenit', settings = { target: 2 }) {
  const res = await api('POST', '/api/rooms', { game: '_example', hostName, settings });
  if (res.status !== 201) throw new Error('create failed: ' + JSON.stringify(res.data));
  return res.data;
}

async function joinRoom(api, code, name) {
  const res = await api('POST', `/api/rooms/${code}/join`, { name });
  if (res.status !== 200) throw new Error('join failed: ' + JSON.stringify(res.data));
  return res.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { HOST, boot, openSocket, createRoom, joinRoom, sleep, tempDir };

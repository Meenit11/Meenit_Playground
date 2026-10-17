'use strict';
/**
 * Runs js/net.js inside a fake browser (vm sandbox) with a scripted fetch,
 * to check URL resolution, error wrapping and retry behaviour.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'net.js'), 'utf8');

function fakeBrowser({ hostname = 'meenit.github.io', protocol = 'https:', storage = {}, fetchImpl } = {}) {
  const store = { ...storage };
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Math, Date, Error, Object, Array, String, Number,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    location: { hostname, protocol },
    navigator: { onLine: true },
    document: { addEventListener() {}, visibilityState: 'visible' },
    addEventListener() {},
    fetch: fetchImpl || (() => Promise.reject(new TypeError('fetch not scripted'))),
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'net.js' });
  return { Net: sandbox.Net, store, sandbox };
}

function jsonResponse(status, data) {
  return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(data)) });
}

test('server URL resolution', async (t) => {
  await t.test('placeholder default on GitHub Pages, not configured', () => {
    const { Net } = fakeBrowser();
    assert.equal(Net.getServerUrl(), 'https://' + 'YOUR-SERVICE.onrender.com');
    assert.equal(Net.isConfigured(), false);
  });
  await t.test('local development uses port 3001 on the same host', () => {
    const { Net } = fakeBrowser({ hostname: '127.0.0.1', protocol: 'http:' });
    assert.equal(Net.getServerUrl(), 'http://' + '127.0.0.1:3001');
    assert.equal(Net.isConfigured(), true);
  });
  await t.test('pg_server_url wins and is normalised', () => {
    const { Net } = fakeBrowser({ storage: { pg_server_url: 'my-app.onrender.com/' } });
    assert.equal(Net.getServerUrl(), 'https://' + 'my-app.onrender.com');
  });
  await t.test('legacy ooi_server_url is accepted with its /api/rooms suffix removed', () => {
    const { Net } = fakeBrowser({ storage: { ooi_server_url: 'https://' + 'old.onrender.com/api/rooms' } });
    assert.equal(Net.getServerUrl(), 'https://' + 'old.onrender.com');
  });
  await t.test('setServerUrl stores, migrates the legacy key and clears on empty', () => {
    const { Net, store } = fakeBrowser({ storage: { ooi_server_url: 'x' } });
    assert.equal(Net.setServerUrl('  https://' + 'new.onrender.com/api/  '), 'https://' + 'new.onrender.com');
    assert.equal(store.pg_server_url, 'https://' + 'new.onrender.com');
    assert.equal('ooi_server_url' in store, false);
    Net.setServerUrl('');
    assert.equal('pg_server_url' in store, false);
  });
});

test('requests never leak raw fetch errors', async (t) => {
  await t.test('4xx becomes an Error with the server message, status and code', async () => {
    const { Net } = fakeBrowser({
      storage: { pg_server_url: 'https://' + 'app.onrender.com' },
      fetchImpl: () => jsonResponse(409, { error: 'started' }),
    });
    await assert.rejects(Net.join('mafia', '1234', 'Priya'), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'started');
      assert.match(err.message, /already started/);
      return true;
    });
  });
  await t.test('network failure retries with backoff, reports waking, then fails with a human message', async () => {
    let calls = 0;
    const statuses = [];
    const { Net } = fakeBrowser({
      storage: { pg_server_url: 'https://' + 'app.onrender.com' },
      fetchImpl: () => { calls += 1; return Promise.reject(new TypeError('Failed to fetch')); },
    });
    Net.on('status', (s) => statuses.push(s));
    const started = Date.now();
    await assert.rejects(Net.request('GET', '/api/health', undefined, { retries: 2 }), (err) => {
      assert.equal(err.status, 0);
      assert.equal(err.code, 'network');
      assert.match(err.message, /Could not reach the server/);
      return true;
    });
    assert.equal(calls, 3);
    assert.ok(Date.now() - started >= 2900, 'waited 1 s + 2 s between retries');
    assert.ok(statuses.includes('waking'));
  });
  await t.test('502/503 from a sleeping Render service is treated as waking and retried', async () => {
    let calls = 0;
    const { Net } = fakeBrowser({
      storage: { pg_server_url: 'https://' + 'app.onrender.com' },
      fetchImpl: () => { calls += 1; return calls < 2 ? jsonResponse(503, {}) : jsonResponse(200, { ok: true, uptime: 1, rooms: 0 }); },
    });
    const health = await Net.request('GET', '/api/health', undefined, { retries: 2 });
    assert.equal(health.ok, true);
    assert.equal(calls, 2);
  });
  await t.test('http server URL on an https page is refused with a clear message', async () => {
    const { Net } = fakeBrowser({ storage: { pg_server_url: 'http://' + 'app.example.com' } });
    await assert.rejects(Net.health(), /must start with https/);
  });
  await t.test('unconfigured placeholder is refused before any request', async () => {
    const { Net } = fakeBrowser();
    await assert.rejects(Net.health(), /No server is set/);
  });
  await t.test('client-side validation gives friendly errors', async () => {
    const { Net } = fakeBrowser({ storage: { pg_server_url: 'https://' + 'app.onrender.com' } });
    await assert.rejects(Net.join('mafia', '12', 'Priya'), /4-digit room code/);
    await assert.rejects(Net.join('mafia', '1234', ''), /enter your name/);
    await assert.rejects(Net.create('mafia', ''), /enter your name/);
  });
});

test('sessions', async (t) => {
  await t.test('create saves pg_session_<game>; rejoin uses it and returns null when the room is gone', async () => {
    const calls = [];
    const { Net, store, sandbox } = fakeBrowser({
      storage: { pg_server_url: 'https://' + 'app.onrender.com' },
      fetchImpl: (url, opts) => {
        calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
        if (url.endsWith('/api/rooms')) return jsonResponse(201, { code: '4321', playerId: 'p1', state: { version: 1, players: [], me: { id: 'p1' } } });
        return jsonResponse(404, { error: 'Room not found' });
      },
    });
    sandbox.WebSocket = undefined;
    const room = await Net.create('mafia', 'Meenit', {});
    assert.equal(room.code, '4321');
    const session = JSON.parse(store.pg_session_mafia);
    assert.equal(session.playerId, 'p1');
    assert.equal(session.game, 'mafia');
    assert.ok(session.savedAt > 0);
    await room.leave();
    assert.equal('pg_session_mafia' in store, false);

    store.pg_session_mafia = JSON.stringify({ code: '4321', playerId: 'p1', game: 'mafia', name: 'Meenit', savedAt: Date.now() });
    assert.equal(await Net.rejoin('mafia'), null);
    assert.equal('pg_session_mafia' in store, false, 'dead session is cleared');
    assert.deepEqual(calls[calls.length - 1].body, { name: 'Meenit', playerId: 'p1' });
  });
  await t.test('sessions older than 3 hours are ignored', async () => {
    const { Net } = fakeBrowser({
      storage: { pg_server_url: 'https://' + 'app.onrender.com', pg_session_ooi: JSON.stringify({ code: '1111', playerId: 'x', game: 'ooi', savedAt: Date.now() - 4 * 3600 * 1000 }) },
    });
    assert.equal(Net.hasSession('ooi'), false);
    assert.equal(await Net.rejoin('ooi'), null);
  });
});

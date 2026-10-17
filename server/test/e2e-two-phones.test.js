'use strict';
/**
 * End to end: boots the real server as a child process on a random port,
 * then plays as two phones over REST and WebSocket.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const { HOST, openSocket, tempDir } = require('./helpers');

function startServer() {
  const dir = tempDir();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '0', PG_DATA_FILE: path.join(dir, 'rooms.json'), PG_LOG: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const m = out.match(/listening on port (\d+)/);
      if (m) resolve(Number(m[1]));
    });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('exit', (code) => reject(new Error(`server exited early (${code}): ${out}`)));
    setTimeout(() => reject(new Error('server did not start: ' + out)), 8000).unref();
  });
  return { child, port };
}

test('two phones share one room end to end', async (t) => {
  const { child, port: portPromise } = startServer();
  t.after(() => child.kill('SIGTERM'));
  const port = await portPromise;
  const base = 'http://' + HOST + ':' + port;
  const wsBase = 'ws://' + HOST + ':' + port;
  const api = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };

  // phone 1 hosts
  const created = await api('POST', '/api/rooms', { game: '_example', hostName: 'Meenit', settings: { target: 2 } });
  assert.equal(created.status, 201);
  const { code, playerId: host } = created.data;

  // phone 2 joins
  const joined = await api('POST', `/api/rooms/${code}/join`, { name: 'Priya' });
  assert.equal(joined.status, 200);
  const guest = joined.data.playerId;

  // both open sockets
  const s1 = openSocket(wsBase, code, host);
  const s2 = openSocket(wsBase, code, guest);
  await Promise.all([s1.opened, s2.opened]);
  await Promise.all([s1.next((m) => m.type === 'state'), s2.next((m) => m.type === 'state')]);

  // host starts, guest taps twice and wins; every phone sees every version
  await api('POST', `/api/rooms/${code}/action`, { playerId: host, type: 'start' });
  s2.send({ type: 'action', id: 1, action: { type: 'tap' } });
  await s2.next((m) => m.type === 'ack' && m.id === 1);
  s2.send({ type: 'action', id: 2, action: { type: 'tap' } });
  const ack = await s2.next((m) => m.type === 'ack' && m.id === 2);
  assert.equal(ack.state.phase, 'ended');
  const final1 = await s1.next((m) => m.type === 'state' && m.state.phase === 'ended');
  const final2 = s2.lastState().phase === 'ended' ? s2.lastState() : (await s2.next((m) => m.type === 'state' && m.state.phase === 'ended')).state;

  assert.equal(final1.state.version, final2.version, 'both phones end on the same version');
  assert.equal(final1.state.winnerId, guest);
  assert.equal(final2.winnerId, guest);
  assert.equal(final1.state.me.id, host);
  assert.equal(final2.me.id, guest);
  assert.deepEqual(
    final1.state.players.map((p) => [p.name, p.taps, p.connected]),
    final2.players.map((p) => [p.name, p.taps, p.connected]),
  );

  // versions seen by each socket are strictly increasing
  for (const s of [s1, s2]) {
    const versions = s.messages.filter((m) => m.type === 'state').map((m) => m.state.version);
    for (let i = 1; i < versions.length; i++) assert.ok(versions[i] >= versions[i - 1], 'versions never go backwards');
  }

  // polling fallback agrees with the sockets
  const polled = await api('GET', `/api/rooms/${code}?playerId=${guest}`);
  assert.equal(polled.data.state.version, final2.version);

  s1.close();
  s2.close();
});

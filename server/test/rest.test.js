'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, createRoom, joinRoom } = require('./helpers');

test('REST API', async (t) => {
  const srv = await boot();
  t.after(() => srv.close());
  const { api } = srv;

  await t.test('health reports ok, uptime and room count', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(typeof res.data.uptime, 'number');
    assert.equal(res.data.rooms, 0);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  await t.test('HEAD and OPTIONS work for keep-alive pingers and CORS preflight', async () => {
    const head = await fetch(srv.base + '/api/health', { method: 'HEAD' });
    assert.equal(head.status, 200);
    const pre = await fetch(srv.base + '/api/rooms', { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  });

  await t.test('create returns a 4-digit code, playerId and private state', async () => {
    const data = await createRoom(api, 'Meenit', { target: 3 });
    assert.match(data.code, /^\d{4}$/);
    assert.ok(data.playerId);
    assert.equal(data.state.game, '_example');
    assert.equal(data.state.phase, 'lobby');
    assert.equal(data.state.hostId, data.playerId);
    assert.equal(data.state.version, 1);
    assert.deepEqual(data.state.settings, { target: 3 });
    assert.equal(data.state.me.id, data.playerId);
    assert.equal(data.state.players[0].isHost, true);
    assert.equal(data.state.players[0].connected, false);
    assert.equal('secret' in data.state.players[0], false, 'private fields are stripped from players');
  });

  await t.test('create applies default settings and validates them', async () => {
    const ok = await api('POST', '/api/rooms', { game: '_example', hostName: 'A' });
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.data.state.settings, { target: 5 });
    const bad = await api('POST', '/api/rooms', { game: '_example', hostName: 'A', settings: { target: 0 } });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'Target must be between 1 and 100');
  });

  await t.test('unknown game is a clear 400', async () => {
    const res = await api('POST', '/api/rooms', { game: 'nope', hostName: 'A' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, "Unknown game 'nope'");
    const traversal = await api('POST', '/api/rooms', { game: '../server', hostName: 'A' });
    assert.equal(traversal.status, 400);
  });

  await t.test('missing host name is a 400', async () => {
    const res = await api('POST', '/api/rooms', { game: '_example', hostName: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Please enter your name');
  });

  await t.test('join adds a player and bumps version', async () => {
    const room = await createRoom(api);
    const joined = await joinRoom(api, room.code, '  Priya  ');
    assert.ok(joined.playerId);
    assert.equal(joined.state.version, 2);
    assert.deepEqual(joined.state.players.map((p) => p.name), ['Meenit', 'Priya']);
    assert.equal(joined.state.me.id, joined.playerId);
  });

  await t.test('duplicate names are refused, case-insensitively', async () => {
    const room = await createRoom(api);
    const res = await api('POST', `/api/rooms/${room.code}/join`, { name: 'meenit' });
    assert.equal(res.status, 409);
    assert.equal(res.data.error, 'That name is already taken');
  });

  await t.test('join after start is refused unless playerId is known', async () => {
    const room = await createRoom(api);
    const p2 = await joinRoom(api, room.code, 'Priya');
    const started = await api('POST', `/api/rooms/${room.code}/action`, { playerId: room.playerId, type: 'start' });
    assert.equal(started.status, 200);
    assert.equal(started.data.state.phase, 'playing');
    const late = await api('POST', `/api/rooms/${room.code}/join`, { name: 'Late' });
    assert.equal(late.status, 409);
    assert.deepEqual(late.data, { error: 'started' });
    const back = await api('POST', `/api/rooms/${room.code}/join`, { name: 'Priya', playerId: p2.playerId });
    assert.equal(back.status, 200);
    assert.equal(back.data.playerId, p2.playerId);
    assert.equal(back.data.state.phase, 'playing');
  });

  await t.test('rejoin can rename, but not to a taken name', async () => {
    const room = await createRoom(api);
    const p2 = await joinRoom(api, room.code, 'Priya');
    const renamed = await api('POST', `/api/rooms/${room.code}/join`, { name: 'Pri', playerId: p2.playerId });
    assert.equal(renamed.status, 200);
    assert.ok(renamed.data.state.players.some((p) => p.name === 'Pri'));
    const clash = await api('POST', `/api/rooms/${room.code}/join`, { name: 'Meenit', playerId: p2.playerId });
    assert.equal(clash.status, 409);
  });

  await t.test('GET view is private per player', async () => {
    const room = await createRoom(api);
    const p2 = await joinRoom(api, room.code, 'Priya');
    const hostView = await api('GET', `/api/rooms/${room.code}?playerId=${room.playerId}`);
    const p2View = await api('GET', `/api/rooms/${room.code}?playerId=${p2.playerId}`);
    assert.equal(hostView.data.state.me.secret, `s-${room.playerId}`);
    assert.equal(p2View.data.state.me.secret, `s-${p2.playerId}`);
    assert.equal(hostView.data.state.version, p2View.data.state.version);
    const noId = await api('GET', `/api/rooms/${room.code}`);
    assert.equal(noId.status, 400);
    const stranger = await api('GET', `/api/rooms/${room.code}?playerId=nobody`);
    assert.equal(stranger.status, 403);
    assert.equal(stranger.data.error, 'You are not in this room');
  });

  await t.test('unknown room is a 404 with { error }', async () => {
    const res = await api('GET', '/api/rooms/0000?playerId=x');
    assert.equal(res.status, 404);
    assert.deepEqual(res.data, { error: 'Room not found' });
    const bad = await api('GET', '/api/rooms/abcd?playerId=x');
    assert.equal(bad.status, 404);
  });

  await t.test('invalid actions return 400 and do not change state', async () => {
    const room = await createRoom(api);
    const before = (await api('GET', `/api/rooms/${room.code}?playerId=${room.playerId}`)).data.state.version;
    const unknown = await api('POST', `/api/rooms/${room.code}/action`, { playerId: room.playerId, type: 'explode' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.data.error, "Unknown action 'explode'");
    const tooEarly = await api('POST', `/api/rooms/${room.code}/action`, { playerId: room.playerId, type: 'start' });
    assert.equal(tooEarly.status, 400);
    assert.equal(tooEarly.data.error, 'You need at least 2 players');
    const noType = await api('POST', `/api/rooms/${room.code}/action`, { playerId: room.playerId });
    assert.equal(noType.status, 400);
    const p2 = await joinRoom(api, room.code, 'Priya');
    const notHost = await api('POST', `/api/rooms/${room.code}/action`, { playerId: p2.playerId, type: 'start' });
    assert.equal(notHost.status, 400);
    assert.equal(notHost.data.error, 'Only the host can do that');
    const after = (await api('GET', `/api/rooms/${room.code}?playerId=${room.playerId}`)).data.state.version;
    assert.equal(after, before + 1, 'only the join changed the version');
  });

  await t.test('a full game round trip: start, tap to the target, restart', async () => {
    const room = await createRoom(api, 'Meenit', { target: 2 });
    const p2 = await joinRoom(api, room.code, 'Priya');
    await api('POST', `/api/rooms/${room.code}/action`, { playerId: room.playerId, type: 'start' });
    await api('POST', `/api/rooms/${room.code}/action`, { playerId: p2.playerId, type: 'tap' });
    const win = await api('POST', `/api/rooms/${room.code}/action`, { playerId: p2.playerId, type: 'tap' });
    assert.equal(win.data.state.phase, 'ended');
    assert.equal(win.data.state.winnerId, p2.playerId);
    const restart = await api('POST', `/api/rooms/${room.code}/action`, { playerId: room.playerId, type: 'restart' });
    assert.equal(restart.data.state.phase, 'lobby');
    assert.equal(restart.data.state.players.length, 2);
  });

  await t.test('kick removes a player, leave is idempotent, empty rooms close', async () => {
    const room = await createRoom(api);
    const p2 = await joinRoom(api, room.code, 'Priya');
    const kicked = await api('POST', `/api/rooms/${room.code}/action`, { playerId: room.playerId, type: 'kick', payload: { playerId: p2.playerId } });
    assert.equal(kicked.data.state.players.length, 1);
    const gone = await api('GET', `/api/rooms/${room.code}?playerId=${p2.playerId}`);
    assert.equal(gone.status, 403);
    const left = await api('POST', `/api/rooms/${room.code}/leave`, { playerId: room.playerId });
    assert.deepEqual(left.data, { ok: true });
    const again = await api('POST', `/api/rooms/${room.code}/leave`, { playerId: room.playerId });
    assert.equal(again.status, 200);
    const missing = await api('GET', `/api/rooms/${room.code}?playerId=${room.playerId}`);
    assert.equal(missing.status, 404, 'room is deleted once empty');
  });

  await t.test('host leaving in the lobby hands the room to the next player', async () => {
    const room = await createRoom(api);
    const p2 = await joinRoom(api, room.code, 'Priya');
    await api('POST', `/api/rooms/${room.code}/leave`, { playerId: room.playerId });
    const view = await api('GET', `/api/rooms/${room.code}?playerId=${p2.playerId}`);
    assert.equal(view.data.state.hostId, p2.playerId);
    assert.equal(view.data.state.players[0].isHost, true);
  });

  await t.test('bad bodies: invalid JSON, non-object, too large', async () => {
    const invalid = await api('POST', '/api/rooms', '{not json');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.error, 'Invalid JSON');
    const arr = await api('POST', '/api/rooms', '[1,2]');
    assert.equal(arr.status, 400);
    const big = await api('POST', '/api/rooms', JSON.stringify({ game: '_example', hostName: 'A', settings: { pad: 'x'.repeat(70 * 1024) } }));
    assert.equal(big.status, 413);
    assert.equal(big.data.error, 'Request too large');
  });

  await t.test('routing: 404 and 405 have the error shape', async () => {
    const nf = await api('GET', '/nope');
    assert.equal(nf.status, 404);
    assert.equal(typeof nf.data.error, 'string');
    const wrong = await api('GET', '/api/rooms');
    assert.equal(wrong.status, 405);
    const root = await api('GET', '/');
    assert.equal(root.status, 200);
    assert.equal(root.data.ok, true);
  });

  await t.test('room codes are unique among live rooms', async () => {
    const codes = new Set();
    for (let i = 0; i < 25; i++) codes.add((await createRoom(api, 'H' + i)).code);
    assert.equal(codes.size, 25);
  });
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, openSocket, createRoom, joinRoom, sleep } = require('./helpers');

test('WebSocket fan-out', async (t) => {
  const srv = await boot();
  t.after(() => srv.close());
  const { api, wsBase } = srv;

  await t.test('each socket gets its own private view on connect and on every change', async () => {
    const room = await createRoom(api, 'Meenit', { target: 3 });
    const p2 = await joinRoom(api, room.code, 'Priya');
    const a = openSocket(wsBase, room.code, room.playerId);
    const b = openSocket(wsBase, room.code, p2.playerId);
    await Promise.all([a.opened, b.opened]);
    await a.next((m) => m.type === 'state');
    await b.next((m) => m.type === 'state');
    await sleep(30);
    assert.equal(a.lastState().me.secret, `s-${room.playerId}`);
    assert.equal(b.lastState().me.secret, `s-${p2.playerId}`);
    assert.equal(a.lastState().players.find((p) => p.id === p2.playerId).connected, true);
    assert.equal(b.lastState().players.find((p) => p.id === room.playerId).connected, true);
    assert.equal(a.lastState().players.some((p) => 'secret' in p), false);

    const before = a.lastState().version;
    const res = await api('POST', `/api/rooms/${room.code}/action`, { playerId: room.playerId, type: 'start' });
    assert.equal(res.status, 200);
    const [sa, sb] = await Promise.all([
      a.next((m) => m.type === 'state' && m.state.phase === 'playing'),
      b.next((m) => m.type === 'state' && m.state.phase === 'playing'),
    ]);
    assert.equal(sa.state.version, before + 1);
    assert.equal(sb.state.version, sa.state.version);
    assert.equal(sa.state.me.id, room.playerId);
    assert.equal(sb.state.me.id, p2.playerId);

    // actions over the socket are acknowledged and fanned out
    b.send({ type: 'action', id: 7, action: { type: 'tap' } });
    const ack = await b.next((m) => m.type === 'ack');
    assert.equal(ack.id, 7);
    assert.equal(ack.state.me.taps, 1);
    const seen = await a.next((m) => m.type === 'state' && m.state.version === ack.state.version);
    assert.equal(seen.state.players.find((p) => p.id === p2.playerId).taps, 1);

    // ping and errors
    a.send({ type: 'ping' });
    assert.equal((await a.next((m) => m.type === 'pong')).type, 'pong');
    b.send({ type: 'action', id: 8, action: { type: 'start' } });
    const err = await b.next((m) => m.type === 'error');
    assert.equal(err.id, 8);
    assert.equal(err.error, 'Only the host can do that');
    a.ws.send('not json');
    assert.equal((await a.next((m) => m.type === 'error')).error, 'Invalid message');

    // disconnect flips connected for the others
    b.close();
    const after = await a.next((m) => m.type === 'state' && m.state.players.find((p) => p.id === p2.playerId).connected === false);
    assert.ok(after);
    a.close();
  });

  await t.test('kicked player is told and closed, others keep playing', async () => {
    const room = await createRoom(api);
    const p2 = await joinRoom(api, room.code, 'Priya');
    const a = openSocket(wsBase, room.code, room.playerId);
    const b = openSocket(wsBase, room.code, p2.playerId);
    await Promise.all([a.opened, b.opened]);
    await api('POST', `/api/rooms/${room.code}/action`, { playerId: room.playerId, type: 'kick', payload: { playerId: p2.playerId } });
    const msg = await b.next((m) => m.type === 'error');
    assert.equal(msg.closed, true);
    assert.equal(await b.closed, 4000);
    const s = await a.next((m) => m.type === 'state' && m.state.players.length === 1);
    assert.ok(s);
    a.close();
  });

  await t.test('bad upgrades are refused', async () => {
    const room = await createRoom(api);
    const wrongPath = new WebSocket(`${wsBase}/nope?code=${room.code}&playerId=${room.playerId}`);
    await new Promise((r) => wrongPath.addEventListener('error', r, { once: true }));
    const stranger = new WebSocket(`${wsBase}/ws?code=${room.code}&playerId=zzz`);
    await new Promise((r) => stranger.addEventListener('error', r, { once: true }));
    const noRoom = new WebSocket(`${wsBase}/ws?code=0000&playerId=zzz`);
    await new Promise((r) => noRoom.addEventListener('error', r, { once: true }));
  });
});

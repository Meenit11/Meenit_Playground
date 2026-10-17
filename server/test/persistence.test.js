'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { boot, createRoom, joinRoom, tempDir, sleep } = require('./helpers');

test('rooms survive a restart of the engine', async (t) => {
  const dir = tempDir();
  const first = await boot({ dir });
  const room = await createRoom(first.api, 'Meenit', { target: 4 });
  const p2 = await joinRoom(first.api, room.code, 'Priya');
  await first.api('POST', `/api/rooms/${room.code}/action`, { playerId: room.playerId, type: 'start' });
  const last = await first.api('POST', `/api/rooms/${room.code}/action`, { playerId: p2.playerId, type: 'tap' });
  assert.equal(last.data.state.version, 4);
  await sleep(60); // debounce window
  assert.ok(fs.existsSync(first.dataFile), 'rooms.json written after debounce');
  await first.close(); // also flushes

  const saved = JSON.parse(fs.readFileSync(first.dataFile, 'utf8'));
  assert.equal(saved.rooms.length, 1);
  assert.equal(saved.rooms[0].code, room.code);

  const second = await boot({ dir });
  t.after(() => second.close());
  assert.equal(second.engine.roomCount, 1);

  // rejoin with the known playerId while the game is running
  const back = await second.api('POST', `/api/rooms/${room.code}/join`, { playerId: p2.playerId, name: 'Priya' });
  assert.equal(back.status, 200);
  assert.equal(back.data.state.phase, 'playing');
  assert.equal(back.data.state.version, 4);
  assert.equal(back.data.state.me.taps, 1);
  assert.equal(back.data.state.me.secret, `s-${p2.playerId}`);

  // play continues and versions keep counting from where they were
  const next = await second.api('POST', `/api/rooms/${room.code}/action`, { playerId: p2.playerId, type: 'tap' });
  assert.equal(next.data.state.version, 5);

  // unknown player cannot sneak into the running game
  const late = await second.api('POST', `/api/rooms/${room.code}/join`, { name: 'Late' });
  assert.equal(late.status, 409);
});

test('a corrupt or missing data file starts empty instead of crashing', async (t) => {
  const dir = tempDir();
  fs.writeFileSync(`${dir}/rooms.json`, '{ broken');
  const srv = await boot({ dir });
  t.after(() => srv.close());
  assert.equal(srv.engine.roomCount, 0);
  const health = await srv.api('GET', '/api/health');
  assert.equal(health.data.ok, true);
});

test('saved rooms for a game module that no longer exists are skipped', async (t) => {
  const dir = tempDir();
  fs.writeFileSync(`${dir}/rooms.json`, JSON.stringify({
    rooms: [
      { code: '1234', game: 'ghost', state: { players: [{ id: 'a', name: 'A' }], phase: 'lobby', version: 1 }, lastActionAt: Date.now() },
      { code: 'bad!', game: '_example', state: { players: [] }, lastActionAt: Date.now() },
    ],
  }));
  const srv = await boot({ dir });
  t.after(() => srv.close());
  assert.equal(srv.engine.roomCount, 0);
});

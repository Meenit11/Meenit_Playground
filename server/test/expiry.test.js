'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, createRoom, openSocket, tempDir } = require('./helpers');

const HOUR = 60 * 60 * 1000;

test('rooms expire 6 hours after their last action', async (t) => {
  let clock = 1_700_000_000_000;
  const srv = await boot({ now: () => clock });
  t.after(() => srv.close());
  const { api, engine } = srv;

  const fresh = await createRoom(api, 'Meenit');
  const stale = await createRoom(api, 'Old');
  clock += 5 * HOUR;
  // activity on 'fresh' resets its clock
  await api('POST', `/api/rooms/${fresh.code}/join`, { name: 'Priya' });
  clock += 1 * HOUR + 1000;

  const socket = openSocket(srv.wsBase, stale.code, stale.playerId);
  await socket.opened;
  await socket.next((m) => m.type === 'state');

  assert.equal(engine.sweep(), 1);
  assert.equal((await api('GET', `/api/rooms/${stale.code}?playerId=${stale.playerId}`)).status, 404);
  assert.equal((await api('GET', `/api/rooms/${fresh.code}?playerId=${fresh.playerId}`)).status, 200);
  const bye = await socket.next((m) => m.type === 'error');
  assert.equal(bye.closed, true);
  assert.equal(bye.error, 'Room closed');
  assert.equal(await socket.closed, 4000);
});

test('expired rooms are dropped when loading from disk', async (t) => {
  const dir = tempDir();
  let clock = 1_700_000_000_000;
  const first = await boot({ dir, now: () => clock });
  const room = await createRoom(first.api, 'Meenit');
  await first.close();

  clock += 7 * HOUR;
  const second = await boot({ dir, now: () => clock });
  t.after(() => second.close());
  assert.equal(second.engine.roomCount, 0);
  assert.equal((await second.api('GET', `/api/rooms/${room.code}?playerId=${room.playerId}`)).status, 404);
});

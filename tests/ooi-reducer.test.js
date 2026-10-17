'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../server/games/ooi.js');

function room(n = 4, settings = {}) {
  let s = M.init({ code: '4321', hostId: 'host', hostName: 'Meenit', settings, now: 1000 });
  for (let i = 1; i < n; i++) s = M.join(s, { id: 'p' + i, name: 'Player ' + i });
  return s;
}
const act = (s, type, payload, who, now) => M.reduce(s, { type, payload }, who, now);
const toAnswerPhase = (s, now) => act(s, 'tick', {}, 'host', now);

test('module shape matches PROTOCOL section 3', () => {
  assert.equal(M.name, 'ooi');
  for (const k of ['defaultSettings', 'validateSettings', 'init', 'join', 'reduce', 'view']) assert.ok(M[k], k);
  assert.equal(room().phase, 'lobby');
  assert.throws(() => M.validateSettings({ timerSeconds: 3 }));
});

test('start needs the host and 3 players, then runs a 3 s get-ready then the answer timer', () => {
  assert.throws(() => act(room(2), 'start', {}, 'host', 2000), /at least 3/);
  assert.throws(() => act(room(3), 'start', {}, 'p1', 2000), /host/);
  let s = act(room(4, { timerSeconds: 12 }), 'start', {}, 'host', 2000);
  assert.equal(s.phase, 'ready');
  assert.equal(s.round, 1);
  assert.equal(s.deadline, 5000);
  assert.equal(s.tier, 'tier3');
  assert.ok(s.question.length > 0);
  s = act(s, 'tick', {}, 'p1', 4999);
  assert.equal(s.phase, 'ready', 'server clock decides, not the caller');
  s = act(s, 'tick', {}, 'p1', 5000);
  assert.equal(s.phase, 'answer');
  assert.equal(s.deadline, 5000 + 12000);
});

test('tiering by alive count uses the room-scoped used list, no repeats', () => {
  let s = act(room(12), 'start', {}, 'host', 2000);
  assert.equal(s.tier, 'tier1');
  assert.equal(s.used.length, 1);
  assert.equal(s.used[0].q, s.question);
  const seen = new Set([s.question]);
  for (let i = 0; i < 10; i++) {
    s = act(s, 'skip', {}, 'host', 3000 + i);
    assert.ok(!seen.has(s.question), 'no repeat within the room');
    seen.add(s.question);
  }
  const seeded = act(room(12, { recentQuestions: ['seed'] }), 'start', {}, 'host', 2000);
  assert.ok(seeded.used.some(e => e.q === 'seed'), 'host device memory seeds the room history');
});

test('setTimer only in lobby, 5 to 30', () => {
  let s = act(room(), 'setTimer', { timerSeconds: 25 }, 'host', 2000);
  assert.equal(s.settings.timerSeconds, 25);
  assert.throws(() => act(s, 'setTimer', { timerSeconds: 2 }, 'host', 2000));
  assert.throws(() => act(s, 'setTimer', { timerSeconds: 10 }, 'p1', 2000));
  s = act(s, 'start', {}, 'host', 2000);
  assert.throws(() => act(s, 'setTimer', { timerSeconds: 10 }, 'host', 2000), /before the game/);
});

test('answers lock at the deadline: late answers refused, blanks filled, no edits', () => {
  let s = toAnswerPhase(act(room(4), 'start', {}, 'host', 2000), 5000); // answer deadline 15000
  s = act(s, 'answer', { text: '  Mango  ' }, 'p1', 6000);
  assert.equal(s.answers.p1, 'Mango');
  assert.throws(() => act(s, 'answer', { text: 'Apple' }, 'p1', 7000), /already locked/);
  assert.throws(() => act(s, 'answer', { text: '   ' }, 'p2', 7000), /Type an answer/);
  s = act(s, 'answer', { text: 'Mango' }, 'host', 14999);
  assert.throws(() => act(s, 'answer', { text: 'Late' }, 'p2', 15000), /Time is up/);
  s = act(s, 'tick', {}, 'p3', 15000);
  assert.equal(s.phase, 'review');
  assert.deepEqual(s.answers, { host: 'Mango', p1: 'Mango', p2: '', p3: '' });
});

test('private view hides other answers before review, shows my own, lists who answered', () => {
  let s = toAnswerPhase(act(room(4), 'start', {}, 'host', 2000), 5000);
  s = act(s, 'answer', { text: 'Secret' }, 'p1', 6000);
  const asHost = M.view(s, 'host');
  assert.equal(asHost.answers, undefined, 'no answers map before review');
  assert.deepEqual(asHost.review, []);
  assert.deepEqual(asHost.answered, ['p1']);
  assert.equal(asHost.me.answered, false);
  const asP1 = M.view(s, 'p1');
  assert.equal(asP1.me.answer, 'Secret');
  assert.equal(asP1.me.answered, true);
  assert.equal(typeof asP1.serverNow, 'number');
  s = act(s, 'tick', {}, 'host', 15000);
  const review = M.view(s, 'p2');
  assert.equal(review.phase, 'review');
  assert.equal(review.review.length, 4);
  assert.equal(review.review[0].blank, true, 'blanks first');
  assert.equal(review.review[3].answer, 'Secret');
});

test('pause and resume keep the remaining time', () => {
  let s = toAnswerPhase(act(room(4), 'start', {}, 'host', 2000), 5000); // deadline 15000
  assert.throws(() => act(s, 'pause', {}, 'p1', 8000), /host/);
  s = act(s, 'pause', {}, 'host', 8000);
  assert.equal(s.paused, true);
  assert.equal(s.pausedRemainingMs, 7000);
  s = act(s, 'tick', {}, 'host', 50000);
  assert.equal(s.phase, 'answer', 'paused clock never expires');
  assert.throws(() => act(s, 'answer', { text: 'x' }, 'p1', 50000), /paused/);
  s = act(s, 'resume', {}, 'host', 60000);
  assert.equal(s.deadline, 67000);
  s = act(s, 'tick', {}, 'host', 66999);
  assert.equal(s.phase, 'answer');
  s = act(s, 'tick', {}, 'host', 67000);
  assert.equal(s.phase, 'review');
});

test('skip replaces the question and restarts get-ready in the same round', () => {
  let s = toAnswerPhase(act(room(4), 'start', {}, 'host', 2000), 5000);
  s = act(s, 'answer', { text: 'x' }, 'p1', 6000);
  const q1 = s.question;
  s = act(s, 'skip', {}, 'host', 7000);
  assert.equal(s.phase, 'ready');
  assert.equal(s.round, 1);
  assert.notEqual(s.question, q1);
  assert.deepEqual(s.answers, {});
  assert.equal(s.deadline, 10000);
});

test('GM self-elimination, multiple eliminations, sole winner only at one remaining', () => {
  let s = act(room(4), 'start', {}, 'host', 2000);
  s = act(s, 'tick', {}, 'host', 5000);
  s = act(s, 'tick', {}, 'host', 20000); // a late tick still locks on the server clock
  assert.equal(s.phase, 'review');
  assert.throws(() => act(s, 'eliminate', {}, 'host', 20001), /Pick who is out/);
  assert.throws(() => act(s, 'eliminate', { ids: ['host', 'p1', 'p2', 'p3'] }, 'host', 20001), /stay in/);
  s = act(s, 'select', { playerId: 'host' }, 'host', 20001);
  s = act(s, 'select', { playerId: 'p1' }, 'host', 20002);
  assert.deepEqual(s.selected, ['host', 'p1']);
  s = act(s, 'select', { playerId: 'p1' }, 'host', 20003);
  s = act(s, 'select', { playerId: 'p1' }, 'host', 20004);
  s = act(s, 'eliminate', {}, 'host', 20005);
  assert.equal(s.phase, 'review', 'two players still in, no winner yet');
  assert.equal(s.reviewDone, true);
  assert.deepEqual(s.eliminatedThisRound, ['host', 'p1']);
  assert.equal(s.players.find(p => p.id === 'host').eliminated, true);
  assert.equal(s.hostId, 'host', 'eliminated host still runs the game');
  assert.throws(() => act(s, 'nextRound', {}, 'p2', 20006), /host/);
  s = act(s, 'nextRound', {}, 'host', 20006);
  assert.equal(s.round, 2);
  assert.equal(s.phase, 'ready');
  assert.equal(M.view(s, 'host').me.eliminated, true);
  s = act(s, 'tick', {}, 'host', 30000);
  s = act(s, 'tick', {}, 'host', 40000);
  assert.deepEqual(Object.keys(s.answers).sort(), ['p2', 'p3'], 'only alive players are in the round');
  s = act(s, 'eliminate', { ids: ['p2'] }, 'host', 40001);
  assert.equal(s.phase, 'winner');
  assert.equal(s.winnerId, 'p3');
});

test('endGame and restart go back to the lobby keeping players', () => {
  let s = toAnswerPhase(act(room(4), 'start', {}, 'host', 2000), 5000);
  s = act(s, 'endGame', {}, 'host', 6000);
  assert.equal(s.phase, 'lobby');
  assert.equal(s.players.length, 4);
  assert.equal(s.endedEarly, true);
  assert.throws(() => M.join(act(room(3), 'start', {}, 'host', 2000), { id: 'x', name: 'Late' }), /started/);
  s = act(s, 'start', {}, 'host', 7000);
  s = act(s, 'restart', {}, 'host', 8000);
  assert.equal(s.phase, 'lobby');
  assert.ok(s.players.every(p => !p.eliminated));
});

test('reduce never mutates its input and bumps version', () => {
  const s = room(4);
  const frozen = JSON.stringify(s);
  const next = act(s, 'start', {}, 'host', 2000);
  assert.equal(JSON.stringify(s), frozen);
  assert.equal(next.version, s.version + 1);
});

test('leave during play counts as out and can crown the winner; host passes on', () => {
  let s = act(room(3), 'start', {}, 'host', 2000);
  s = act(s, 'leave', {}, 'p1', 3000);
  assert.equal(s.players.find(p => p.id === 'p1').eliminated, true);
  s = act(s, 'leave', {}, 'host', 3100);
  assert.equal(s.phase, 'winner');
  assert.equal(s.winnerId, 'p2');
  assert.equal(s.hostId, 'p2');
});

test('host can restart the timer for the same question; answers are cleared and the clock is fresh', () => {
  let s = toAnswerPhase(act(room(4), 'start', {}, 'host', 2000), 5000); // deadline 15000
  const question = s.question;
  s = act(s, 'answer', { text: 'apple' }, 'p1', 6000);
  s = act(s, 'pause', {}, 'host', 7000);
  assert.throws(() => act(s, 'reset', {}, 'p1', 7500), /host/);
  s = act(s, 'reset', {}, 'host', 8000);
  assert.equal(s.phase, 'answer');
  assert.equal(s.paused, false);
  assert.equal(s.question, question, 'same question');
  assert.deepEqual(s.answers, {}, 'answers cleared');
  assert.equal(s.deadline, 8000 + s.settings.timerSeconds * 1000, 'fresh deadline');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/rules/ooi-rules.js');

const players = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isHost: i === 0, eliminated: false, ...extra }));

test('pickTier: tier1 for 10+, tier2 for 5 to 9, tier3 below 5', () => {
  assert.equal(R.pickTier(20), 'tier1');
  assert.equal(R.pickTier(10), 'tier1');
  assert.equal(R.pickTier(9), 'tier2');
  assert.equal(R.pickTier(5), 'tier2');
  assert.equal(R.pickTier(4), 'tier3');
  assert.equal(R.pickTier(2), 'tier3');
});

test('pickQuestion: no repeats until the pool is exhausted, then it resets', () => {
  const pool = ['a', 'b', 'c', 'd'];
  let used = [];
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const r = R.pickQuestion(pool, used, { now: 1000 + i, rng: () => 0.3 });
    seen.push(r.question);
    used = r.used;
  }
  assert.deepEqual([...seen].sort(), pool);
  assert.equal(used.length, 4);
  const again = R.pickQuestion(pool, used, { now: 2000, rng: () => 0.3 });
  assert.ok(pool.includes(again.question));
  assert.equal(again.used.length, 1, 'history for the exhausted pool is cleared');
});

test('pickQuestion: history is room data and forgets entries after the cooldown', () => {
  const pool = ['a', 'b'];
  const old = [{ q: 'a', at: 0 }];
  const r = R.pickQuestion(pool, old, { now: R.COOLDOWN_MS + 1, rng: () => 0 });
  assert.equal(r.question, 'a', 'cooled-down question is available again');
  const r2 = R.pickQuestion(pool, old, { now: 1000, rng: () => 0 });
  assert.equal(r2.question, 'b', 'recent question is skipped');
});

test('loadQuestions: reads questions.json shape and dedupes exact duplicates', () => {
  const q = R.loadQuestions({ tier1_broad: { questions: ['x', 'x', 'y'] }, tier2_medium: { questions: [] }, tier3_narrow: { questions: ['z'] } });
  assert.deepEqual(q.tier1, ['x', 'y']);
  assert.deepEqual(q.tier3, ['z']);
  const real = R.loadQuestions(require('../questions.json'));
  assert.ok(real.tier1.length >= 20 && real.tier2.length >= 20 && real.tier3.length >= 20);
  assert.equal(R.tierPool(q, 'tier2'), q.tier1, 'empty tier falls back to a non-empty one');
});

test('validateTimer: 5 to 30 whole seconds, default 10', () => {
  assert.equal(R.validateTimer(5), 5);
  assert.equal(R.validateTimer('30'), 30);
  assert.throws(() => R.validateTimer(4));
  assert.throws(() => R.validateTimer(31));
  assert.throws(() => R.validateTimer(7.5));
  assert.throws(() => R.validateTimer('fast'));
  assert.equal(R.validateSettings({}).timerSeconds, R.TIMER.default);
  assert.equal(R.validateSettings({ timerSeconds: 15, recentQuestions: ['q1', { q: 'q2', at: 5 }] }).recentQuestions.length, 2);
  assert.throws(() => R.validateSettings({ timerSeconds: 99 }));
});

test('lockAnswers: every alive player gets a key, blanks for the silent, no edits to existing answers', () => {
  const ps = players(4);
  ps[3].eliminated = true;
  const locked = R.lockAnswers(ps, { p0: '  Mango ', p1: 'apple' });
  assert.deepEqual(locked, { p0: 'Mango', p1: 'apple', p2: '' });
  assert.ok(!('p3' in locked), 'eliminated players are not in the round');
});

test('sortForReview: blanks first, then alphabetical case-insensitive, duplicates flagged', () => {
  const ps = players(5);
  const list = R.sortForReview(ps, { p0: 'zebra', p1: '', p2: 'Apple', p3: 'apple', p4: 'mango' });
  assert.deepEqual(list.map(x => x.name), ['P1', 'P2', 'P3', 'P4', 'P0']);
  assert.equal(list[0].blank, true);
  assert.equal(list[1].duplicate, true);
  assert.equal(list[2].duplicate, true);
  assert.equal(list[3].duplicate, false);
});

test('applyEliminations: GM can eliminate themselves and many at once', () => {
  const ps = players(5);
  const next = R.applyEliminations(ps, ['p0', 'p2', 'p4'], 3);
  assert.equal(ps[0].eliminated, false, 'input not mutated');
  assert.equal(next[0].eliminated, true, 'host is out');
  assert.equal(next[0].eliminatedRound, 3);
  assert.deepEqual(R.alivePlayers(next).map(p => p.id), ['p1', 'p3']);
});

test('canEliminate: zero picks, dead picks and wiping everyone are refused', () => {
  const ps = players(3);
  assert.equal(R.canEliminate(ps, []), 'Pick who is out first');
  assert.equal(R.canEliminate(ps, ['p0', 'p1', 'p2']), 'Someone has to stay in');
  assert.equal(R.canEliminate(ps, ['p0', 'p1']), null);
  const after = R.applyEliminations(ps, ['p0'], 1);
  assert.equal(R.canEliminate(after, ['p0']), 'That player is already out');
});

test('checkWinner: sole winner only when exactly one remains', () => {
  const ps = players(4);
  assert.equal(R.checkWinner(ps), null);
  const two = R.applyEliminations(ps, ['p0', 'p1'], 1);
  assert.equal(R.checkWinner(two), null, 'two left is not a win');
  const one = R.applyEliminations(two, ['p2'], 2);
  assert.equal(R.checkWinner(one).id, 'p3');
});

test('remainingMs: paused clocks keep their remaining time', () => {
  assert.equal(R.remainingMs({ deadline: 5000 }, 2000), 3000);
  assert.equal(R.remainingMs({ deadline: 5000 }, 9000), 0);
  assert.equal(R.remainingMs({ paused: true, pausedRemainingMs: 4200 }, 999999), 4200);
});

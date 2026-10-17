'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/rules/undercover-rules.js');

const A = 'Agent', S = 'Spy', W = 'Mr. White';
function p(id, role, alive = true) { return { id, name: id, role, word: null, alive }; }

test('validateCounts enforces the original setup rules', () => {
    assert.equal(R.validateCounts({ total: 4, mrWhite: 1, spies: 0 }).ok, true);
    assert.equal(R.validateCounts({ total: 4, mrWhite: 1, spies: 0 }).agents, 3);
    assert.equal(R.validateCounts({ total: 3, mrWhite: 1, spies: 0 }).ok, false, 'minimum 4 players');
    assert.equal(R.validateCounts({ total: 5, mrWhite: 0, spies: 0 }).ok, false, 'needs a Spy or Mr. White');
    assert.equal(R.validateCounts({ total: 4, mrWhite: 1, spies: 1 }).ok, false, 'agents must outnumber the rest');
    assert.equal(R.validateCounts({ total: 5, mrWhite: 1, spies: 1 }).ok, true);
    assert.equal(R.validateCounts({ total: 5, mrWhite: -1, spies: 1 }).ok, false);
});

test('assignRoles gives the right counts, words and leaves input untouched', () => {
    const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }, { id: 'e', name: 'E' }];
    const res = R.assignRoles(players, { mrWhite: 1, spies: 1 }, ['Tea', 'Coffee'], () => 0.3);
    assert.equal(res.players.length, 5);
    assert.equal(res.players.filter(x => x.role === W).length, 1);
    assert.equal(res.players.filter(x => x.role === S).length, 1);
    assert.equal(res.players.filter(x => x.role === A).length, 3);
    assert.ok(res.players.every(x => x.alive));
    assert.ok(['Tea', 'Coffee'].includes(res.agentWord));
    assert.notEqual(res.agentWord, res.spyWord);
    res.players.forEach(x => {
        if (x.role === A) assert.equal(x.word, res.agentWord);
        if (x.role === S) assert.equal(x.word, res.spyWord);
        if (x.role === W) assert.equal(x.word, null);
    });
    assert.equal(players[0].role, undefined, 'input not mutated');
    assert.throws(() => R.assignRoles(players.slice(0, 3), { mrWhite: 1, spies: 0 }, ['x', 'y']));
});

test('assignRoles randomises which word Agents get', () => {
    const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const r1 = R.assignRoles(players, { mrWhite: 1, spies: 0 }, ['Tea', 'Coffee'], () => 0.1);
    const r2 = R.assignRoles(players, { mrWhite: 1, spies: 0 }, ['Tea', 'Coffee'], () => 0.9);
    assert.equal(r1.agentWord, 'Tea');
    assert.equal(r2.agentWord, 'Coffee');
});

test('speakingOrder only includes alive players and covers all of them', () => {
    const players = [p('a', A), p('b', S), p('c', W, false), p('d', A)];
    const order = R.speakingOrder(players);
    assert.deepEqual([...order].sort(), ['a', 'b', 'd']);
});

test('eliminate marks one player out without mutating', () => {
    const players = [p('a', A), p('b', S)];
    const res = R.eliminate(players, 'b');
    assert.equal(res.eliminated.id, 'b');
    assert.equal(res.eliminated.role, S);
    assert.equal(res.players.find(x => x.id === 'b').alive, false);
    assert.equal(players[1].alive, true);
    assert.throws(() => R.eliminate(players, 'zz'));
});

test('Mr. White guesses the Agent word while an Agent is alive, else the Spy word', () => {
    const withAgent = [p('a', A), p('b', S), p('w', W, false)];
    assert.equal(R.mrWhiteTargetWord(withAgent, 'Tea', 'Coffee'), 'Tea');
    const noAgent = [p('a', A, false), p('b', S), p('c', S), p('w', W, false)];
    assert.equal(R.mrWhiteTargetWord(noAgent, 'Tea', 'Coffee'), 'Coffee');
});

test('isCorrectGuess ignores case and spacing, rejects empty', () => {
    assert.equal(R.isCorrectGuess('  vada   PAV ', 'Vada Pav'), true);
    assert.equal(R.isCorrectGuess('samosa', 'Vada Pav'), false);
    assert.equal(R.isCorrectGuess('', ''), false);
});

test('win: Agents win when all Spies and Mr. Whites are out', () => {
    assert.equal(R.checkWin([p('a', A), p('b', A), p('c', A), p('s', S, false), p('w', W, false)]).winner, 'agents');
});

test('win: Spies win on parity once all Mr. Whites are out', () => {
    assert.equal(R.checkWin([p('a', A), p('b', A), p('s', S), p('t', S), p('w', W, false)]).winner, 'spies');
    assert.equal(R.checkWin([p('a', A), p('s', S), p('t', S), p('w', W, false)]).winner, 'spies');
    assert.equal(R.checkWin([p('a', A), p('b', A), p('s', S), p('t', S), p('w', W)]), null, 'no parity win while a Mr. White lives');
});

test('win: Agent versus Spy 1v1 means Spy wins', () => {
    assert.equal(R.checkWin([p('a', A), p('s', S), p('w', W, false), p('b', A, false)]).winner, 'spies');
});

test('win: two players left with a Mr. White means Mr. White wins', () => {
    assert.equal(R.checkWin([p('a', A), p('w', W), p('b', A, false), p('c', A, false)]).winner, 'mrwhite');
    assert.equal(R.checkWin([p('s', S), p('w', W), p('b', A, false), p('c', A, false)]).winner, 'mrwhite');
    assert.equal(R.checkWin([p('w', W), p('x', W), p('b', A, false), p('c', A, false)]).winner, 'mrwhite');
});

test('win: the game continues otherwise', () => {
    assert.equal(R.checkWin([p('a', A), p('b', A), p('c', A), p('w', W)]), null);
    assert.equal(R.checkWin([p('a', A), p('s', S), p('w', W)]), null, '3 left, one of each');
    assert.equal(R.checkWin([p('a', A), p('b', A), p('s', S), p('w', W, false)]), null, 'agents still ahead');
});

test('win ordering: Mr. White rule beats Agent rules at two players', () => {
    // 1 Agent + 1 Mr. White: Mr. White wins, not "continue" and not agents
    const r = R.checkWin([p('a', A), p('w', W)]);
    assert.equal(r.winner, 'mrwhite');
});

test('voteTally: majority, tie, ignores dead voters and dead targets', () => {
    const alive = ['a', 'b', 'c', 'd'];
    let t = R.voteTally({ a: 'b', c: 'b', d: 'a' }, alive);
    assert.equal(t.top, 'b');
    assert.equal(t.tie, false);
    assert.deepEqual(t.counts, { b: 2, a: 1 });
    t = R.voteTally({ a: 'b', b: 'a' }, alive);
    assert.equal(t.top, null, 'tie means nobody out');
    assert.equal(t.tie, true);
    t = R.voteTally({ a: 'b', zombie: 'b', c: 'ghost' }, alive);
    assert.deepEqual(t.counts, { b: 1 });
    assert.deepEqual(t.voted, ['a']);
    t = R.voteTally({}, alive);
    assert.equal(t.top, null);
    assert.equal(t.tie, false);
});

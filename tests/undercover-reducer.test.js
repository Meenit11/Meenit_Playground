'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../server/games/undercover.js');

const seq = (...vals) => { let i = 0; return () => vals[(i++) % vals.length]; };
const rng = () => 0.42;

function room(names, settings) {
    let s = G.init({ code: '1234', hostId: 'h', hostName: names[0], settings });
    names.slice(1).forEach((n, i) => { s = G.join(s, { id: 'p' + (i + 1), name: n }); });
    return s;
}
function started(names, settings, r = rng) {
    return G.reduce(room(names, settings), { type: 'start' }, 'h', r);
}
function aliveIds(s) { return s.players.filter(p => p.alive).map(p => p.id); }
function roleOf(s, id) { return s.players.find(p => p.id === id).role; }
function byRole(s, role, alive = true) { return s.players.filter(p => p.role === role && p.alive === alive).map(p => p.id); }
function speakThrough(s) {
    while (s.phase === 'speaking') s = G.reduce(s, { type: 'nextSpeaker' }, 'h', rng);
    return s;
}
function gmEliminate(s, id) {
    s = speakThrough(s);
    s = G.reduce(s, { type: 'gmPick', payload: { targetId: id } }, 'h', rng);
    s = G.reduce(s, { type: 'confirmElimination' }, 'h', rng);
    return G.reduce(s, { type: 'continueRound' }, 'h', rng);
}

test('lobby: join, settings, start assigns roles and a speaking order', () => {
    let s = room(['Host', 'Priya', 'Rahul', 'Asha', 'Dev', 'Mira', 'Zoya'], { mrWhite: 1, spies: 1 });
    assert.equal(s.phase, 'lobby');
    assert.equal(s.players.length, 7);
    s = G.reduce(s, { type: 'setCounts', payload: { mrWhite: 1, spies: 2 } }, 'h');
    assert.equal(s.settings.spies, 2);
    s = G.reduce(s, { type: 'setVoteMode', payload: { voteMode: 'vote' } }, 'h');
    assert.equal(s.settings.voteMode, 'vote');
    assert.throws(() => G.reduce(s, { type: 'setVoteMode', payload: { voteMode: 'vote' } }, 'p1'), /host/);
    assert.throws(() => G.reduce(s, { type: 'setVoteMode', payload: { voteMode: 'nope' } }, 'h'));
    const before = JSON.stringify(s);
    const t = G.reduce(s, { type: 'start' }, 'h', rng);
    assert.equal(JSON.stringify(s), before, 'reduce never mutates input');
    assert.equal(t.phase, 'speaking');
    assert.equal(t.round, 1);
    assert.equal(t.order.length, 7);
    assert.equal(t.players.filter(p => p.role === 'Mr. White').length, 1);
    assert.equal(t.players.filter(p => p.role === 'Spy').length, 2);
    assert.ok(t.agentWord && t.spyWord && t.agentWord !== t.spyWord);
    assert.ok(t.version > s.version);
    assert.throws(() => G.join(t, { id: 'late', name: 'Late' }), /started/);
});

test('start refuses bad counts', () => {
    const s = room(['H', 'A', 'B', 'C'], { mrWhite: 1, spies: 1 });
    assert.throws(() => G.reduce(s, { type: 'start' }, 'h'), /outnumber/);
    assert.throws(() => G.reduce(room(['H', 'A', 'B'], { mrWhite: 1 }), { type: 'start' }, 'h'), /at least 4/);
});

test('view hides roles and words from other phones, shows own', () => {
    const s = started(['H', 'A', 'B', 'C', 'D', 'E'], { mrWhite: 1, spies: 1 });
    for (const me of s.players) {
        const v = G.view(s, me.id);
        assert.equal(v.me.role, me.role);
        assert.equal(v.me.word, me.word);
        assert.equal(v.agentWord, null);
        assert.equal(v.spyWord, null);
        v.players.forEach(p => assert.equal(p.role, null, 'alive roles hidden'));
        v.players.forEach(p => assert.equal(p.word, undefined, 'no word field on players'));
        assert.equal(JSON.stringify(v).includes('"usedPairs"'), false);
        if (me.id !== 'h') assert.equal(v.tally, undefined, 'tally only for the host during play');
    }
    const mrWhite = byRole(s, 'Mr. White')[0];
    assert.equal(G.view(s, mrWhite).me.word, null);
});

test('GM picks mode: full round, elimination reveals role publicly', () => {
    let s = started(['H', 'A', 'B', 'C', 'D', 'E'], { mrWhite: 1, spies: 1 });
    assert.throws(() => G.reduce(s, { type: 'vote', payload: { targetId: 'p1' } }, 'p2'), /host picks|Not possible/);
    assert.equal(G.view(s, 'p1').currentSpeakerId, s.order[0]);
    s = speakThrough(s);
    assert.equal(s.phase, 'vote');
    assert.throws(() => G.reduce(s, { type: 'confirmElimination' }, 'h'), /Pick who/);
    assert.throws(() => G.reduce(s, { type: 'gmPick', payload: { targetId: 'p1' } }, 'p1'), /host/);
    const victim = byRole(s, 'Agent')[0];
    s = G.reduce(s, { type: 'gmPick', payload: { targetId: victim } }, 'h');
    s = G.reduce(s, { type: 'confirmElimination' }, 'h');
    assert.equal(s.phase, 'result');
    assert.equal(s.eliminated.id, victim);
    const v = G.view(s, 'p3');
    assert.equal(v.players.find(p => p.id === victim).role, 'Agent', 'eliminated role is public');
    assert.equal(v.players.find(p => p.id === victim).alive, false);
    s = G.reduce(s, { type: 'continueRound' }, 'h', rng);
    assert.equal(s.phase, 'speaking');
    assert.equal(s.round, 2);
    assert.equal(s.order.length, 5);
    assert.ok(!s.order.includes(victim));
});

test('Everyone votes: majority out, dead players cannot vote, GM can override', () => {
    let s = started(['H', 'A', 'B', 'C', 'D', 'E'], { mrWhite: 1, spies: 1, voteMode: 'vote' });
    s = speakThrough(s);
    const ids = aliveIds(s);
    assert.throws(() => G.reduce(s, { type: 'vote', payload: { targetId: 'nobody' } }, 'p1'), /still in/);
    s = G.reduce(s, { type: 'vote', payload: { targetId: ids[1] } }, ids[0]);
    s = G.reduce(s, { type: 'vote', payload: { targetId: ids[1] } }, ids[2]);
    s = G.reduce(s, { type: 'vote', payload: { targetId: ids[1] } }, ids[3]);
    s = G.reduce(s, { type: 'vote', payload: { targetId: ids[0] } }, ids[4]);
    s = G.reduce(s, { type: 'vote', payload: { targetId: ids[0] } }, ids[1]);
    s = G.reduce(s, { type: 'vote', payload: { targetId: ids[1] } }, ids[5]);
    const hv = G.view(s, 'h');
    assert.equal(hv.allVoted, true);
    assert.equal(hv.tally.top, ids[1]);
    assert.equal(G.view(s, ids[2]).me.vote, ids[1]);
    // GM overrides the vote
    s = G.reduce(s, { type: 'gmPick', payload: { targetId: ids[4] } }, 'h');
    s = G.reduce(s, { type: 'confirmElimination' }, 'h');
    assert.equal(s.eliminated.id, ids[4], 'GM override wins over the tally');
    s = G.reduce(s, { type: 'continueRound' }, 'h', rng);
    if (s.phase === 'guess') s = G.reduce(s, { type: 'mrWhiteGuess', payload: { guess: 'zzz-wrong' } }, ids[4], rng);
    assert.equal(s.phase, 'speaking');
    assert.throws(() => G.reduce(speakThrough(s), { type: 'vote', payload: { targetId: ids[0] } }, ids[4]), /out/);
});

test('Everyone votes: a tie goes to the Game Master, who must pick', () => {
    let s = started(['H', 'A', 'B', 'C', 'D', 'E'], { mrWhite: 1, spies: 1, voteMode: 'vote' });
    s = speakThrough(s);
    const ids = aliveIds(s);
    s = G.reduce(s, { type: 'vote', payload: { targetId: ids[1] } }, ids[0]);
    s = G.reduce(s, { type: 'vote', payload: { targetId: ids[0] } }, ids[1]);
    assert.equal(G.view(s, 'h').tally.tie, true);
    assert.throws(() => G.reduce(s, { type: 'confirmElimination' }, 'h'), /tie/i);
    ids.slice(2).forEach(id => { s = G.reduce(s, { type: 'vote', payload: { targetId: id === ids[2] ? ids[0] : ids[1] } }, id); });
    assert.equal(G.view(s, ids[3]).tie, false, 'no longer tied once the other votes land');
    // force a real tie: 3 v 3
    s = G.reduce(s, { type: 'vote', payload: { targetId: ids[0] } }, ids[3]);
    assert.equal(G.view(s, ids[3]).tie, true, 'everyone sees the tie flag');
    assert.throws(() => G.reduce(s, { type: 'confirmElimination' }, 'h'), /tie/i);
    s = G.reduce(s, { type: 'gmPick', payload: { targetId: ids[1] } }, 'h');
    s = G.reduce(s, { type: 'confirmElimination' }, 'h');
    assert.equal(s.phase, 'result');
    assert.equal(s.eliminated.id, ids[1]);
    assert.equal(aliveIds(s).length, 5);
    const wasWhite = s.eliminated.role === G_ROLES_WHITE();
    s = G.reduce(s, { type: 'continueRound' }, 'h', rng);
    if (wasWhite) {
        assert.equal(s.phase, 'guess', 'Mr. White gets a guess first');
    } else {
        assert.equal(s.phase, 'speaking');
        assert.equal(s.round, 2);
    }
});
function G_ROLES_WHITE() { return require('../js/rules/undercover-rules.js').ROLES.WHITE; }

test('Mr. White eliminated guesses on their own phone; correct guess wins', () => {
    let s = started(['H', 'A', 'B', 'C', 'D', 'E'], { mrWhite: 1, spies: 1 });
    const white = byRole(s, 'Mr. White')[0];
    s = speakThrough(s);
    s = G.reduce(s, { type: 'gmPick', payload: { targetId: white } }, 'h');
    s = G.reduce(s, { type: 'confirmElimination' }, 'h');
    s = G.reduce(s, { type: 'continueRound' }, 'h', rng);
    assert.equal(s.phase, 'guess');
    assert.equal(s.guesserId, white);
    assert.equal(G.view(s, white).me.mustGuess, true);
    assert.equal(G.view(s, 'p2').me.mustGuess, white === 'p2');
    assert.equal(G.view(s, 'p2').guesserName, s.players.find(p => p.id === white).name);
    const other = aliveIds(s).find(id => id !== 'h');
    assert.throws(() => G.reduce(s, { type: 'mrWhiteGuess', payload: { guess: s.agentWord } }, other), /Only Mr. White/);
    assert.throws(() => G.reduce(s, { type: 'mrWhiteGuess', payload: { guess: '   ' } }, white), /Type a guess/);
    const won = G.reduce(s, { type: 'mrWhiteGuess', payload: { guess: s.agentWord.toUpperCase() } }, white, rng);
    assert.equal(won.phase, 'gameover');
    assert.equal(won.winner.winner, 'mrwhite');
    assert.equal(won.lastGuess.correct, true);
    const v = G.view(won, 'p1');
    assert.equal(v.agentWord, won.agentWord, 'words public at game over');
    v.players.forEach(p => assert.ok(p.role, 'all roles public at game over'));
});

test('Mr. White wrong guess continues; Agents are alive so the Spy word does not count', () => {
    let s = started(['H', 'A', 'B', 'C', 'D', 'E'], { mrWhite: 1, spies: 1 });
    const white = byRole(s, 'Mr. White')[0];
    s = speakThrough(s);
    s = G.reduce(s, { type: 'gmPick', payload: { targetId: white } }, 'h');
    s = G.reduce(s, { type: 'confirmElimination' }, 'h');
    s = G.reduce(s, { type: 'continueRound' }, 'h', rng);
    const t = G.reduce(s, { type: 'mrWhiteGuess', payload: { guess: s.spyWord } }, white, rng);
    assert.equal(t.phase, 'speaking');
    assert.equal(t.round, 2);
    assert.equal(t.lastGuess.correct, false);
});

test('Mr. White guesses the Spy word when no Agent is alive', () => {
    // 7 players: 4 agents, 2 spies, 1 white. Eliminate all agents first (whites keep the spies from winning).
    let s = started(['H', 'A', 'B', 'C', 'D', 'E', 'F'], { mrWhite: 1, spies: 2 });
    const white = byRole(s, 'Mr. White')[0];
    const agents = byRole(s, 'Agent');
    s = gmEliminate(s, agents[0]);
    s = gmEliminate(s, agents[1]);
    s = gmEliminate(s, agents[2]); // alive: 1 agent, 2 spies, 1 white -> continues
    assert.equal(s.phase, 'speaking');
    s = gmEliminate(s, agents[3]); // alive: 2 spies, 1 white -> continues (white alive blocks spy parity)
    assert.equal(s.phase, 'speaking');
    s = gmEliminate(s, white);
    assert.equal(s.phase, 'guess');
    const wrong = G.reduce(s, { type: 'mrWhiteGuess', payload: { guess: s.agentWord } }, white, rng);
    assert.equal(wrong.winner.winner, 'spies', 'agent word is wrong now, spies then win on parity');
    const right = G.reduce(s, { type: 'mrWhiteGuess', payload: { guess: s.spyWord } }, white, rng);
    assert.equal(right.winner.winner, 'mrwhite');
});

test('Agents win when every Spy and Mr. White is out', () => {
    let s = started(['H', 'A', 'B', 'C', 'D', 'E'], { mrWhite: 1, spies: 1 });
    const spy = byRole(s, 'Spy')[0];
    const white = byRole(s, 'Mr. White')[0];
    s = gmEliminate(s, spy);
    assert.equal(s.phase, 'speaking');
    s = gmEliminate(s, white);
    s = G.reduce(s, { type: 'mrWhiteGuess', payload: { guess: 'wrong' } }, white, rng);
    assert.equal(s.phase, 'gameover');
    assert.equal(s.winner.winner, 'agents');
});

test('Spies win on parity once all Mr. Whites are out', () => {
    let s = started(['H', 'A', 'B', 'C', 'D', 'E', 'F'], { mrWhite: 1, spies: 2 });
    const white = byRole(s, 'Mr. White')[0];
    const agents = byRole(s, 'Agent');
    s = gmEliminate(s, white);
    s = G.reduce(s, { type: 'mrWhiteGuess', payload: { guess: 'wrong' } }, white, rng);
    assert.equal(s.phase, 'speaking'); // 4 agents vs 2 spies
    s = gmEliminate(s, agents[0]); // 3 vs 2
    assert.equal(s.phase, 'speaking');
    s = gmEliminate(s, agents[1]); // 2 vs 2
    assert.equal(s.phase, 'gameover');
    assert.equal(s.winner.winner, 'spies');
});

test('Agent versus Spy 1v1 means Spy wins', () => {
    let s = started(['H', 'A', 'B', 'C'], { mrWhite: 0, spies: 1 });
    const agents = byRole(s, 'Agent');
    s = gmEliminate(s, agents[0]); // 2 agents vs 1 spy
    assert.equal(s.phase, 'speaking');
    s = gmEliminate(s, agents[1]); // 1 vs 1
    assert.equal(s.winner.winner, 'spies');
});

test('Two players left with a Mr. White means Mr. White wins', () => {
    let s = started(['H', 'A', 'B', 'C'], { mrWhite: 1, spies: 0 });
    const agents = byRole(s, 'Agent');
    s = gmEliminate(s, agents[0]);
    assert.equal(s.phase, 'speaking');
    s = gmEliminate(s, agents[1]);
    assert.equal(s.phase, 'gameover');
    assert.equal(s.winner.winner, 'mrwhite');
});

test('restart returns to the lobby keeping players and clearing secrets', () => {
    let s = started(['H', 'A', 'B', 'C'], { mrWhite: 1, spies: 0 });
    s = G.reduce(s, { type: 'restart' }, 'h');
    assert.equal(s.phase, 'lobby');
    assert.equal(s.players.length, 4);
    s.players.forEach(p => { assert.equal(p.role, null); assert.equal(p.alive, true); });
    assert.equal(s.agentWord, null);
    assert.throws(() => G.reduce(s, { type: 'restart' }, 'p1'), /host/);
    const again = G.reduce(s, { type: 'start' }, 'h', rng);
    assert.equal(again.phase, 'speaking');
});

test('leave and kick: removed in lobby, kept as disconnected during play', () => {
    let s = room(['H', 'A', 'B', 'C', 'D'], { mrWhite: 1 });
    s = G.reduce(s, { type: 'kick', payload: { playerId: 'p4' } }, 'h');
    assert.equal(s.players.length, 4);
    assert.throws(() => G.reduce(s, { type: 'kick', payload: { playerId: 'p1' } }, 'p2'), /host/);
    s = G.reduce(s, { type: 'start' }, 'h', rng);
    s = G.reduce(s, { type: 'leave' }, 'p1');
    assert.equal(s.players.length, 4);
    assert.equal(s.players.find(p => p.id === 'p1').connected, false);
    assert.throws(() => G.reduce(s, { type: 'nope' }, 'h'), /Unknown action/);
    assert.throws(() => G.reduce(s, { type: 'nextSpeaker' }, 'ghost'), /not in this room/);
});

test('word pairs rotate inside a room', () => {
    let s = room(['H', 'A', 'B', 'C'], { mrWhite: 1 });
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
        s = G.reduce(s, { type: 'start' }, 'h', seq(0.1, 0.2, 0.3, 0.4, 0.5));
        seen.add(s.agentWord + '|' + s.spyWord);
        s = G.reduce(s, { type: 'restart' }, 'h');
    }
    assert.equal(seen.size, 5);
});

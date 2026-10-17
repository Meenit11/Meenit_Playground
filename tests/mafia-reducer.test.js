const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../server/games/mafia.js');

/* Helpers: build a room, deal roles, and find players by role from the full (server) state. */
function room(names, settings) {
    let s = M.init({ code: '1234', hostId: 'h', hostName: names[0], settings });
    names.slice(1).forEach((n, i) => { s = M.join(s, { id: 'p' + i, name: n }); });
    return s;
}
function act(s, type, playerId, payload) { return M.reduce(s, { type, payload }, playerId); }
function byRole(s, role) { return s.players.filter(p => p.role === role); }
function alive(s) { return s.players.filter(p => p.alive); }

/* Force a deterministic deal by rewriting roles after start (we only edit the test's own copy). */
function deal(s, spec) {
    const out = JSON.parse(JSON.stringify(s));
    Object.keys(spec).forEach(id => { out.players.find(p => p.id === id).role = spec[id]; });
    const lover = out.players.find(p => p.role === 'lover');
    out.loverId = lover ? lover.id : null;
    return out;
}
function seeAll(s) {
    s.players.forEach(p => { s = act(s, 'seen', p.id); });
    return s;
}
function toNight(s) { return act(seeAll(s), 'nextPhase', 'h'); }
/* Every living member of each team picks the same target. */
function playNight(s, { mafia, doctor, detective, lover }) {
    if (lover) byRole(s, 'lover').filter(p => p.alive).forEach(l => { s = act(s, 'nightPick', l.id, { targetId: lover }); });
    [['doctor', doctor], ['detective', detective], ['mafia', mafia]].forEach(([role, t]) => {
        if (t) byRole(s, role).filter(p => p.alive).forEach(m => { if (s.phase === 'night') s = act(s, 'nightPick', m.id, { targetId: t }); });
    });
    return s;
}
/* votes: { voterId: targetId } */
function vote(s, votes) {
    Object.keys(votes).forEach(id => { s = act(s, 'vote', id, { targetId: votes[id] }); });
    return s;
}
function started(names, settings, spec) {
    let s = room(names, settings);
    s = act(s, 'start', 'h');
    return deal(s, spec);
}
/* Anything in a view that would reveal another player's role. */
function rolesSeen(v) { return v.players.filter(p => p.role && p.id !== v.me.id).map(p => p.id).sort(); }

const NINE = ['Host', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const NINE_SPEC = { h: 'mafia', p0: 'mafia', p1: 'doctor', p2: 'doctor', p3: 'detective', p4: 'detective', p5: 'civilian', p6: 'civilian', p7: 'civilian' };
const NINE_SETTINGS = { mafia: 2, doctor: 2, detective: 2 };

test('settings: counts only, no God mode, host only', () => {
    assert.throws(() => M.validateSettings({ doctor: 0 }), /Doctor/);
    assert.throws(() => M.validateSettings({ mafia: 0 }), /Mafia/);
    const v = M.validateSettings({ doctor: 3, mafia: 1, detective: 2, hostIsGm: true, dayMode: 'gm' });
    assert.deepEqual(v, { doctor: 3, mafia: 1, detective: 2, jester: 0, bomber: 0, lover: 0 }, 'God mode keys are dropped');
    let s = room(['Host', 'A', 'B', 'C', 'D']);
    assert.throws(() => act(s, 'setSettings', 'p0', { mafia: 2 }), /host/);
    s = act(s, 'setSettings', 'h', { detective: 2 });
    assert.equal(s.settings.detective, 2);
    assert.equal(M.view(s, 'h').settings.hostIsGm, undefined);
    assert.throws(() => act(s, 'gmPick', 'h', { targetId: 'p0' }), /Unknown action/);
    assert.throws(() => act(s, 'skipDay', 'h'), /Unknown action/);
});

test('start: counts validated against the room, host plays with a role', () => {
    let s = room(['Host', 'A', 'B', 'C']);
    assert.throws(() => act(s, 'start', 'h'), /at least 5/);
    s = M.join(s, { id: 'p9', name: 'E' });
    assert.throws(() => act(s, 'start', 'p0'), /host/);
    s = act(s, 'setSettings', 'h', { doctor: 2 });
    assert.throws(() => act(s, 'start', 'h'), /Doctors must be fewer than Civilians/);
    s = act(s, 'setSettings', 'h', { doctor: 1, detective: 2 });
    assert.throws(() => act(s, 'start', 'h'), /fewer than Civilians/);
    s = act(s, 'setSettings', 'h', { detective: 0 });
    const st = act(s, 'start', 'h');
    assert.equal(st.phase, 'roles');
    assert.equal(st.players.filter(p => p.role).length, 5, 'host has a role too');
    assert.ok(st.players.find(p => p.id === 'h').role);
    assert.equal(s.phase, 'lobby', 'reduce does not mutate input');
    assert.throws(() => M.join(st, { id: 'late', name: 'Late' }), /started/);
});

test('start night is gated on everyone having seen their role', () => {
    let s = started(['Host', 'A', 'B', 'C', 'D'], {}, { h: 'mafia', p0: 'doctor', p1: 'civilian', p2: 'civilian', p3: 'civilian' });
    assert.throws(() => act(s, 'nextPhase', 'h'), /Waiting for Host, A, B, C and D/);
    s = act(s, 'seen', 'h');
    s = act(s, 'seen', 'p0');
    assert.equal(s.phase, 'roles', 'seeing a role never starts the night by itself');
    assert.match(M.view(s, 'h').waiting.text, /Waiting for B, C and D/);
    assert.throws(() => act(s, 'nextPhase', 'h'), /Waiting for B, C and D/);
    s = act(s, 'seen', 'p1'); s = act(s, 'seen', 'p2'); s = act(s, 'seen', 'p3');
    assert.match(M.view(s, 'p1').waiting.text, /Waiting for Host to start the night/);
    assert.throws(() => act(s, 'nextPhase', 'p1'), /Only the host/);
    s = act(s, 'nextPhase', 'h');
    assert.equal(s.phase, 'night'); assert.equal(s.round, 1);
});

test('Mafia disagreement keeps the night open; picks change until all agree, then lock', () => {
    let s = toNight(started(NINE, NINE_SETTINGS, NINE_SPEC));
    s = playNight(s, { doctor: 'p7', detective: 'p6' });
    s = act(s, 'nightPick', 'h', { targetId: 'p5' });
    s = act(s, 'nightPick', 'p0', { targetId: 'p6' });
    assert.equal(s.phase, 'night', 'Mafia disagree, night stays open');
    const mv = M.view(s, 'h');
    assert.equal(mv.me.night.locked, null);
    assert.deepEqual(mv.me.night.members.map(m => [m.name, m.pickName]), [['Host', 'F'], ['A', 'G']]);
    assert.match(mv.waiting.text, /Waiting for A to agree/);
    assert.throws(() => act(s, 'nightPick', 'h', { targetId: 'p0' }), /cannot target the Mafia/);
    s = act(s, 'nightPick', 'h', { targetId: 'p7' }); // change of mind
    assert.equal(s.phase, 'night');
    // one-tap agree: A copies Host's pick
    s = act(s, 'nightPick', 'p0', { targetId: M.view(s, 'p0').me.night.members.find(m => m.id === 'h').pick });
    assert.equal(s.phase, 'morning', 'all teams locked, the night resolves automatically');
    assert.equal(s.lastNight.deadId, null, 'Doctors protected G');
    assert.equal(s.lastNight.saved, true);
});

test('Mafia lock: once agreed, no more changes', () => {
    let s = toNight(started(NINE, NINE_SETTINGS, NINE_SPEC));
    s = act(s, 'nightPick', 'h', { targetId: 'p5' });
    s = act(s, 'nightPick', 'p0', { targetId: 'p5' });
    assert.equal(s.phase, 'night', 'Doctors and Detectives still choosing');
    assert.equal(M.view(s, 'p0').me.night.lockedName, 'F');
    assert.throws(() => act(s, 'nightPick', 'h', { targetId: 'p6' }), /locked/);
});

test('multiple Doctors must agree; Doctors may protect themselves', () => {
    let s = toNight(started(NINE, NINE_SETTINGS, NINE_SPEC));
    s = playNight(s, { mafia: 'p1', detective: 'p5' });
    s = act(s, 'nightPick', 'p1', { targetId: 'p1' });
    s = act(s, 'nightPick', 'p2', { targetId: 'p7' });
    assert.equal(s.phase, 'night', 'Doctors disagree');
    const dv = M.view(s, 'p1');
    assert.deepEqual(dv.me.night.members.map(m => [m.name, m.pickName]), [['B', 'B'], ['C', 'H']]);
    assert.deepEqual(rolesSeen(dv), ['p2'], 'a Doctor sees only the fellow Doctor');
    s = act(s, 'nightPick', 'p2', { targetId: 'p1' });
    assert.equal(s.phase, 'morning');
    assert.equal(s.lastNight.deadId, null, 'self-protecting Doctor survives');
});

test('multiple Detectives agree; every living Detective sees the result at night and in the morning', () => {
    let s = toNight(started(NINE, NINE_SETTINGS, NINE_SPEC));
    assert.throws(() => act(s, 'nightPick', 'p3', { targetId: 'p4' }), /fellow Detective/);
    assert.throws(() => act(s, 'nightPick', 'p3', { targetId: 'p3' }), /fellow Detective/);
    s = act(s, 'nightPick', 'p3', { targetId: 'h' });
    assert.equal(M.view(s, 'p3').me.night.result, null, 'no result until both agree');
    s = act(s, 'nightPick', 'p4', { targetId: 'p0' });
    assert.equal(M.view(s, 'p4').me.night.result, null);
    s = act(s, 'nightPick', 'p4', { targetId: 'h' });
    ['p3', 'p4'].forEach(id => {
        const v = M.view(s, id);
        assert.equal(v.me.night.result.targetId, 'h');
        assert.equal(v.me.night.result.isMafia, true);
        assert.equal(v.players.find(p => p.id === 'h').role, undefined, 'result is a fact, not a role reveal');
    });
    assert.throws(() => act(s, 'nightPick', 'p3', { targetId: 'p5' }), /locked/);
    s = playNight(s, { mafia: 'p5', doctor: 'p6' });
    assert.equal(s.phase, 'morning');
    ['p3', 'p4'].forEach(id => assert.equal(M.view(s, id).me.investigations.find(i => i.round === 1).isMafia, true));
    ['h', 'p0', 'p1', 'p2', 'p6', 'p7'].forEach(id => {
        const v = M.view(s, id);
        assert.equal(v.me.investigations, undefined, id + ' gets no detective result');
        assert.equal(JSON.stringify(v).includes('isMafia'), false, id + ' view has no isMafia');
    });
});

test('a single Doctor or Detective locks on their own pick', () => {
    let s = toNight(started(['Host', 'A', 'B', 'C', 'D', 'E'], { detective: 1 }, { h: 'mafia', p0: 'doctor', p1: 'detective', p2: 'civilian', p3: 'civilian', p4: 'civilian' }));
    s = act(s, 'nightPick', 'p0', { targetId: 'p2' });
    assert.equal(M.view(s, 'p0').me.night.locked, 'p2');
    s = act(s, 'nightPick', 'p1', { targetId: 'p2' });
    assert.equal(M.view(s, 'p1').me.night.result.isMafia, false);
    s = act(s, 'nightPick', 'h', { targetId: 'p3' });
    assert.equal(s.phase, 'morning');
    assert.equal(s.lastNight.deadId, 'p3');
});

test('night waiting: team members see names, everyone else only a count', () => {
    let s = toNight(started(NINE, NINE_SETTINGS, NINE_SPEC));
    s = act(s, 'nightPick', 'h', { targetId: 'p5' });
    const civ = M.view(s, 'p5');
    assert.deepEqual(civ.waiting.names, []);
    assert.match(civ.waiting.text, /^Waiting for the night to end \(\d+ still choosing\)$/);
    assert.equal(civ.me.night, undefined);
    const host = M.view(s, 'h');
    assert.match(host.waiting.text, /Waiting for A to agree/);
    const doc = M.view(s, 'p1');
    assert.equal(doc.waiting.text.includes('Host'), false, 'Doctor is not told which players are Mafia');
});

test('Lover picks a partner alone on night 1; the night waits for it', () => {
    let s = toNight(started(['Host', 'A', 'B', 'C', 'D', 'E'], { lover: 1 }, { h: 'mafia', p0: 'doctor', p1: 'lover', p2: 'civilian', p3: 'civilian', p4: 'civilian' }));
    s = playNight(s, { mafia: 'p2', doctor: 'p0' });
    assert.equal(s.phase, 'night', 'still waiting for the Lover');
    assert.equal(M.view(s, 'p1').me.night.needsPartner, true);
    assert.throws(() => act(s, 'nightPick', 'p1', { targetId: 'p1' }), /someone else/);
    s = act(s, 'nightPick', 'p1', { targetId: 'p3' });
    assert.equal(s.phase, 'morning');
    assert.equal(s.loverPartnerId, 'p3');
    assert.equal(M.view(s, 'p1').me.partnerId, 'p3');
    ['h', 'p0', 'p2', 'p3', 'p4'].forEach(id => assert.equal(JSON.stringify(M.view(s, id)).includes('"partnerId"'), false, id + ' does not learn the partner'));
    // night 2 does not wait for the Lover
    s = act(s, 'nextPhase', 'h');
    s = vote(s, { h: 'p4', p0: 'p4', p1: 'p4', p3: 'p4', p4: 'h' });
    assert.equal(s.phase, 'dusk');
    s = act(s, 'nextPhase', 'h');
    assert.throws(() => act(s, 'nightPick', 'p1', { targetId: 'p0' }), /already chosen/);
    s = playNight(s, { mafia: 'p3', doctor: 'p0' });
    assert.equal(s.phase, 'morning');
    assert.equal(s.lastNight.deadId, 'p1', 'Lover dies for the partner at night');
    assert.equal(s.players.find(p => p.id === 'p3').alive, true);
});

test('day vote: no self-vote, votes change until the last vote locks the round', () => {
    let s = toNight(started(NINE, NINE_SETTINGS, NINE_SPEC));
    s = playNight(s, { mafia: 'p7', doctor: 'p7', detective: 'p5' });
    s = act(s, 'nextPhase', 'h');
    assert.equal(s.phase, 'day');
    assert.throws(() => act(s, 'vote', 'p5', { targetId: 'p5' }), /yourself/);
    s = vote(s, { h: 'p5', p0: 'p5', p1: 'h', p2: 'h', p3: 'h', p4: 'h', p5: 'h' });
    s = act(s, 'vote', 'p5', { targetId: 'p0' }); // change
    assert.equal(s.day.votes.p5, 'p0');
    assert.match(M.view(s, 'p5').waiting.text, /Waiting for G and H to vote/);
    const pub = M.view(s, 'p6');
    assert.equal(pub.players.find(p => p.id === 'p5').voted, true);
    assert.equal(JSON.stringify(pub).includes('"votes"'), false, 'who voted whom stays private until the lock');
    s = vote(s, { p6: 'h', p7: 'h' });
    assert.equal(s.phase, 'dusk');
    assert.equal(s.lastDay.deadId, 'h');
    assert.throws(() => act(s, 'vote', 'p5', { targetId: 'p0' }), /during dusk/);
});

test('tie: revote between the tied players only, shown as Revote 1 of 3', () => {
    let s = toNight(started(NINE, NINE_SETTINGS, NINE_SPEC));
    s = playNight(s, { mafia: 'p7', doctor: 'p7', detective: 'p5' });
    s = act(s, 'nextPhase', 'h');
    // 9 alive: 4 for h, 4 for p5, 1 for p6
    s = vote(s, { p0: 'h', p1: 'h', p2: 'h', p3: 'h', h: 'p5', p4: 'p5', p6: 'p5', p7: 'p5', p5: 'p6' });
    assert.equal(s.phase, 'day');
    const v = M.view(s, 'p6');
    assert.equal(v.day.revote, 1);
    assert.equal(v.day.maxRevotes, 3);
    assert.deepEqual(v.day.candidates.sort(), ['h', 'p5']);
    assert.equal(v.players.every(p => !p.voted), true, 'everyone votes again');
    assert.throws(() => act(s, 'vote', 'p6', { targetId: 'p7' }), /tied players/);
    assert.throws(() => act(s, 'vote', 'h', { targetId: 'h' }), /yourself/);
    s = vote(s, { h: 'p5', p0: 'p5', p1: 'p5', p2: 'p5', p3: 'p5', p4: 'p5', p5: 'h', p6: 'h', p7: 'h' });
    assert.equal(s.phase, 'dusk');
    assert.equal(s.lastDay.deadId, 'p5');
    assert.equal(s.lastDay.revotes, 1);
});

test('three tied revotes in a row: nobody is out and the game goes to dusk', () => {
    let s = toNight(started(NINE, NINE_SETTINGS, NINE_SPEC));
    s = playNight(s, { mafia: 'p7', doctor: 'p6', detective: 'p5' });
    s = act(s, 'nextPhase', 'h');
    assert.equal(alive(s).length, 8);
    const tie = { h: 'p5', p0: 'p5', p1: 'p5', p2: 'p5', p3: 'h', p4: 'h', p5: 'h', p6: 'h' };
    s = vote(s, tie);
    assert.equal(s.day.revote, 1);
    s = vote(s, tie);
    assert.equal(s.day.revote, 2);
    s = vote(s, tie);
    assert.equal(s.day.revote, 3);
    assert.equal(s.phase, 'day');
    s = vote(s, tie);
    assert.equal(s.phase, 'dusk');
    assert.equal(s.lastDay.deadId, null);
    assert.equal(s.lastDay.tie, true);
    assert.equal(s.lastDay.revotes, 3);
    assert.match(s.lastDay.text, /Still tied after 3 revotes\. Nobody is out today/);
    assert.equal(alive(s).length, 8);
});

test('Jester voted out wins instantly; Jester never counts for parity', () => {
    let s = toNight(started(['Host', 'A', 'B', 'C', 'D', 'E'], { jester: 1 }, { h: 'mafia', p0: 'doctor', p1: 'jester', p2: 'civilian', p3: 'civilian', p4: 'civilian' }));
    s = playNight(s, { mafia: 'p2', doctor: 'p0' });
    s = act(s, 'nextPhase', 'h');
    s = vote(s, { h: 'p1', p0: 'p1', p1: 'h', p3: 'p1', p4: 'p1' });
    assert.equal(s.phase, 'ended');
    assert.equal(s.winner, 'jester');
    assert.equal(M.view(s, 'p4').players.find(p => p.id === 'p1').role, 'jester');

    let u = toNight(started(['Host', 'A', 'B', 'C', 'D'], { jester: 1 }, { h: 'mafia', p0: 'doctor', p1: 'jester', p2: 'civilian', p3: 'civilian' }));
    u = playNight(u, { mafia: 'p2', doctor: 'p0' });
    u = act(u, 'nextPhase', 'h');
    u = vote(u, { h: 'p3', p0: 'p3', p1: 'p3', p3: 'h' });
    assert.equal(u.winner, 'mafia', 'Mafia 1 vs Doctor 1 plus Jester is parity');
});

test('Bomber voted out takes one living player along', () => {
    let s = toNight(started(['Host', 'A', 'B', 'C', 'D', 'E'], { bomber: 1 }, { h: 'mafia', p0: 'doctor', p1: 'bomber', p2: 'civilian', p3: 'civilian', p4: 'civilian' }));
    s = playNight(s, { mafia: 'p2', doctor: 'p2' });
    s = act(s, 'nextPhase', 'h');
    s = vote(s, { h: 'p1', p0: 'p1', p1: 'h', p2: 'p1', p3: 'p1', p4: 'p1' });
    assert.equal(s.phase, 'bomber');
    assert.match(M.view(s, 'p3').waiting.text, /Waiting for B to choose/);
    assert.throws(() => act(s, 'bomberPick', 'h', { targetId: 'p0' }), /Bomber/);
    s = act(s, 'bomberPick', 'p1', { targetId: 'h' });
    assert.equal(s.phase, 'ended');
    assert.equal(s.winner, 'civilians');
    assert.match(s.lastDay.text, /B was voted out\. The Bomber took Host along/);
});

test('Lover redirect by day vote and by Bomber pick', () => {
    let s = toNight(started(['Host', 'A', 'B', 'C', 'D', 'E', 'F', 'G'], { mafia: 1, lover: 1, bomber: 1 }, { h: 'mafia', p0: 'doctor', p1: 'lover', p2: 'bomber', p3: 'civilian', p4: 'civilian', p5: 'civilian', p6: 'civilian' }));
    s = playNight(s, { mafia: 'p3', doctor: 'p3', lover: 'p4' });
    s = act(s, 'nextPhase', 'h');
    s = vote(s, { h: 'p4', p0: 'p4', p1: 'p4', p2: 'p4', p3: 'p4', p4: 'h', p5: 'p4', p6: 'p4' });
    assert.equal(s.phase, 'dusk');
    assert.equal(s.lastDay.deadId, 'p1', 'Lover dies instead of the partner');
    assert.equal(s.players.find(p => p.id === 'p4').alive, true);
    assert.match(s.lastDay.text, /E was voted out, but B stepped in and died instead/);

    let b = toNight(started(['Host', 'A', 'B', 'C', 'D', 'E', 'F', 'G'], { mafia: 1, lover: 1, bomber: 1 }, { h: 'mafia', p0: 'doctor', p1: 'lover', p2: 'bomber', p3: 'civilian', p4: 'civilian', p5: 'civilian', p6: 'civilian' }));
    b = playNight(b, { mafia: 'p3', doctor: 'p3', lover: 'p4' });
    b = act(b, 'nextPhase', 'h');
    b = vote(b, { h: 'p2', p0: 'p2', p1: 'p2', p2: 'h', p3: 'p2', p4: 'p2', p5: 'p2', p6: 'p2' });
    b = act(b, 'bomberPick', 'p2', { targetId: 'p4' });
    assert.equal(b.lastDay.bomberVictimId, 'p1');
    assert.equal(b.players.find(p => p.id === 'p4').alive, true);
});

test('dead players spectate with public info only and never vote', () => {
    let s = toNight(started(NINE, NINE_SETTINGS, NINE_SPEC));
    s = playNight(s, { mafia: 'p3', doctor: 'p7', detective: 'h' });
    assert.equal(s.lastNight.deadId, 'p3');
    const dead = M.view(s, 'p3');
    assert.equal(dead.me.alive, false);
    assert.deepEqual(rolesSeen(dead), [], 'dead Detective no longer sees team roles');
    assert.equal(dead.me.investigations, undefined, 'dead Detective loses private results');
    assert.equal(dead.me.mates, undefined);
    s = act(s, 'nextPhase', 'h');
    assert.throws(() => act(s, 'vote', 'p3', { targetId: 'h' }), /living/);
    assert.throws(() => act(s, 'vote', 'p5', { targetId: 'p3' }), /living/);
});

test('privacy: every view, including the host, carries only that player\'s secrets', () => {
    let s = toNight(started(NINE, NINE_SETTINGS, NINE_SPEC));
    s = act(s, 'nightPick', 'h', { targetId: 'p5' });
    s = act(s, 'nightPick', 'p1', { targetId: 'p6' });
    s = act(s, 'nightPick', 'p3', { targetId: 'p7' });
    const expectRoles = { h: ['p0'], p0: ['h'], p1: ['p2'], p2: ['p1'], p3: ['p4'], p4: ['p3'], p5: [], p6: [], p7: [] };
    Object.keys(expectRoles).forEach(id => {
        const v = M.view(s, id);
        assert.deepEqual(rolesSeen(v), expectRoles[id].sort(), id + ' sees only own team roles');
        const json = JSON.stringify(v);
        assert.equal(json.includes('picks'), false, id + ': raw picks never leave the server');
        assert.equal(v.me.isGm, undefined);
        const team = NINE_SPEC[id];
        if (['mafia', 'doctor', 'detective'].includes(team)) {
            assert.equal(v.me.night.team, team);
            assert.ok(v.me.night.members.every(m => NINE_SPEC[m.id] === team), id + ' sees only own team picks');
        } else {
            assert.equal(v.me.night, undefined, id + ' has no night panel');
        }
    });
    const host = M.view(s, 'h');
    assert.equal(host.me.isHost, true);
    assert.equal(host.players.find(p => p.id === 'p1').role, undefined, 'host does not see the Doctor');
    assert.equal(host.me.investigations, undefined);
    // end of game: everything is revealed to everyone
    s = playNight(s, { mafia: 'p5', doctor: 'p6', detective: 'p7' });
    s = act(s, 'nextPhase', 'h');
    const everyoneVotes = (target, targetVotes) => { const v = {}; alive(s).forEach(p => { v[p.id] = p.id === target ? targetVotes : target; }); return v; };
    s = vote(s, everyoneVotes('h', 'p6'));
    assert.equal(s.lastDay.deadId, 'h');
    s = act(s, 'nextPhase', 'h');
    s = playNight(s, { mafia: 'p6', doctor: 'p7', detective: 'p0' });
    s = act(s, 'nextPhase', 'h');
    s = vote(s, everyoneVotes('p0', 'p7'));
    assert.equal(s.phase, 'ended');
    assert.equal(s.winner, 'civilians');
    assert.equal(M.view(s, 'p5').players.filter(p => p.role).length, 9, 'roles revealed at the end');
});

test('full game through restart: host keeps the room, roles cleared', () => {
    let s = toNight(started(['Host', 'A', 'B', 'C', 'D'], {}, { h: 'civilian', p0: 'mafia', p1: 'doctor', p2: 'civilian', p3: 'civilian' }));
    s = playNight(s, { mafia: 'p2', doctor: 'p1' });
    assert.equal(s.lastNight.deadId, 'p2');
    assert.match(M.view(s, 'p3').waiting.text, /Waiting for Host to start the day/);
    s = act(s, 'nextPhase', 'h');
    s = vote(s, { h: 'p0', p0: 'h', p1: 'p0', p3: 'p0' });
    assert.equal(s.winner, 'civilians');
    s = act(s, 'restart', 'h');
    assert.equal(s.phase, 'lobby');
    assert.equal(s.players.length, 5);
    assert.ok(s.players.every(p => p.role === null && p.alive && !p.seen));
});

test('lobby: leave, kick, host handover; in-game leave keeps the seat', () => {
    let s = room(['Host', 'A', 'B', 'C', 'D']);
    assert.throws(() => act(s, 'kick', 'p0', { targetId: 'p1' }), /host/);
    s = act(s, 'kick', 'h', { targetId: 'p1' });
    assert.equal(s.players.length, 4);
    s = act(s, 'leave', 'h');
    assert.equal(s.hostId, 'p0');
    assert.equal(s.players[0].isHost, true);
    s = M.join(s, { id: 'x', name: 'X' });
    s = M.join(s, { id: 'y', name: 'Y' });
    s = act(s, 'start', 'p0');
    s = act(s, 'leave', 'x');
    assert.equal(s.players.find(p => p.id === 'x').connected, false);
    assert.equal(s.players.length, 5);
});

test('room holds at most 20 players', () => {
    let s = room(['Host']);
    for (let i = 0; i < 19; i++) s = M.join(s, { id: 'q' + i, name: 'Q' + i });
    assert.equal(s.players.length, 20);
    assert.throws(() => M.join(s, { id: 'z', name: 'Z' }), /full/);
});

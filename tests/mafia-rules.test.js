const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/rules/mafia-rules.js');

function mk(spec) {
    // spec: { id: role }
    return Object.keys(spec).map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), role: spec[id], alive: true }));
}
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('validateCounts: 5-player minimum', () => {
    assert.equal(R.validateCounts({ doctor: 1, mafia: 1 }, 4).ok, false);
    const v = R.validateCounts({ doctor: 1, mafia: 1 }, 5);
    assert.equal(v.ok, true);
    assert.equal(v.counts.civilian, 3);
});

test('validateCounts: doctor compulsory, mafia minimum 1', () => {
    assert.match(R.validateCounts({ doctor: 0, mafia: 1 }, 6).error, /Doctor/);
    assert.match(R.validateCounts({ doctor: 1, mafia: 0 }, 6).error, /Mafia/);
});

test('validateCounts: Doctors must be fewer than Civilians', () => {
    // 8 players, 2 Doctors, 1 Mafia: 5 Civilians, fine
    assert.equal(R.validateCounts({ doctor: 2, mafia: 1 }, 8).ok, true);
    // 5 players, 2 Doctors, 1 Mafia: 2 Civilians, Doctors not fewer
    assert.match(R.validateCounts({ doctor: 2, mafia: 1 }, 5).error, /Doctors must be fewer than Civilians/);
    // exactly one fewer is fine: 3 Doctors, 4 Civilians
    assert.equal(R.validateCounts({ doctor: 3, mafia: 1 }, 8).ok, true);
    assert.equal(R.validateCounts({ doctor: 4, mafia: 1 }, 8).ok, false);
});

test('validateCounts: the old Doctor vs Mafia cap is gone', () => {
    const v = R.validateCounts({ doctor: 3, mafia: 1 }, 10);
    assert.equal(v.ok, true, 'more Doctors than Mafia is allowed now');
    assert.equal(v.counts.civilian, 6);
});

test('validateCounts: Detective 0 or more, fewer than Civilians', () => {
    assert.equal(R.validateCounts({ doctor: 1, mafia: 1, detective: 0 }, 5).ok, true);
    const two = R.validateCounts({ doctor: 2, mafia: 1, detective: 2 }, 8);
    assert.equal(two.ok, true);
    assert.equal(two.counts.detective, 2);
    assert.equal(two.counts.civilian, 3);
    assert.match(R.validateCounts({ doctor: 1, mafia: 1, detective: 2 }, 6).error, /Detectives must be fewer than Civilians/);
    assert.equal(R.validateCounts({ doctor: 2, mafia: 1, detective: 2 }, 7).ok, false, '2 Doctors and 2 Detectives need 3 Civilians');
});

test('validateCounts: Jester, Bomber and Lover are 0 or 1 and civilians fill the rest', () => {
    const v = R.validateCounts({ doctor: 1, mafia: 1, detective: 1, jester: 'yes', bomber: 0, lover: 3 }, 8);
    assert.equal(v.ok, true);
    assert.deepEqual(v.counts, { doctor: 1, mafia: 1, detective: 1, jester: 1, bomber: 0, lover: 1, civilian: 3 });
    assert.equal(R.validateCounts({ doctor: 1, mafia: 1, jester: 1, bomber: 1, lover: 1 }, 5).ok, false, 'needs at least one civilian');
    assert.equal(R.validateCounts({ doctor: 1, mafia: 1 }, 21).ok, false, '20 players max');
});

test('countLimits: live stepper limits with a short reason', () => {
    let l = R.countLimits({ doctor: 1, mafia: 1, detective: 0 }, 5);
    assert.equal(l.doctor.canAdd, false);
    assert.match(l.doctor.reason, /Doctors must be fewer than Civilians/);
    assert.equal(l.detective.canAdd, true);
    assert.equal(l.mafia.canAdd, true);
    assert.equal(l.mafia.canRemove, false);
    assert.equal(l.doctor.canRemove, false);
    assert.equal(l.detective.canRemove, false);
    l = R.countLimits({ doctor: 1, mafia: 1, detective: 1 }, 6);
    assert.equal(l.detective.canAdd, false);
    assert.match(l.detective.reason, /Detectives must be fewer than Civilians/);
    assert.equal(l.detective.canRemove, true);
    l = R.countLimits({ doctor: 2, mafia: 1, detective: 2 }, 8);
    assert.equal(l.doctor.canAdd, false);
    assert.equal(l.mafia.canAdd, false, 'another Mafia would leave 2 Civilians for 2 Doctors');
});

test('assignRoles deals exactly the configured roles', () => {
    const players = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    const out = R.assignRoles(players, { doctor: 2, mafia: 1, detective: 1, lover: 1 });
    const count = out.reduce((m, p) => (m[p.role] = (m[p.role] || 0) + 1, m), {});
    assert.deepEqual(count, { doctor: 2, mafia: 1, detective: 1, lover: 1, civilian: 3 });
    assert.ok(out.every(p => p.alive === true));
    assert.ok(players.every(p => p.role === undefined), 'input not mutated');
    assert.throws(() => R.assignRoles(players.slice(0, 4), { doctor: 1, mafia: 1 }), /at least 5/);
});

test('resolveNight: mafia kill, doctor save, save same person on consecutive nights', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', c: 'civilian', d: 'civilian', e: 'civilian' });
    let r = R.resolveNight(ps, { mafiaTarget: 'c', doctorSave: 'd' });
    assert.equal(r.deadId, 'c');
    assert.equal(R.byId(r.players, 'c').alive, false);
    assert.equal(R.byId(ps, 'c').alive, true, 'input not mutated');
    r = R.resolveNight(ps, { mafiaTarget: 'c', doctorSave: 'c' });
    assert.equal(r.deadId, null); assert.equal(r.saved, true);
    r = R.resolveNight(r.players, { mafiaTarget: 'c', doctorSave: 'c' });
    assert.equal(r.deadId, null, 'same save allowed next night');
});

test('resolveNight: doctor may save themselves', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', c: 'civilian', d: 'civilian', e: 'civilian' });
    const r = R.resolveNight(ps, { mafiaTarget: 'b', doctorSave: 'b' });
    assert.equal(r.deadId, null); assert.equal(r.saved, true);
});

test('resolveNight: no target means nobody dies', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', c: 'civilian', d: 'civilian', e: 'civilian' });
    const r = R.resolveNight(ps, { mafiaTarget: null, doctorSave: 'c' });
    assert.equal(r.deadId, null); assert.equal(r.saved, false);
});

test('Lover: night 1 partner pick, partner targeted, lover dies instead', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', l: 'lover', d: 'civilian', e: 'civilian' });
    const r = R.resolveNight(ps, { mafiaTarget: 'd', doctorSave: 'e', loverPartner: 'd' });
    assert.equal(r.deadId, 'l'); assert.equal(r.redirected, true); assert.equal(r.targetId, 'd');
    assert.equal(R.byId(r.players, 'd').alive, true);
    assert.equal(r.partnerId, 'd');
    // Next night the partner is targeted again: lover is dead, partner dies.
    const r2 = R.resolveNight(r.players, { mafiaTarget: 'd', doctorSave: 'e' }, { loverId: 'l', partnerId: 'd' });
    assert.equal(r2.deadId, 'd'); assert.equal(r2.redirected, false);
});

test('Lover: lover themself targeted dies normally; partner saved by doctor means nobody dies', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', l: 'lover', d: 'civilian', e: 'civilian' });
    const ctx = { loverId: 'l', partnerId: 'd' };
    let r = R.resolveNight(ps, { mafiaTarget: 'l', doctorSave: 'e' }, ctx);
    assert.equal(r.deadId, 'l'); assert.equal(r.redirected, false);
    r = R.resolveNight(ps, { mafiaTarget: 'd', doctorSave: 'd' }, ctx);
    assert.equal(r.deadId, null); assert.equal(r.saved, true);
    assert.equal(R.byId(r.players, 'l').alive, true);
});

test('Lover: partner voted out by day, lover dies instead and partner survives', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', l: 'lover', d: 'civilian', e: 'civilian' });
    const r = R.applyDayElimination(ps, 'd', { loverId: 'l', partnerId: 'd' });
    assert.equal(r.deadId, 'l'); assert.equal(r.redirected, true);
    assert.equal(R.byId(r.players, 'd').alive, true);
    assert.equal(r.jesterWin, false); assert.equal(r.bomberPending, false);
});

test('Lover: partner is Jester and voted out: lover dies, no Jester win', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', l: 'lover', j: 'jester', e: 'civilian' });
    const r = R.applyDayElimination(ps, 'j', { loverId: 'l', partnerId: 'j' });
    assert.equal(r.deadId, 'l'); assert.equal(r.jesterWin, false);
});

test('Jester wins when voted out, even at parity, and never counts toward parity', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', j: 'jester', d: 'civilian', e: 'civilian' });
    // 1 mafia vs doctor + 2 civilians: no winner yet
    assert.equal(R.checkWin(ps), null);
    const r = R.applyDayElimination(ps, 'j', {});
    assert.equal(r.jesterWin, true);
    // Jester excluded from parity: mafia 1 vs town 1 => mafia wins, jester alive does not help town
    const ps2 = mk({ a: 'mafia', b: 'doctor', j: 'jester' });
    assert.equal(R.checkWin(ps2), 'mafia');
    // Jester voted at parity: 1 mafia, 1 doctor, 1 jester: jester still wins by vote
    const r2 = R.applyDayElimination(ps2, 'j', {});
    assert.equal(r2.jesterWin, true);
});

test('Jester killed at night does not win', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', j: 'jester', d: 'civilian', e: 'civilian' });
    const r = R.resolveNight(ps, { mafiaTarget: 'j', doctorSave: 'd' });
    assert.equal(r.deadId, 'j');
    assert.equal(R.checkWin(r.players), null);
});

test('Bomber: voted out takes one player along; night-killed bomber does nothing', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', bo: 'bomber', d: 'civilian', e: 'civilian', f: 'civilian' });
    const r = R.applyDayElimination(ps, 'bo', {});
    assert.equal(r.bomberPending, true);
    const r2 = R.applyBomber(r.players, 'a', {});
    assert.equal(r2.deadId, 'a');
    assert.equal(R.checkWin(r2.players), 'civilians');
    const night = R.resolveNight(ps, { mafiaTarget: 'bo', doctorSave: 'd' });
    assert.equal(night.deadId, 'bo');
    const after = R.applyDayElimination(night.players, 'bo', {});
    assert.equal(after.deadId, null, 'already dead, no bomber trigger');
    assert.equal(after.bomberPending, false);
});

test('Bomber takes the Lover partner: Lover dies instead', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', bo: 'bomber', l: 'lover', d: 'civilian', e: 'civilian' });
    const ctx = { loverId: 'l', partnerId: 'd' };
    const r = R.applyDayElimination(ps, 'bo', ctx);
    assert.equal(r.bomberPending, true);
    const r2 = R.applyBomber(r.players, 'd', ctx);
    assert.equal(r2.deadId, 'l'); assert.equal(r2.redirected, true);
    assert.equal(R.byId(r2.players, 'd').alive, true);
});

test('Bomber is the Lover partner: lover dies instead and no bomb', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', bo: 'bomber', l: 'lover', d: 'civilian', e: 'civilian' });
    const r = R.applyDayElimination(ps, 'bo', { loverId: 'l', partnerId: 'bo' });
    assert.equal(r.deadId, 'l'); assert.equal(r.bomberPending, false);
});

test('checkWin: civilians when no mafia; mafia at parity', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', c: 'civilian', d: 'civilian', e: 'civilian' });
    assert.equal(R.checkWin(ps), null);
    assert.equal(R.checkWin(R.applyDayElimination(ps, 'a', {}).players), 'civilians');
    const two = mk({ a: 'mafia', b: 'doctor', c: 'civilian' });
    assert.equal(R.checkWin(two), null);
    assert.equal(R.checkWin(R.resolveNight(two, { mafiaTarget: 'c', doctorSave: 'b' }).players), 'mafia');
    const multi = mk({ a: 'mafia', x: 'mafia', b: 'doctor', c: 'civilian', d: 'civilian', e: 'civilian' });
    assert.equal(R.checkWin(multi), null);
    assert.equal(R.checkWin(R.resolveNight(multi, { mafiaTarget: 'c' }).players), null);
    assert.equal(R.checkWin(R.resolveNight(R.resolveNight(multi, { mafiaTarget: 'c' }).players, { mafiaTarget: 'd' }).players), 'mafia');
});

test('voteTally: most votes out, tie reported with leaders', () => {
    let t = R.voteTally({ a: 'c', b: 'c', c: 'a', d: 'c', e: 'a' });
    assert.equal(t.eliminatedId, 'c'); assert.equal(t.tie, false); assert.equal(t.total, 5);
    t = R.voteTally({ a: 'c', b: 'c', c: 'a', d: 'a' });
    assert.equal(t.eliminatedId, null); assert.equal(t.tie, true); assert.equal(t.leaders.length, 2);
    t = R.voteTally({});
    assert.equal(t.eliminatedId, null); assert.equal(t.tie, false);
});

test('nightSteps and nightScript: original order, every Doctor and Detective named, Lover on night 1 only', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', b2: 'doctor', l: 'lover', de: 'detective', de2: 'detective', e: 'civilian', f: 'civilian', g: 'civilian' });
    assert.deepEqual(R.nightSteps(ps, 1).map(s => s.role), ['mafia', 'doctor', 'detective', 'lover']);
    assert.deepEqual(R.nightSteps(ps, 2).map(s => s.role), ['mafia', 'doctor', 'detective']);
    const script = R.nightScript(ps, 1).join('\n');
    assert.match(script, /Doctors, wake up \(B and B2\)/);
    assert.match(script, /Detectives, wake up \(De and De2\)/);
    assert.match(script, /Lover, wake up \(L\)/);
    assert.doesNotMatch(R.nightScript(ps, 2).join('\n'), /Lover/);
    const dead = R.resolveNight(ps, { mafiaTarget: 'de' }).players;
    assert.match(R.nightScript(dead, 2).join('\n'), /Detective, wake up \(De2\)/);
});

test('morningText and dayText read clearly', () => {
    const ps = mk({ a: 'mafia', b: 'doctor', l: 'lover', d: 'civilian', e: 'civilian' });
    assert.match(R.morningText({ deadId: null }, ps), /Nobody died/);
    assert.match(R.morningText({ deadId: 'd' }, ps), /D was killed/);
    assert.match(R.morningText({ deadId: 'l', redirected: true, targetId: 'd' }, ps), /L died tonight, taking the hit for D/);
    assert.match(R.dayText({ tie: true }, ps), /tied/);
    assert.match(R.dayText({ tie: true, revotes: 3 }, ps), /Still tied after 3 revotes\. Nobody is out today/);
    assert.match(R.dayText({ deadId: 'd' }, ps), /D was voted out/);
    assert.match(R.dayText({ deadId: 'l', redirected: true, targetId: 'd', bomberVictimId: 'e' }, ps), /L stepped in.*Bomber took E/);
});

test('shuffle is deterministic with an injected rng and keeps all items', () => {
    const out = R.shuffle([1, 2, 3, 4], seq(0.1, 0.5, 0.9));
    assert.deepEqual(out.slice().sort(), [1, 2, 3, 4]);
    assert.deepEqual(R.shuffle([1, 2, 3, 4], seq(0.1, 0.5, 0.9)), out);
});

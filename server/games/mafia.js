/* Mafia room module (PROTOCOL.md section 3). Pure reduce, private view.
   All rules come from js/rules/mafia-rules.js. UMD so the client can simulate a room offline.
   The host is an ordinary player. Their only extra powers: lobby settings, kick, start,
   the phase buttons (nextPhase) and restart. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../../js/rules/mafia-rules.js'));
    else root.MafiaServer = factory(root.MafiaRules);
}(typeof self !== 'undefined' ? self : this, function (Rules) {
    'use strict';

    const PHASES = ['lobby', 'roles', 'night', 'morning', 'day', 'bomber', 'dusk', 'ended'];
    const TEAMS = ['mafia', 'doctor', 'detective'];
    const MAX_REVOTES = 3;

    const defaultSettings = { doctor: 1, mafia: 1, detective: 0, jester: 0, bomber: 0, lover: 0 };

    function fail(msg) { throw new Error(msg); }
    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    function now() { return Date.now(); }

    /* Counts only. Player-count rules are checked at start, because the room size changes in the lobby. */
    function validateSettings(settings) {
        const c = Rules.normaliseCounts(Object.assign({}, defaultSettings, settings || {}));
        if (c.mafia < 1) fail('There must be at least 1 Mafia.');
        if (c.doctor < 1) fail('There must be at least 1 Doctor.');
        return c;
    }

    function makePlayer(p, isHost) {
        return { id: p.id, name: String(p.name || '').trim().slice(0, 24) || 'Player', isHost: !!isHost, connected: true, alive: true, role: null, seen: false };
    }

    function init({ code, hostId, hostName, settings }) {
        const t = now();
        return {
            code, game: 'mafia', phase: 'lobby', hostId, createdAt: t, updatedAt: t, version: 1,
            settings: validateSettings(settings),
            players: [makePlayer({ id: hostId, name: hostName }, true)],
            round: 0,
            night: null,
            loverId: null,
            loverPartnerId: null,
            investigations: [],
            lastNight: null,
            day: null,
            lastDay: null,
            pendingBomberId: null,
            winner: null,
            log: []
        };
    }

    function join(state, player) {
        if (state.phase !== 'lobby') fail('started');
        const s = clone(state);
        const existing = s.players.find(p => p.id === player.id);
        if (existing) {
            if (player.name) existing.name = String(player.name).trim().slice(0, 24) || existing.name;
            existing.connected = true;
        } else {
            if (s.players.length >= Rules.MAX_PLAYERS) fail('Room is full.');
            s.players.push(makePlayer(player, false));
        }
        return bump(s);
    }

    function bump(s) {
        s.version = (s.version || 0) + 1;
        s.updatedAt = now();
        return s;
    }

    function me(s, id) { return s.players.find(p => p.id === id) || fail('Unknown player.'); }
    function isHost(s, id) { return s.hostId === id; }
    function alivePlayers(s) { return s.players.filter(p => p.alive); }
    function nameOf(s, id) { const p = s.players.find(x => x.id === id); return p ? p.name : ''; }
    function requirePhase(s, phase) { if (s.phase !== phase) fail(`Not allowed during ${s.phase}.`); }
    function requireAliveTarget(s, id) {
        const t = s.players.find(p => p.id === id);
        if (!t || !t.alive) fail('Pick a living player.');
        return t;
    }
    function ctx(s) { return { loverId: s.loverId, partnerId: s.loverPartnerId }; }
    function listNames(names) { return Rules.names(names.map(n => ({ name: n }))); }

    /* ---- night teams ---- */

    function teamMembers(s, role) { return Rules.aliveWithRole(s.players, role); }

    /* A team locks when every living member has picked the same player. */
    function teamStatus(s, role) {
        const members = teamMembers(s, role);
        const picks = (s.night && s.night.picks[role]) || {};
        const values = members.map(m => picks[m.id] || null);
        const locked = members.length > 0 && values.every(v => v && v === values[0]) ? values[0] : null;
        return { role, members, picks, locked, pending: locked ? [] : members };
    }

    function loverNeedsPick(s) {
        const lover = s.loverId ? s.players.find(p => p.id === s.loverId) : null;
        return !!(lover && lover.alive && !s.loverPartnerId && s.round === 1);
    }

    function nightPending(s) {
        const pending = [];
        TEAMS.forEach(r => teamStatus(s, r).pending.forEach(p => pending.push(p)));
        if (loverNeedsPick(s) && !s.night.loverPartner) pending.push(s.players.find(p => p.id === s.loverId));
        return pending;
    }

    function beginNight(s) {
        s.round += 1;
        s.phase = 'night';
        s.day = null;
        s.pendingBomberId = null;
        s.night = { picks: { mafia: {}, doctor: {}, detective: {} }, loverPartner: null, detectiveDone: false };
        s.log.push(`Night ${s.round} begins.`);
        return s;
    }

    function finish(s, winner) {
        s.winner = winner;
        s.phase = 'ended';
        s.log.push(Rules.winnerText(winner) + '.');
        return s;
    }

    function maybeRecordDetective(s) {
        if (s.night.detectiveDone) return;
        const st = teamStatus(s, 'detective');
        if (!st.locked) return;
        const t = s.players.find(p => p.id === st.locked);
        s.investigations.push({ round: s.round, targetId: t.id, targetName: t.name, isMafia: t.role === 'mafia' });
        s.night.detectiveDone = true;
    }

    function maybeResolveNight(s) {
        maybeRecordDetective(s);
        if (nightPending(s).length) return s;
        const n = s.night;
        const mafiaTarget = teamStatus(s, 'mafia').locked;
        const doctorSave = teamStatus(s, 'doctor').locked;
        const result = Rules.resolveNight(s.players, { mafiaTarget, doctorSave, loverPartner: n.loverPartner }, ctx(s));
        if (n.loverPartner) s.loverPartnerId = n.loverPartner;
        s.players = mergeAlive(s.players, result.players);
        s.lastNight = {
            round: s.round,
            deadId: result.deadId,
            deadName: result.deadId ? nameOf(s, result.deadId) : null,
            redirected: result.redirected,
            targetId: result.redirected ? result.targetId : null,
            targetName: result.redirected ? nameOf(s, result.targetId) : null,
            saved: result.saved,
            text: Rules.morningText(result, s.players)
        };
        s.log.push(s.lastNight.text);
        s.night = null;
        const winner = Rules.checkWin(s.players);
        if (winner) return finish(s, winner);
        s.phase = 'morning';
        return s;
    }

    function mergeAlive(all, updated) {
        return all.map(p => {
            const u = updated.find(x => x.id === p.id);
            return u ? Object.assign({}, p, { alive: u.alive }) : p;
        });
    }

    /* ---- day ---- */

    function beginDay(s) {
        s.phase = 'day';
        s.day = { votes: {}, candidates: null, revote: 0 };
        s.log.push(`Day ${s.round}.`);
        return s;
    }

    function eliminateByDay(s, targetId, extra) {
        const r = Rules.applyDayElimination(s.players, targetId, ctx(s));
        s.players = mergeAlive(s.players, r.players);
        s.lastDay = Object.assign({
            round: s.round,
            deadId: r.deadId,
            deadName: r.deadId ? nameOf(s, r.deadId) : null,
            targetId,
            targetName: nameOf(s, targetId),
            redirected: r.redirected,
            tie: false, skipped: false, revotes: 0,
            bomberId: r.bomberPending ? r.deadId : null,
            bomberVictimId: null, bomberVictimName: null, bomberRedirected: false, bomberTargetId: null,
            text: ''
        }, extra || {});
        s.lastDay.text = Rules.dayText(s.lastDay, s.players);
        s.day = null;
        s.log.push(s.lastDay.text);
        if (r.jesterWin) return finish(s, 'jester');
        if (r.bomberPending) {
            s.phase = 'bomber';
            s.pendingBomberId = r.deadId;
            return s;
        }
        return afterDay(s);
    }

    function afterDay(s) {
        const winner = Rules.checkWin(s.players);
        if (winner) return finish(s, winner);
        s.phase = 'dusk';
        return s;
    }

    /* Votes lock when the last living player has voted. A tie starts a revote between the tied
       players only. After MAX_REVOTES tied revotes in a row, nobody is out. */
    function maybeResolveVote(s) {
        const voters = alivePlayers(s);
        if (voters.some(p => !s.day.votes[p.id])) return s;
        const tally = Rules.voteTally(s.day.votes);
        if (tally.eliminatedId) return eliminateByDay(s, tally.eliminatedId, { counts: tally.counts, revotes: s.day.revote });
        if (s.day.revote < MAX_REVOTES) {
            s.day = { votes: {}, candidates: tally.leaders.slice(), revote: s.day.revote + 1, lastCounts: tally.counts };
            s.log.push(`Tie between ${listNames(tally.leaders.map(id => nameOf(s, id)))}. Revote ${s.day.revote} of ${MAX_REVOTES}.`);
            return s;
        }
        s.lastDay = { round: s.round, deadId: null, deadName: null, redirected: false, tie: true, skipped: false, revotes: s.day.revote, counts: tally.counts, text: '' };
        s.lastDay.text = Rules.dayText(s.lastDay, s.players);
        s.log.push(s.lastDay.text);
        s.day = null;
        return afterDay(s);
    }

    /* ---- reduce ---- */

    function reduce(state, action, playerId) {
        const s = clone(state);
        const type = action && action.type;
        const payload = (action && action.payload) || {};
        const p = me(s, playerId);

        switch (type) {
            case 'setSettings': {
                requirePhase(s, 'lobby');
                if (!isHost(s, playerId)) fail('Only the host can change settings.');
                s.settings = validateSettings(Object.assign({}, s.settings, payload));
                return bump(s);
            }
            case 'rename': {
                requirePhase(s, 'lobby');
                p.name = String(payload.name || '').trim().slice(0, 24) || p.name;
                return bump(s);
            }
            case 'start': {
                requirePhase(s, 'lobby');
                if (!isHost(s, playerId)) fail('Only the host can start.');
                const v = Rules.validateCounts(s.settings, s.players.length);
                if (!v.ok) fail(v.error);
                const assigned = Rules.assignRoles(s.players, s.settings);
                s.players = s.players.map(pl => {
                    const a = assigned.find(x => x.id === pl.id);
                    return Object.assign({}, pl, { role: a.role, alive: true, seen: false });
                });
                const lover = s.players.find(pl => pl.role === 'lover');
                s.loverId = lover ? lover.id : null;
                s.loverPartnerId = null;
                s.investigations = [];
                s.lastNight = null; s.lastDay = null; s.winner = null; s.pendingBomberId = null; s.night = null; s.day = null;
                s.round = 0;
                s.log = ['Roles dealt.'];
                s.phase = 'roles';
                return bump(s);
            }
            case 'seen': {
                requirePhase(s, 'roles');
                p.seen = true;
                return bump(s);
            }
            case 'nightPick': {
                requirePhase(s, 'night');
                if (!p.alive) fail('Only living players act at night.');
                const t = requireAliveTarget(s, payload.targetId);
                if (p.role === 'lover') {
                    if (!loverNeedsPick(s)) fail('Your partner is already chosen.');
                    if (s.night.loverPartner) fail('Your partner is already chosen.');
                    if (t.id === p.id) fail('Pick someone else.');
                    s.night.loverPartner = t.id;
                    maybeResolveNight(s);
                    return bump(s);
                }
                if (!TEAMS.includes(p.role)) fail('You have nothing to do tonight.');
                const st = teamStatus(s, p.role);
                if (st.locked) fail('Your team has already locked in.');
                if (p.role === 'mafia' && t.role === 'mafia') fail('You cannot target the Mafia.');
                if (p.role === 'detective' && t.role === 'detective') fail('You cannot check a fellow Detective.');
                s.night.picks[p.role][p.id] = t.id;
                maybeResolveNight(s);
                return bump(s);
            }
            case 'nextPhase': {
                if (!isHost(s, playerId)) fail('Only the host can do that.');
                if (s.phase === 'roles') {
                    const waiting = s.players.filter(pl => !pl.seen);
                    if (waiting.length) fail(`Waiting for ${listNames(waiting.map(pl => pl.name))}.`);
                    beginNight(s);
                } else if (s.phase === 'morning') beginDay(s);
                else if (s.phase === 'dusk') beginNight(s);
                else fail('Nothing to advance.');
                return bump(s);
            }
            case 'vote': {
                requirePhase(s, 'day');
                if (!p.alive) fail('Only living players vote.');
                const t = requireAliveTarget(s, payload.targetId);
                if (t.id === p.id) fail('You cannot vote for yourself.');
                if (s.day.candidates && !s.day.candidates.includes(t.id)) fail('Vote for one of the tied players.');
                s.day.votes[p.id] = t.id;
                maybeResolveVote(s);
                return bump(s);
            }
            case 'bomberPick': {
                requirePhase(s, 'bomber');
                if (s.pendingBomberId !== playerId) fail('Only the Bomber can do that.');
                const t = requireAliveTarget(s, payload.targetId);
                const r = Rules.applyBomber(s.players, t.id, ctx(s));
                s.players = mergeAlive(s.players, r.players);
                s.lastDay.bomberTargetId = t.id;
                s.lastDay.bomberVictimId = r.deadId;
                s.lastDay.bomberVictimName = r.deadId ? nameOf(s, r.deadId) : null;
                s.lastDay.bomberRedirected = r.redirected;
                s.lastDay.text = Rules.dayText(s.lastDay, s.players);
                s.log.push(s.lastDay.text);
                s.pendingBomberId = null;
                afterDay(s);
                return bump(s);
            }
            case 'restart': {
                if (!isHost(s, playerId)) fail('Only the host can restart.');
                const fresh = init({ code: s.code, hostId: s.hostId, hostName: '', settings: s.settings });
                fresh.players = s.players.map(pl => Object.assign(makePlayer(pl, pl.isHost), { connected: pl.connected }));
                fresh.createdAt = s.createdAt;
                fresh.version = s.version;
                return bump(fresh);
            }
            case 'leave': {
                if (s.phase === 'lobby') {
                    s.players = s.players.filter(pl => pl.id !== playerId);
                    if (s.players.length === 0) return bump(s);
                    if (s.hostId === playerId) { s.hostId = s.players[0].id; s.players[0].isHost = true; }
                } else {
                    p.connected = false;
                }
                return bump(s);
            }
            case 'kick': {
                if (!isHost(s, playerId)) fail('Only the host can remove players.');
                requirePhase(s, 'lobby');
                if (payload.targetId === s.hostId) fail('The host cannot be removed.');
                s.players = s.players.filter(pl => pl.id !== payload.targetId);
                return bump(s);
            }
            case 'connected': {
                p.connected = payload.connected !== false;
                return bump(s);
            }
            default:
                fail(`Unknown action: ${type}`);
        }
    }

    /* ---- view ---- */

    /* Waiting lines never reveal roles: at night a player outside a team only sees a count. */
    function waitingFor(s, viewer) {
        const hostName = nameOf(s, s.hostId);
        switch (s.phase) {
            case 'lobby': return { names: [hostName], text: `Waiting for ${hostName} to start` };
            case 'roles': {
                const names = s.players.filter(p => !p.seen).map(p => p.name);
                return { names, text: names.length ? `Waiting for ${listNames(names)}` : `Waiting for ${hostName} to start the night` };
            }
            case 'night': {
                const pending = nightPending(s);
                const count = pending.length;
                const general = count ? `Waiting for the night to end (${count} still choosing)` : 'Waiting for the night to end';
                if (viewer && viewer.alive && TEAMS.includes(viewer.role)) {
                    const st = teamStatus(s, viewer.role);
                    if (!st.locked) {
                        // Teammates who have not picked, or picked someone other than me.
                        const mine = st.picks[viewer.id] || null;
                        const others = st.members.filter(m => m.id !== viewer.id && st.picks[m.id] !== mine || (m.id !== viewer.id && !mine)).map(m => m.name);
                        const list = mine ? others : [viewer.name].concat(others);
                        return { names: list, count, text: `Waiting for ${listNames(list)} to agree` };
                    }
                }
                if (viewer && viewer.alive && viewer.role === 'lover' && loverNeedsPick(s) && !s.night.loverPartner) {
                    return { names: [viewer.name], count, text: 'Waiting for you' };
                }
                return { names: [], count, text: general };
            }
            case 'morning': return { names: [hostName], text: `Waiting for ${hostName} to start the day` };
            case 'day': {
                const names = alivePlayers(s).filter(p => !s.day || !s.day.votes[p.id]).map(p => p.name);
                return { names, text: names.length ? `Waiting for ${listNames(names)} to vote` : 'Counting votes' };
            }
            case 'bomber': { const b = nameOf(s, s.pendingBomberId); return { names: [b], text: `Waiting for ${b} to choose` }; }
            case 'dusk': return { names: [hostName], text: `Waiting for ${hostName} to start the night` };
            default: return { names: [], text: '' };
        }
    }

    function view(state, playerId) {
        const s = state;
        const viewer = s.players.find(p => p.id === playerId) || null;
        const ended = s.phase === 'ended';
        const viewerAlive = !!(viewer && viewer.alive);
        // Living members of a team see their teammates' roles. Dead players keep only their own role.
        const teamRole = viewer && viewerAlive && TEAMS.includes(viewer.role) ? viewer.role : null;

        const players = s.players.map(p => {
            const out = { id: p.id, name: p.name, isHost: p.isHost, connected: p.connected, alive: p.alive, seen: p.seen };
            if (ended || p.id === playerId || (teamRole && p.role === teamRole)) out.role = p.role;
            if (s.phase === 'day' && s.day) out.voted = !!s.day.votes[p.id];
            return out;
        });

        const meView = viewer ? { id: viewer.id, name: viewer.name, isHost: viewer.isHost, alive: viewer.alive, seen: viewer.seen, role: viewer.role } : null;

        if (viewer && viewer.role && viewerAlive && !ended) {
            if (teamRole) meView.mates = s.players.filter(p => p.role === teamRole && p.id !== viewer.id).map(p => ({ id: p.id, name: p.name, alive: p.alive }));
            if (viewer.role === 'lover') meView.partnerId = s.loverPartnerId;
            if (viewer.role === 'detective') meView.investigations = s.investigations.slice();
            if (s.phase === 'night' && s.night) {
                if (teamRole) {
                    const st = teamStatus(s, teamRole);
                    meView.night = {
                        team: teamRole,
                        myPick: st.picks[viewer.id] || null,
                        members: st.members.map(m => ({ id: m.id, name: m.name, pick: st.picks[m.id] || null, pickName: st.picks[m.id] ? nameOf(s, st.picks[m.id]) : null })),
                        locked: st.locked,
                        lockedName: st.locked ? nameOf(s, st.locked) : null
                    };
                    if (teamRole === 'detective') meView.night.result = s.investigations.find(i => i.round === s.round) || null;
                }
                if (viewer.role === 'lover') {
                    const needs = loverNeedsPick(s);
                    meView.night = { team: 'lover', myPick: needs ? s.night.loverPartner : s.loverPartnerId, needsPartner: needs && !s.night.loverPartner, locked: needs ? s.night.loverPartner : s.loverPartnerId };
                }
            }
            if (s.phase === 'day' && s.day) meView.vote = s.day.votes[viewer.id] || null;
        }

        const day = s.phase === 'day' && s.day ? {
            revote: s.day.revote,
            maxRevotes: MAX_REVOTES,
            candidates: s.day.candidates ? s.day.candidates.slice() : null,
            candidateNames: s.day.candidates ? s.day.candidates.map(id => nameOf(s, id)) : null
        } : null;

        return {
            code: s.code, game: s.game, phase: s.phase, hostId: s.hostId, createdAt: s.createdAt, updatedAt: s.updatedAt, version: s.version,
            settings: Object.assign({}, s.settings),
            round: s.round,
            day,
            players,
            me: meView,
            lastNight: s.lastNight ? Object.assign({}, s.lastNight) : null,
            lastDay: s.lastDay ? clone(s.lastDay) : null,
            pendingBomberId: s.pendingBomberId,
            pendingBomberName: s.pendingBomberId ? nameOf(s, s.pendingBomberId) || null : null,
            winner: s.winner,
            loverPartnerId: ended ? s.loverPartnerId : undefined,
            waiting: waitingFor(s, viewer),
            log: s.log.slice(-12)
        };
    }

    return { name: 'mafia', PHASES, MAX_REVOTES, defaultSettings, validateSettings, init, join, reduce, view };
}));

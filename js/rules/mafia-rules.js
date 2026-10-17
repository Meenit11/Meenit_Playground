/* Mafia rules: pure functions shared by one-phone mode, everyone's-phone mode
   and the server reducer. UMD: window.MafiaRules in the browser, module.exports in Node.
   Players are plain objects { id, name, role, alive }. Nothing here mutates its input. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MafiaRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const ROLES = ['doctor', 'mafia', 'detective', 'jester', 'bomber', 'lover', 'civilian'];
    const OPTIONAL = ['jester', 'bomber', 'lover'];
    const COUNTED = ['mafia', 'doctor', 'detective'];
    const MIN_PLAYERS = 5;
    const MAX_PLAYERS = 20;

    const ROLE_INFO = {
        doctor: { name: 'Doctor', image: 'Doctor.png', team: 'town', blurb: 'Each night, protect one player. You may protect yourself, and the same person again.' },
        mafia: { name: 'Mafia', image: 'Mafia.png', team: 'mafia', blurb: 'Each night, agree with your fellow Mafia on one player to eliminate. Stay hidden by day.' },
        detective: { name: 'Detective', image: 'Detective.png', team: 'town', blurb: 'Each night, check one player and learn whether they are Mafia.' },
        jester: { name: 'Jester', image: 'Jester.png', team: 'solo', blurb: 'Get yourself voted out by day and you win alone.' },
        bomber: { name: 'Bomber', image: 'Bomber.png', team: 'town', blurb: 'If you are voted out by day, take one player with you.' },
        lover: { name: 'Lover', image: 'Lover.png', team: 'town', blurb: 'On night 1, pick a partner. If they would die, you die instead.' },
        civilian: { name: 'Civilian', image: 'Civilian.png', team: 'town', blurb: 'Find the Mafia and vote them out.' }
    };

    function toInt(v, d) {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : d;
    }

    function flag(v) {
        if (typeof v === 'string') return !['', '0', 'false', 'no', 'off'].includes(v.trim().toLowerCase());
        return !!v;
    }

    function normaliseCounts(counts) {
        counts = counts || {};
        const out = {
            doctor: Math.max(0, toInt(counts.doctor, 1)),
            mafia: Math.max(0, toInt(counts.mafia, 1)),
            detective: Math.max(0, toInt(counts.detective, 0))
        };
        OPTIONAL.forEach(r => { out[r] = flag(counts[r]) ? 1 : 0; });
        return out;
    }

    /* Returns { ok: true, counts } with civilian filled in, or { ok: false, error }.
       Mafia at least 1. Doctor at least 1 and fewer than the Civilians. Detective 0 or more and fewer than the Civilians. */
    function validateCounts(counts, totalPlayers) {
        const c = normaliseCounts(counts);
        const total = toInt(totalPlayers, 0);
        if (total < MIN_PLAYERS) return { ok: false, error: `You need at least ${MIN_PLAYERS} players.` };
        if (total > MAX_PLAYERS) return { ok: false, error: `Maximum ${MAX_PLAYERS} players.` };
        if (c.mafia < 1) return { ok: false, error: 'There must be at least 1 Mafia.' };
        if (c.doctor < 1) return { ok: false, error: 'There must be at least 1 Doctor.' };
        const special = c.doctor + c.mafia + c.detective + c.jester + c.bomber + c.lover;
        const civilian = total - special;
        if (civilian < 1) return { ok: false, error: 'Not enough players for these roles. Add players or remove a role.' };
        if (c.doctor >= civilian) return { ok: false, error: 'Doctors must be fewer than Civilians.' };
        if (c.detective >= civilian) return { ok: false, error: 'Detectives must be fewer than Civilians.' };
        return { ok: true, counts: Object.assign({}, c, { civilian }) };
    }

    /* For the setup steppers: can each counted role go up or down by one? Gives a short reason when not. */
    function countLimits(counts, totalPlayers) {
        const c = normaliseCounts(counts);
        const total = Math.max(MIN_PLAYERS, toInt(totalPlayers, MIN_PLAYERS));
        const mins = { mafia: 1, doctor: 1, detective: 0 };
        const out = {};
        COUNTED.forEach(role => {
            const up = validateCounts(Object.assign({}, c, { [role]: c[role] + 1 }), total);
            out[role] = { canAdd: up.ok, reason: up.ok ? '' : up.error.replace(' Add players or remove a role.', ''), canRemove: c[role] > mins[role] };
        });
        return out;
    }

    function buildRoleList(counts) {
        const list = [];
        ROLES.forEach(r => { for (let i = 0; i < (counts[r] || 0); i++) list.push(r); });
        return list;
    }

    function shuffle(arr, rng) {
        rng = rng || Math.random;
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    /* players: [{ id, name }]. Returns new players with role and alive. Throws on invalid counts. */
    function assignRoles(players, counts, rng) {
        const v = validateCounts(counts, players.length);
        if (!v.ok) throw new Error(v.error);
        const roles = shuffle(buildRoleList(v.counts), rng);
        return players.map((p, i) => Object.assign({}, p, { role: roles[i], alive: true }));
    }

    function byId(players, id) { return players.find(p => p.id === id) || null; }
    function alive(players) { return players.filter(p => p.alive); }
    function aliveWithRole(players, role) { return players.filter(p => p.alive && p.role === role); }

    function kill(players, id) {
        return players.map(p => p.id === id ? Object.assign({}, p, { alive: false }) : p);
    }

    /* The one place the Lover rule lives. ctx: { loverId, partnerId }.
       Returns { players, deadId, redirected, targetId }. deadId is null when nothing happened. */
    function resolveDeath(players, targetId, ctx) {
        ctx = ctx || {};
        const target = byId(players, targetId);
        if (!target || !target.alive) return { players, deadId: null, redirected: false, targetId: targetId || null };
        const lover = ctx.loverId ? byId(players, ctx.loverId) : null;
        if (lover && lover.alive && ctx.partnerId === targetId && lover.id !== targetId) {
            return { players: kill(players, lover.id), deadId: lover.id, redirected: true, targetId };
        }
        return { players: kill(players, targetId), deadId: targetId, redirected: false, targetId };
    }

    /* actions: { mafiaTarget, doctorSave, loverPartner }. ctx: { loverId, partnerId }.
       loverPartner in actions (night 1 pick) overrides ctx.partnerId. */
    function resolveNight(players, actions, ctx) {
        actions = actions || {};
        ctx = Object.assign({}, ctx || {});
        if (actions.loverPartner) ctx.partnerId = actions.loverPartner;
        if (!ctx.loverId) {
            const lover = players.find(p => p.role === 'lover');
            if (lover) ctx.loverId = lover.id;
        }
        const targetId = actions.mafiaTarget || null;
        if (!targetId) return { players, deadId: null, redirected: false, saved: false, targetId: null, partnerId: ctx.partnerId || null };
        if (actions.doctorSave && actions.doctorSave === targetId) {
            return { players, deadId: null, redirected: false, saved: true, targetId, partnerId: ctx.partnerId || null };
        }
        const r = resolveDeath(players, targetId, ctx);
        return { players: r.players, deadId: r.deadId, redirected: r.redirected, saved: false, targetId, partnerId: ctx.partnerId || null };
    }

    /* Day vote-out. Effects apply to the player who actually dies.
       Returns { players, deadId, redirected, jesterWin, bomberPending }. */
    function applyDayElimination(players, targetId, ctx) {
        const r = resolveDeath(players, targetId, ctx);
        const dead = r.deadId ? byId(players, r.deadId) : null;
        return {
            players: r.players,
            deadId: r.deadId,
            redirected: r.redirected,
            targetId: r.targetId,
            jesterWin: !!(dead && dead.role === 'jester'),
            bomberPending: !!(dead && dead.role === 'bomber')
        };
    }

    /* The voted-out Bomber takes one alive player along. Lover rule applies. */
    function applyBomber(players, targetId, ctx) {
        return resolveDeath(players, targetId, ctx);
    }

    /* 'civilians' | 'mafia' | null. Jester never counts toward parity. */
    function checkWin(players) {
        const a = alive(players);
        const mafia = a.filter(p => p.role === 'mafia').length;
        const town = a.filter(p => p.role !== 'mafia' && p.role !== 'jester').length;
        if (mafia === 0) return 'civilians';
        if (mafia >= town) return 'mafia';
        return null;
    }

    /* votes: { voterId: targetId }. Most votes is out. A tie at the top is reported with its leaders.
       Returns { counts, eliminatedId, tie, leaders, total }. */
    function voteTally(votes) {
        const counts = {};
        let total = 0;
        Object.keys(votes || {}).forEach(voter => {
            const t = votes[voter];
            if (!t) return;
            counts[t] = (counts[t] || 0) + 1;
            total++;
        });
        let best = 0;
        let leaders = [];
        Object.keys(counts).forEach(id => {
            if (counts[id] > best) { best = counts[id]; leaders = [id]; }
            else if (counts[id] === best) leaders.push(id);
        });
        if (leaders.length === 1) return { counts, eliminatedId: leaders[0], tie: false, leaders, total };
        return { counts, eliminatedId: null, tie: leaders.length > 1, leaders, total };
    }

    /* Which roles wake tonight, in the original Game Master order. The Lover wakes on night 1 only. */
    function nightSteps(players, round) {
        const steps = [];
        const mafia = aliveWithRole(players, 'mafia');
        const doctors = aliveWithRole(players, 'doctor');
        const detectives = aliveWithRole(players, 'detective');
        const lover = aliveWithRole(players, 'lover')[0];
        const plural = (list, one, many) => list.length > 1 ? many : one;
        steps.push({ role: 'mafia', actors: mafia, title: 'Mafia, wake up', line: `Mafia, wake up (${names(mafia)}). Choose your victim. Mafia, go to sleep.` });
        if (doctors.length) steps.push({ role: 'doctor', actors: doctors, title: plural(doctors, 'Doctor, wake up', 'Doctors, wake up'), line: `${plural(doctors, 'Doctor', 'Doctors')}, wake up (${names(doctors)}). Who are we saving tonight? ${plural(doctors, 'Doctor', 'Doctors')}, go to sleep.` });
        if (detectives.length) steps.push({ role: 'detective', actors: detectives, title: plural(detectives, 'Detective, wake up', 'Detectives, wake up'), line: `${plural(detectives, 'Detective', 'Detectives')}, wake up (${names(detectives)}). Point at someone you suspect. ${plural(detectives, 'Detective', 'Detectives')}, go to sleep.` });
        if (lover && round === 1) steps.push({ role: 'lover', actors: [lover], title: 'Lover, wake up', line: `Lover, wake up (${lover.name}). Blow a flying kiss to your partner. Lover, go to sleep.` });
        return steps;
    }

    /* The full script the Game Master reads aloud in one-phone mode. */
    function nightScript(players, round) {
        return ['City, go to sleep. Eyes shut, no peeking.']
            .concat(nightSteps(players, round).map(s => s.line))
            .concat(['Everyone, wake up.']);
    }

    function names(list) {
        const n = list.map(p => p.name);
        if (n.length <= 1) return n.join('');
        return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
    }

    function morningText(result, players) {
        if (!result || !result.deadId) {
            return result && result.saved ? 'Everyone wake up. Nobody died tonight. The Doctor saved a life.' : 'Everyone wake up. Nobody died tonight.';
        }
        const dead = byId(players, result.deadId);
        const deadName = dead ? dead.name : 'Someone';
        if (result.redirected) {
            const target = byId(players, result.targetId);
            return `Everyone wake up. ${deadName} died tonight, taking the hit for ${target ? target.name : 'their partner'}.`;
        }
        return `Everyone wake up. ${deadName} was killed tonight.`;
    }

    function dayText(result, players) {
        if (!result) return '';
        if (result.skipped) return 'Nobody was voted out today.';
        if (result.tie) return result.revotes ? `Still tied after ${result.revotes} revote${result.revotes === 1 ? '' : 's'}. Nobody is out today.` : 'The vote was tied. Nobody is out today.';
        if (!result.deadId) return 'Nobody was voted out today.';
        const dead = byId(players, result.deadId);
        const deadName = dead ? dead.name : 'Someone';
        let text;
        if (result.redirected) {
            const target = byId(players, result.targetId);
            text = `${target ? target.name : 'The vote'} was voted out, but ${deadName} stepped in and died instead.`;
        } else {
            text = `${deadName} was voted out.`;
        }
        if (result.bomberVictimId) {
            const victim = byId(players, result.bomberVictimId);
            if (result.bomberRedirected) {
                const bt = byId(players, result.bomberTargetId);
                text += ` The Bomber went for ${bt ? bt.name : 'someone'}, but ${victim ? victim.name : 'someone'} died in their place.`;
            } else {
                text += ` The Bomber took ${victim ? victim.name : 'someone'} along.`;
            }
        }
        return text;
    }

    function winnerText(winner) {
        if (winner === 'mafia') return 'Mafia wins';
        if (winner === 'jester') return 'Jester wins';
        if (winner === 'civilians') return 'Civilians win';
        return '';
    }

    function winners(players, winner) {
        if (winner === 'mafia') return players.filter(p => p.role === 'mafia');
        if (winner === 'jester') return players.filter(p => p.role === 'jester');
        return players.filter(p => p.role !== 'mafia' && p.role !== 'jester');
    }

    return {
        ROLES, OPTIONAL, COUNTED, ROLE_INFO, MIN_PLAYERS, MAX_PLAYERS,
        normaliseCounts, validateCounts, countLimits, buildRoleList, shuffle, assignRoles,
        byId, alive, aliveWithRole, resolveDeath, resolveNight, applyDayElimination, applyBomber,
        checkWin, voteTally, nightSteps, nightScript, names, morningText, dayText, winnerText, winners
    };
}));

/*
 * Undercover rules. Pure functions, no DOM, no I/O.
 * UMD: window.UndercoverRules in the browser, module.exports in Node.
 *
 * Roles: 'Agent' (word A), 'Spy' (word B), 'Mr. White' (no word).
 * Player shape used everywhere: { id, name, role, word, alive }.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.UndercoverRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var ROLES = { AGENT: 'Agent', SPY: 'Spy', WHITE: 'Mr. White' };
    var MIN_PLAYERS = 4;

    function rand(rng) { return typeof rng === 'function' ? rng() : Math.random(); }

    function shuffle(arr, rng) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(rand(rng) * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    /**
     * validateCounts({ total, mrWhite, spies })
     * -> { ok: true, agents } | { ok: false, error, agents }
     * Rules kept from the original game: at least 4 players, at least one
     * Spy or Mr. White, and more Agents than Spies + Mr. Whites combined.
     */
    function validateCounts(counts) {
        var total = Number(counts && counts.total) || 0;
        var mrWhite = Number(counts && counts.mrWhite) || 0;
        var spies = Number(counts && counts.spies) || 0;
        var agents = total - mrWhite - spies;
        if (mrWhite < 0 || spies < 0) return { ok: false, error: 'Counts cannot be negative', agents: agents };
        if (total < MIN_PLAYERS) return { ok: false, error: 'You need at least ' + MIN_PLAYERS + ' players', agents: agents };
        if (mrWhite + spies < 1) return { ok: false, error: 'Add at least 1 Spy or Mr. White', agents: agents };
        if (agents <= mrWhite + spies) return { ok: false, error: 'Agents must outnumber Spies and Mr. Whites', agents: agents };
        return { ok: true, agents: agents };
    }

    /**
     * assignRoles(players, counts, pair, rng)
     * players: [{ id, name }], counts: { mrWhite, spies }, pair: [wordA, wordB]
     * Word pair cooldown is the caller's job. Which word is the Agent word is random.
     * -> { players: [{ id, name, role, word, alive: true }], agentWord, spyWord }
     */
    function assignRoles(players, counts, pair, rng) {
        var check = validateCounts({ total: players.length, mrWhite: counts.mrWhite, spies: counts.spies });
        if (!check.ok) throw new Error(check.error);
        if (!pair || pair.length !== 2) throw new Error('A word pair is required');
        var flip = rand(rng) < 0.5;
        var agentWord = flip ? pair[0] : pair[1];
        var spyWord = flip ? pair[1] : pair[0];
        var roles = [];
        var i;
        for (i = 0; i < counts.mrWhite; i++) roles.push(ROLES.WHITE);
        for (i = 0; i < counts.spies; i++) roles.push(ROLES.SPY);
        for (i = 0; i < check.agents; i++) roles.push(ROLES.AGENT);
        roles = shuffle(roles, rng);
        var out = players.map(function (p, idx) {
            var role = roles[idx];
            return {
                id: p.id, name: p.name, role: role,
                word: role === ROLES.AGENT ? agentWord : role === ROLES.SPY ? spyWord : null,
                alive: true
            };
        });
        return { players: out, agentWord: agentWord, spyWord: spyWord };
    }

    /** speakingOrder(players, rng) -> ids of alive players in random order */
    function speakingOrder(players, rng) {
        return shuffle(players.filter(function (p) { return p.alive; }).map(function (p) { return p.id; }), rng);
    }

    /** eliminate(players, id) -> { players, eliminated } (new array, input untouched) */
    function eliminate(players, id) {
        var eliminated = null;
        var next = players.map(function (p) {
            if (p.id !== id || !p.alive) return p;
            eliminated = Object.assign({}, p, { alive: false });
            return eliminated;
        });
        if (!eliminated) throw new Error('That player is not in the game');
        return { players: next, eliminated: eliminated };
    }

    /** Mr. White guesses the Agent word while any Agent is alive, else the Spy word. */
    function mrWhiteTargetWord(players, agentWord, spyWord) {
        var agentAlive = players.some(function (p) { return p.alive && p.role === ROLES.AGENT; });
        return agentAlive ? agentWord : spyWord;
    }

    function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

    /** isCorrectGuess(guess, targetWord) -> boolean, case and spacing insensitive */
    function isCorrectGuess(guess, targetWord) {
        return norm(guess).length > 0 && norm(guess) === norm(targetWord);
    }

    /**
     * checkWin(players) -> null while the game goes on, else { winner, reason }
     * winner: 'agents' | 'spies' | 'mrwhite'
     * Order matters and follows the agreed sentences:
     *   1. Two players left with a Mr. White: Mr. White wins (also covers only Mr. Whites left).
     *   2. Agent versus Spy 1v1: Spy wins.
     *   3. All Spies and Mr. Whites out: Agents win.
     *   4. All Mr. Whites out and Spies >= Agents: Spies win.
     * A correct Mr. White guess is handled by the caller before this runs.
     */
    function checkWin(players) {
        var alive = players.filter(function (p) { return p.alive; });
        var agents = 0, spies = 0, whites = 0;
        alive.forEach(function (p) {
            if (p.role === ROLES.AGENT) agents++;
            else if (p.role === ROLES.SPY) spies++;
            else if (p.role === ROLES.WHITE) whites++;
        });
        if (whites > 0 && agents === 0 && spies === 0) {
            return { winner: 'mrwhite', reason: 'Only Mr. White is left standing' };
        }
        if (alive.length === 2 && whites >= 1) {
            return { winner: 'mrwhite', reason: 'Two players left and one is Mr. White' };
        }
        if (alive.length === 2 && agents === 1 && spies === 1) {
            return { winner: 'spies', reason: 'Spy wins the 1 vs 1' };
        }
        if (spies === 0 && whites === 0) {
            return { winner: 'agents', reason: 'Every Spy and Mr. White is out' };
        }
        if (whites === 0 && spies >= agents) {
            return { winner: 'spies', reason: 'Spies match the Agents in numbers' };
        }
        return null;
    }

    /**
     * voteTally(votes, aliveIds)
     * votes: { voterId: targetId }. Only votes from alive voters for alive targets count.
     * -> { counts: { targetId: n }, top: targetId | null, tie: boolean, voted: [voterIds] }
     * top is null when nobody voted or when the lead is shared (a tie is handed to the Game Master).
     */
    function voteTally(votes, aliveIds) {
        var alive = {};
        (aliveIds || []).forEach(function (id) { alive[id] = true; });
        var counts = {};
        var voted = [];
        Object.keys(votes || {}).forEach(function (voter) {
            var target = votes[voter];
            if (!alive[voter] || !alive[target]) return;
            voted.push(voter);
            counts[target] = (counts[target] || 0) + 1;
        });
        var best = 0, top = null, tie = false;
        Object.keys(counts).forEach(function (id) {
            if (counts[id] > best) { best = counts[id]; top = id; tie = false; }
            else if (counts[id] === best) { tie = true; }
        });
        if (tie) top = null;
        return { counts: counts, top: top, tie: tie, voted: voted };
    }

    return {
        ROLES: ROLES,
        MIN_PLAYERS: MIN_PLAYERS,
        shuffle: shuffle,
        validateCounts: validateCounts,
        assignRoles: assignRoles,
        speakingOrder: speakingOrder,
        eliminate: eliminate,
        mrWhiteTargetWord: mrWhiteTargetWord,
        isCorrectGuess: isCorrectGuess,
        checkWin: checkWin,
        voteTally: voteTally
    };
}));

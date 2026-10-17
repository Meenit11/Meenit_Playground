/*
 * Undercover room module (PROTOCOL.md section 3).
 * Pure reduce, private view. All game rules come from js/rules/undercover-rules.js.
 *
 * Phases: lobby -> speaking -> vote -> result -> (guess) -> speaking ... -> gameover
 */
'use strict';

const Rules = require('../../js/rules/undercover-rules.js');
const WORD_PAIRS = (() => {
    try { return require('../../words.json').word_pairs; }
    catch (e) { return [['Coffee', 'Tea'], ['Cat', 'Dog'], ['Pizza', 'Burger']]; }
})();

const VOTE_MODES = ['gm', 'vote'];
const MAX_PLAYERS = 20;

const defaultSettings = { mrWhite: 1, spies: 0, voteMode: 'gm' };

function fail(msg) { throw new Error(msg); }

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function validateSettings(settings) {
    const s = Object.assign({}, defaultSettings, settings || {});
    const mrWhite = Number(s.mrWhite);
    const spies = Number(s.spies);
    if (!Number.isInteger(mrWhite) || mrWhite < 0 || mrWhite > 5) fail('Mr. White count must be 0 to 5');
    if (!Number.isInteger(spies) || spies < 0 || spies > 5) fail('Spy count must be 0 to 5');
    if (VOTE_MODES.indexOf(s.voteMode) === -1) fail('voteMode must be "gm" or "vote"');
    return { mrWhite, spies, voteMode: s.voteMode };
}

function makePlayer(p, isHost) {
    return { id: p.id, name: String(p.name || '').trim().slice(0, 24) || 'Player', isHost: !!isHost, connected: true, alive: true, role: null, word: null };
}

function init({ code, hostId, hostName, settings }) {
    const now = Date.now();
    return {
        code, game: 'undercover', phase: 'lobby', hostId,
        createdAt: now, updatedAt: now, version: 1,
        settings: validateSettings(settings),
        players: [makePlayer({ id: hostId, name: hostName }, true)],
        round: 0,
        order: [],
        speakerIndex: 0,
        votes: {},
        gmPick: null,
        eliminated: null,       // { id, name, role } of the last elimination, null when nobody went out
        guesserId: null,        // Mr. White who must guess
        lastGuess: null,        // { name, guess, correct }
        winner: null,           // { winner, reason }
        agentWord: null,
        spyWord: null,
        usedPairs: []
    };
}

function join(state, player) {
    if (state.phase !== 'lobby') fail('started');
    if (state.players.some(p => p.id === player.id)) return state;
    if (state.players.length >= MAX_PLAYERS) fail('Room is full');
    const next = clone(state);
    next.players.push(makePlayer(player, false));
    return touch(next);
}

function touch(state) {
    state.version = (state.version || 0) + 1;
    state.updatedAt = Date.now();
    return state;
}

function find(state, id) { return state.players.find(p => p.id === id); }
function alive(state) { return state.players.filter(p => p.alive); }
function requireHost(state, playerId) { if (playerId !== state.hostId) fail('Only the host can do that'); }
function requirePhase(state, ...phases) { if (phases.indexOf(state.phase) === -1) fail('Not possible right now'); }

function pickPair(state, rng) {
    let available = WORD_PAIRS.map((pair, idx) => ({ pair, idx })).filter(x => state.usedPairs.indexOf(x.idx) === -1);
    if (!available.length) { state.usedPairs = []; available = WORD_PAIRS.map((pair, idx) => ({ pair, idx })); }
    const chosen = available[Math.floor(rng() * available.length)];
    state.usedPairs.push(chosen.idx);
    return chosen.pair;
}

function startRound(state, rng) {
    state.round += 1;
    state.order = Rules.speakingOrder(state.players, rng);
    state.speakerIndex = 0;
    state.votes = {};
    state.gmPick = null;
    state.eliminated = null;
    state.guesserId = null;
    state.phase = 'speaking';
}

function finishOrContinue(state, rng) {
    const win = Rules.checkWin(state.players);
    if (win) { state.winner = win; state.phase = 'gameover'; }
    else startRound(state, rng);
}

/** reduce(state, action, playerId, rng?) -> new state. Never mutates input. */
function reduce(state, action, playerId, rng) {
    rng = typeof rng === 'function' ? rng : Math.random;
    const type = action && action.type;
    const payload = (action && action.payload) || {};
    const me = find(state, playerId);
    if (!me) fail('You are not in this room');
    const next = clone(state);

    switch (type) {
        case 'setCounts': {
            requireHost(next, playerId); requirePhase(next, 'lobby');
            next.settings = validateSettings(Object.assign({}, next.settings, {
                mrWhite: payload.mrWhite !== undefined ? payload.mrWhite : next.settings.mrWhite,
                spies: payload.spies !== undefined ? payload.spies : next.settings.spies
            }));
            break;
        }
        case 'setVoteMode': {
            requireHost(next, playerId); requirePhase(next, 'lobby');
            next.settings = validateSettings(Object.assign({}, next.settings, { voteMode: payload.voteMode }));
            break;
        }
        case 'start': {
            requireHost(next, playerId); requirePhase(next, 'lobby');
            const check = Rules.validateCounts({ total: next.players.length, mrWhite: next.settings.mrWhite, spies: next.settings.spies });
            if (!check.ok) fail(check.error);
            const pair = pickPair(next, rng);
            const assigned = Rules.assignRoles(next.players, next.settings, pair, rng);
            next.players = next.players.map((p, i) => Object.assign({}, p, { role: assigned.players[i].role, word: assigned.players[i].word, alive: true }));
            next.agentWord = assigned.agentWord;
            next.spyWord = assigned.spyWord;
            next.round = 0;
            next.winner = null;
            next.lastGuess = null;
            startRound(next, rng);
            break;
        }
        case 'nextSpeaker': {
            requireHost(next, playerId); requirePhase(next, 'speaking');
            next.speakerIndex += 1;
            if (next.speakerIndex >= next.order.length) {
                next.speakerIndex = next.order.length;
                next.phase = 'vote';
            }
            break;
        }
        case 'vote': {
            requirePhase(next, 'vote');
            if (next.settings.voteMode !== 'vote') fail('The host picks in this room');
            if (!me.alive) fail('You are out, you cannot vote');
            const target = find(next, payload.targetId);
            if (!target || !target.alive) fail('Pick a player who is still in');
            next.votes[playerId] = target.id;
            break;
        }
        case 'gmPick': {
            requireHost(next, playerId); requirePhase(next, 'vote');
            if (payload.targetId === null || payload.targetId === undefined) { next.gmPick = null; break; }
            const target = find(next, payload.targetId);
            if (!target || !target.alive) fail('Pick a player who is still in');
            next.gmPick = target.id;
            break;
        }
        case 'confirmElimination': {
            requireHost(next, playerId); requirePhase(next, 'vote');
            let targetId = next.gmPick;
            if (!targetId && next.settings.voteMode === 'vote') {
                const t = Rules.voteTally(next.votes, alive(next).map(p => p.id));
                if (t.tie) fail('It is a tie. Tap a name to decide.');
                targetId = t.top;
            }
            if (!targetId && next.settings.voteMode === 'gm') fail('Pick who is out first');
            if (targetId) {
                const res = Rules.eliminate(next.players, targetId);
                next.players = res.players;
                next.eliminated = { id: res.eliminated.id, name: res.eliminated.name, role: res.eliminated.role };
            } else {
                next.eliminated = null; // tie or no votes: nobody out
            }
            next.phase = 'result';
            break;
        }
        case 'continueRound': {
            requireHost(next, playerId); requirePhase(next, 'result');
            if (next.eliminated && next.eliminated.role === Rules.ROLES.WHITE) {
                next.guesserId = next.eliminated.id;
                next.phase = 'guess';
            } else {
                finishOrContinue(next, rng);
            }
            break;
        }
        case 'mrWhiteGuess': {
            requirePhase(next, 'guess');
            if (playerId !== next.guesserId && playerId !== next.hostId) fail('Only Mr. White can guess');
            const guess = String(payload.guess || '').trim().slice(0, 60);
            if (!guess) fail('Type a guess first');
            const target = Rules.mrWhiteTargetWord(next.players, next.agentWord, next.spyWord);
            const correct = Rules.isCorrectGuess(guess, target);
            const guesser = find(next, next.guesserId);
            next.lastGuess = { name: guesser ? guesser.name : 'Mr. White', guess, correct };
            next.guesserId = null;
            if (correct) {
                next.winner = { winner: 'mrwhite', reason: 'Mr. White guessed the word' };
                next.phase = 'gameover';
            } else {
                finishOrContinue(next, rng);
            }
            break;
        }
        case 'restart': {
            requireHost(next, playerId);
            next.phase = 'lobby';
            next.players = next.players.map(p => Object.assign({}, p, { alive: true, role: null, word: null }));
            next.round = 0; next.order = []; next.speakerIndex = 0; next.votes = {}; next.gmPick = null;
            next.eliminated = null; next.guesserId = null; next.lastGuess = null; next.winner = null;
            next.agentWord = null; next.spyWord = null;
            break;
        }
        case 'kick': {
            requireHost(next, playerId);
            if (payload.playerId === next.hostId) fail('The host cannot be kicked');
            removeOrDrop(next, payload.playerId);
            break;
        }
        case 'leave': {
            if (playerId === next.hostId && next.phase === 'lobby') {
                // host leaves the lobby: hand the room to the next player if any
                next.players = next.players.filter(p => p.id !== playerId);
                if (next.players.length) { next.hostId = next.players[0].id; next.players[0].isHost = true; }
            } else {
                removeOrDrop(next, playerId);
            }
            break;
        }
        default:
            fail('Unknown action: ' + type);
    }
    return touch(next);
}

function removeOrDrop(state, id) {
    const p = find(state, id);
    if (!p) fail('No such player');
    if (state.phase === 'lobby') state.players = state.players.filter(x => x.id !== id);
    else p.connected = false; // keep the seat so the round can finish; the host can still eliminate them
}

/** Private projection: roles and words only reach the right phone. */
function view(state, playerId) {
    const over = state.phase === 'gameover';
    const me = find(state, playerId);
    const aliveIds = alive(state).map(p => p.id);
    const tally = Rules.voteTally(state.votes, aliveIds);
    const s = {
        code: state.code, game: state.game, phase: state.phase, hostId: state.hostId,
        createdAt: state.createdAt, updatedAt: state.updatedAt, version: state.version,
        settings: state.settings,
        players: state.players.map(p => ({
            id: p.id, name: p.name, isHost: p.isHost, connected: p.connected, alive: p.alive,
            // roles become public once a player is out, and for everyone at game over
            role: (!p.alive || over) ? p.role : null
        })),
        me: me ? { id: me.id, name: me.name, isHost: me.isHost, alive: me.alive, role: me.role, word: me.word, vote: state.votes[me.id] || null, mustGuess: state.guesserId === me.id } : { id: playerId },
        round: state.round,
        order: state.order,
        speakerIndex: state.speakerIndex,
        currentSpeakerId: state.phase === 'speaking' ? (state.order[state.speakerIndex] || null) : null,
        votedIds: tally.voted,
        allVoted: aliveIds.every(id => tally.voted.indexOf(id) !== -1),
        tie: state.phase === 'vote' && state.settings.voteMode === 'vote' && !state.gmPick && tally.tie && aliveIds.every(id => tally.voted.indexOf(id) !== -1),
        gmPick: state.gmPick,
        eliminated: state.eliminated,
        guesserId: state.guesserId,
        guesserName: state.guesserId ? (find(state, state.guesserId) || {}).name || null : null,
        lastGuess: state.lastGuess,
        winner: state.winner,
        agentWord: over ? state.agentWord : null,
        spyWord: over ? state.spyWord : null
    };
    // the host sees the live tally so they can override before confirming
    if (playerId === state.hostId || state.phase === 'result' || over) {
        s.tally = { counts: tally.counts, top: tally.top, tie: tally.tie };
    }
    return s;
}

module.exports = { name: 'undercover', defaultSettings, validateSettings, init, join, reduce, view, MAX_PLAYERS };

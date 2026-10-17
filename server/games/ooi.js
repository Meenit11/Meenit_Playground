/*
 * Odd One In: server game module (PROTOCOL.md section 3).
 * The server owns the round clock: phases store a deadline timestamp, clients render from it.
 * Every reduce() first settles expired deadlines using the server clock, so client clocks are never trusted.
 */
'use strict';

const Rules = require('../../js/rules/ooi-rules.js');

let QUESTIONS;
try {
  QUESTIONS = Rules.loadQuestions(require('../../questions.json'));
} catch (e) {
  QUESTIONS = { tier1: ['Name a fruit.'], tier2: ['Name a season.'], tier3: ['Name a side of a coin.'] };
}

const PLAY_PHASES = ['ready', 'answer', 'review'];

function fail(msg) { throw new Error(msg); }
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
function findPlayer(state, id) { return state.players.find(p => p.id === id); }
function isHost(state, id) { return state.hostId === id; }

function newQuestion(state, now) {
  const alive = Rules.alivePlayers(state.players);
  const tier = Rules.pickTier(alive.length);
  const picked = Rules.pickQuestion(Rules.tierPool(QUESTIONS, tier), state.used, { now });
  state.tier = tier;
  state.question = picked.question;
  state.used = picked.used;
}

function beginRound(state, now, roundIncrement) {
  if (roundIncrement) state.round += 1;
  newQuestion(state, now);
  state.phase = 'ready';
  state.deadline = now + Rules.GET_READY_MS;
  state.paused = false;
  state.pausedRemainingMs = 0;
  state.answers = {};
  state.selected = [];
  state.eliminatedThisRound = [];
  state.reviewDone = false;
}

function lock(state) {
  state.answers = Rules.lockAnswers(state.players, state.answers);
  state.phase = 'review';
  state.deadline = null;
  state.paused = false;
  state.pausedRemainingMs = 0;
}

// Advance expired phases using the server clock. Pure on a cloned state.
function settle(state, now) {
  if (state.paused) return state;
  if (state.phase === 'ready' && state.deadline && now >= state.deadline) {
    state.phase = 'answer';
    state.deadline = now + state.settings.timerSeconds * 1000;
  }
  if (state.phase === 'answer' && state.deadline && now >= state.deadline) lock(state);
  return state;
}

function finishOrContinue(state) {
  const winner = Rules.checkWinner(state.players);
  if (winner) {
    state.phase = 'winner';
    state.winnerId = winner.id;
    state.deadline = null;
  }
}

function toLobby(state) {
  state.phase = 'lobby';
  state.round = 0;
  state.question = '';
  state.tier = null;
  state.deadline = null;
  state.paused = false;
  state.pausedRemainingMs = 0;
  state.answers = {};
  state.selected = [];
  state.eliminatedThisRound = [];
  state.reviewDone = false;
  state.winnerId = null;
  state.players = state.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost, connected: p.connected, eliminated: false, eliminatedRound: 0 }));
}

const actions = {
  tick() { /* settle already ran */ },

  setTimer(state, payload, playerId) {
    if (!isHost(state, playerId)) fail('Only the host can change the timer');
    if (state.phase !== 'lobby') fail('The timer can only be changed before the game starts');
    state.settings.timerSeconds = Rules.validateTimer(payload && payload.timerSeconds);
  },

  start(state, payload, playerId, now) {
    if (!isHost(state, playerId)) fail('Only the host can start');
    if (state.phase !== 'lobby') fail('The game has already started');
    if (state.players.length < Rules.MIN_PLAYERS) fail('Need at least ' + Rules.MIN_PLAYERS + ' players');
    state.players.forEach(p => { p.eliminated = false; p.eliminatedRound = 0; });
    state.round = 0;
    state.winnerId = null;
    beginRound(state, now, true);
  },

  answer(state, payload, playerId, now) {
    const me = findPlayer(state, playerId) || fail('You are not in this room');
    if (state.phase === 'review') fail('Time is up');
    if (state.phase !== 'answer') fail('Not answering yet');
    if (state.paused) fail('The game is paused');
    if (me.eliminated) fail('You are out this game');
    if (Object.prototype.hasOwnProperty.call(state.answers, playerId)) fail('Your answer is already locked');
    const text = Rules.cleanAnswer(payload && payload.text);
    if (!text) fail('Type an answer first');
    state.answers[playerId] = text;
  },

  pause(state, payload, playerId, now) {
    if (!isHost(state, playerId)) fail('Only the host can pause');
    if (state.phase !== 'answer' && state.phase !== 'ready') fail('Nothing to pause');
    if (state.paused) return;
    state.paused = true;
    state.pausedRemainingMs = Math.max(0, state.deadline - now);
    state.deadline = null;
  },

  resume(state, payload, playerId, now) {
    if (!isHost(state, playerId)) fail('Only the host can resume');
    if (!state.paused) return;
    state.paused = false;
    state.deadline = now + state.pausedRemainingMs;
    state.pausedRemainingMs = 0;
  },

  // Restart the clock for the same question. Answers given so far are cleared so everyone answers again.
  reset(state, payload, playerId, now) {
    if (!isHost(state, playerId)) fail('Only the host can restart the timer');
    if (state.phase !== 'answer' && state.phase !== 'ready') fail('Nothing to restart');
    state.answers = {};
    state.paused = false;
    state.pausedRemainingMs = 0;
    state.phase = 'answer';
    state.deadline = now + state.settings.timerSeconds * 1000;
  },

  skip(state, payload, playerId, now) {
    if (!isHost(state, playerId)) fail('Only the host can skip');
    if (state.phase !== 'ready' && state.phase !== 'answer') fail('Nothing to skip');
    beginRound(state, now, false);
  },

  select(state, payload, playerId) {
    if (!isHost(state, playerId)) fail('Only the host picks who is out');
    if (state.phase !== 'review' || state.reviewDone) fail('Not reviewing');
    const id = payload && payload.playerId;
    const target = findPlayer(state, id) || fail('Unknown player');
    if (target.eliminated) fail('That player is already out');
    const i = state.selected.indexOf(id);
    if (i >= 0) state.selected.splice(i, 1); else state.selected.push(id);
  },

  eliminate(state, payload, playerId) {
    if (!isHost(state, playerId)) fail('Only the host can eliminate');
    if (state.phase !== 'review' || state.reviewDone) fail('Not reviewing');
    const ids = Array.isArray(payload && payload.ids) ? payload.ids : state.selected;
    const err = Rules.canEliminate(state.players, ids);
    if (err) fail(err);
    state.players = Rules.applyEliminations(state.players, ids, state.round);
    state.eliminatedThisRound = ids.slice();
    state.selected = [];
    state.reviewDone = true;
    finishOrContinue(state);
  },

  nextRound(state, payload, playerId, now) {
    if (!isHost(state, playerId)) fail('Only the host can continue');
    if (state.phase !== 'review') fail('Not reviewing');
    beginRound(state, now, true);
  },

  endGame(state, payload, playerId) {
    if (!isHost(state, playerId)) fail('Only the host can end the game');
    if (state.phase === 'lobby') fail('No game running');
    toLobby(state);
    state.endedEarly = true;
  },

  restart(state, payload, playerId) {
    if (!isHost(state, playerId)) fail('Only the host can restart');
    toLobby(state);
    state.endedEarly = false;
  },

  kick(state, payload, playerId) {
    if (!isHost(state, playerId)) fail('Only the host can remove players');
    if (state.phase !== 'lobby') fail('Players can only be removed in the lobby');
    const id = payload && payload.playerId;
    if (id === state.hostId) fail('The host cannot be removed');
    if (!findPlayer(state, id)) fail('Unknown player');
    state.players = state.players.filter(p => p.id !== id);
  },

  leave(state, payload, playerId) {
    const me = findPlayer(state, playerId);
    if (!me) return;
    if (state.phase === 'lobby') {
      state.players = state.players.filter(p => p.id !== playerId);
    } else {
      me.connected = false;
      if (!me.eliminated) {
        state.players = Rules.applyEliminations(state.players, [playerId], state.round);
        delete state.answers[playerId];
        state.selected = state.selected.filter(id => id !== playerId);
        if (Rules.alivePlayers(state.players).length <= 1) finishOrContinue(state);
      }
    }
    if (state.hostId === playerId && state.players.length) {
      state.players.forEach(p => { p.isHost = false; });
      const next = state.players.find(p => p.connected !== false) || state.players[0];
      next.isHost = true;
      state.hostId = next.id;
    }
  },
};

module.exports = {
  name: 'ooi',
  defaultSettings: { timerSeconds: Rules.TIMER.default, recentQuestions: [] },

  validateSettings(settings) {
    return Rules.validateSettings(settings);
  },

  init({ code, hostId, hostName, settings, now }) {
    const t = now || Date.now();
    const s = Rules.validateSettings(settings);
    const name = Rules.cleanName(hostName) || 'Host';
    return {
      code, game: 'ooi', phase: 'lobby', hostId, createdAt: t, updatedAt: t, version: 1,
      settings: { timerSeconds: s.timerSeconds },
      players: [{ id: hostId, name, isHost: true, connected: true, eliminated: false, eliminatedRound: 0 }],
      round: 0, question: '', tier: null,
      deadline: null, paused: false, pausedRemainingMs: 0,
      answers: {}, selected: [], eliminatedThisRound: [], reviewDone: false,
      winnerId: null, endedEarly: false,
      used: s.recentQuestions.map(e => ({ q: e.q, at: e.at || t })),
    };
  },

  join(state, player) {
    if (state.phase !== 'lobby') fail('started');
    if (state.players.length >= Rules.MAX_PLAYERS) fail('Room is full');
    const name = Rules.cleanName(player.name) || fail('Name needed');
    const next = clone(state);
    next.players.push({ id: player.id, name, isHost: false, connected: true, eliminated: false, eliminatedRound: 0 });
    next.version += 1;
    next.updatedAt = Date.now();
    return next;
  },

  // Pure: clones, settles the clock, applies the action, bumps version.
  reduce(state, action, playerId, nowOverride) {
    const now = nowOverride || Date.now();
    const next = settle(clone(state), now);
    const handler = actions[action && action.type];
    if (!handler) fail('Unknown action');
    handler(next, action.payload || {}, playerId, now);
    next.version = (state.version || 0) + 1;
    next.updatedAt = now;
    return next;
  },

  // Private projection: other players' answers stay hidden until review.
  view(state, playerId) {
    const pub = clone(state);
    const me = findPlayer(state, playerId);
    const inReview = state.phase === 'review' || state.phase === 'winner';
    pub.serverNow = Date.now();
    pub.answered = Object.keys(state.answers);
    if (inReview) {
      pub.review = Rules.sortForReview(state.players, state.answers);
    } else {
      delete pub.answers;
      pub.review = [];
    }
    pub.me = me ? {
      id: me.id, name: me.name, isHost: !!me.isHost, eliminated: !!me.eliminated,
      answered: Object.prototype.hasOwnProperty.call(state.answers, me.id),
      answer: Object.prototype.hasOwnProperty.call(state.answers, me.id) ? state.answers[me.id] : null,
    } : { id: playerId };
    return pub;
  },
};

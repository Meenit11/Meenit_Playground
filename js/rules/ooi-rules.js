/*
 * Odd One In: pure rules shared by the server reducer and the one-phone mode.
 * UMD: window.OoiRules in the browser, module.exports in Node. No DOM, no I/O.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OoiRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TIMER = { min: 5, max: 30, default: 10 };
  const GET_READY_MS = 3000;
  const COOLDOWN_MS = 2 * 60 * 60 * 1000;
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 20;
  const MAX_ANSWER_LENGTH = 60;
  const MAX_NAME_LENGTH = 20;
  const TIERS = ['tier1', 'tier2', 'tier3'];

  // ---- settings ----
  function validateTimer(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || Math.round(n) !== n || n < TIMER.min || n > TIMER.max) {
      throw new Error('Answer time must be a whole number from ' + TIMER.min + ' to ' + TIMER.max + ' seconds');
    }
    return n;
  }

  // Returns a clean settings object or throws. Unknown keys are dropped.
  function validateSettings(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const timerSeconds = s.timerSeconds === undefined ? TIMER.default : validateTimer(s.timerSeconds);
    const recent = Array.isArray(s.recentQuestions) ? s.recentQuestions : [];
    const recentQuestions = recent
      .map(function (e) { return typeof e === 'string' ? { q: e, at: 0 } : (e && typeof e.q === 'string' ? { q: e.q, at: Number(e.at) || 0 } : null); })
      .filter(Boolean)
      .slice(0, 300);
    return { timerSeconds: timerSeconds, recentQuestions: recentQuestions };
  }

  function cleanName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  }

  // ---- questions ----
  // Accepts the questions.json shape and returns { tier1, tier2, tier3 } with exact duplicates removed.
  function loadQuestions(json) {
    const map = { tier1: 'tier1_broad', tier2: 'tier2_medium', tier3: 'tier3_narrow' };
    const out = {};
    TIERS.forEach(function (tier) {
      const raw = (json && json[map[tier]] && json[map[tier]].questions) || (json && json[tier]) || [];
      const seen = new Set();
      out[tier] = raw.filter(function (q) {
        const key = String(q).trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
    return out;
  }

  function pickTier(aliveCount) {
    if (aliveCount >= 10) return 'tier1';
    if (aliveCount >= 5) return 'tier2';
    return 'tier3';
  }

  // Pool for a tier, falling back to any non-empty tier so a game never stalls.
  function tierPool(questions, tier) {
    const q = questions || {};
    if (q[tier] && q[tier].length) return q[tier];
    for (let i = 0; i < TIERS.length; i++) if (q[TIERS[i]] && q[TIERS[i]].length) return q[TIERS[i]];
    return ['Name something!'];
  }

  function pruneUsed(used, now, cooldownMs) {
    const cd = cooldownMs === undefined ? COOLDOWN_MS : cooldownMs;
    const t = now === undefined ? Date.now() : now;
    return (used || []).filter(function (e) { return e && typeof e.q === 'string' && (t - (e.at || 0)) < cd; });
  }

  // pickQuestion(pool, used, opts) -> { question, used }
  // used: [{ q, at }] history (room scoped). Never repeats a question until the pool is exhausted,
  // then the history for that pool is cleared. Entries older than the cooldown are forgotten.
  function pickQuestion(pool, used, opts) {
    const o = opts || {};
    const now = o.now === undefined ? Date.now() : o.now;
    const rng = typeof o.rng === 'function' ? o.rng : Math.random;
    const list = pool && pool.length ? pool : ['Name something!'];
    let history = pruneUsed(used, now, o.cooldownMs);
    const usedSet = new Set(history.map(function (e) { return e.q; }));
    let available = list.filter(function (q) { return !usedSet.has(q); });
    if (!available.length) {
      const inPool = new Set(list);
      history = history.filter(function (e) { return !inPool.has(e.q); });
      available = list.slice();
    }
    const question = available[Math.min(available.length - 1, Math.floor(rng() * available.length))];
    return { question: question, used: history.concat([{ q: question, at: now }]) };
  }

  // ---- answers ----
  function cleanAnswer(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER_LENGTH);
  }

  function normalizeAnswer(text) {
    return cleanAnswer(text).toLowerCase();
  }

  function alivePlayers(players) {
    return (players || []).filter(function (p) { return !p.eliminated; });
  }

  // Every alive player gets a key; missing answers become '' (blank). Never edits existing answers.
  function lockAnswers(players, answers) {
    const out = {};
    alivePlayers(players).forEach(function (p) {
      out[p.id] = answers && Object.prototype.hasOwnProperty.call(answers, p.id) ? cleanAnswer(answers[p.id]) : '';
    });
    return out;
  }

  // Review list: only players who have an answer key, blanks first, then alphabetical (case-insensitive).
  function sortForReview(players, answers) {
    const a = answers || {};
    const counts = {};
    Object.keys(a).forEach(function (id) {
      const k = normalizeAnswer(a[id]);
      if (k) counts[k] = (counts[k] || 0) + 1;
    });
    return (players || [])
      .filter(function (p) { return Object.prototype.hasOwnProperty.call(a, p.id); })
      .map(function (p) {
        const answer = cleanAnswer(a[p.id]);
        const key = normalizeAnswer(answer);
        return {
          id: p.id,
          name: p.name,
          isHost: !!p.isHost,
          eliminated: !!p.eliminated,
          answer: answer,
          blank: !answer,
          duplicate: !!answer && counts[key] > 1,
        };
      })
      .sort(function (x, y) {
        if (x.blank !== y.blank) return x.blank ? -1 : 1;
        const c = x.answer.localeCompare(y.answer, undefined, { sensitivity: 'base' });
        return c !== 0 ? c : x.name.localeCompare(y.name, undefined, { sensitivity: 'base' });
      });
  }

  // ---- eliminations ----
  function canEliminate(players, ids) {
    const list = Array.isArray(ids) ? ids : [];
    if (!list.length) return 'Pick who is out first';
    const alive = alivePlayers(players);
    const aliveIds = new Set(alive.map(function (p) { return p.id; }));
    for (let i = 0; i < list.length; i++) if (!aliveIds.has(list[i])) return 'That player is already out';
    if (new Set(list).size >= alive.length) return 'Someone has to stay in';
    return null;
  }

  // Pure: returns a new players array. The host may be among the ids.
  function applyEliminations(players, ids, round) {
    const set = new Set(ids || []);
    return (players || []).map(function (p) {
      if (!set.has(p.id) || p.eliminated) return p;
      return Object.assign({}, p, { eliminated: true, eliminatedRound: round || 0 });
    });
  }

  // The sole winner, only when exactly one player is left standing.
  function checkWinner(players) {
    const alive = alivePlayers(players);
    return alive.length === 1 ? alive[0] : null;
  }

  // ---- clock helpers (deadline based, server owned) ----
  function remainingMs(clock, now) {
    if (!clock) return 0;
    if (clock.paused) return Math.max(0, clock.pausedRemainingMs || 0);
    if (!clock.deadline) return 0;
    return Math.max(0, clock.deadline - (now === undefined ? Date.now() : now));
  }

  return {
    TIMER: TIMER,
    GET_READY_MS: GET_READY_MS,
    COOLDOWN_MS: COOLDOWN_MS,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    MAX_ANSWER_LENGTH: MAX_ANSWER_LENGTH,
    MAX_NAME_LENGTH: MAX_NAME_LENGTH,
    TIERS: TIERS,
    validateTimer: validateTimer,
    validateSettings: validateSettings,
    cleanName: cleanName,
    loadQuestions: loadQuestions,
    pickTier: pickTier,
    tierPool: tierPool,
    pruneUsed: pruneUsed,
    pickQuestion: pickQuestion,
    cleanAnswer: cleanAnswer,
    normalizeAnswer: normalizeAnswer,
    alivePlayers: alivePlayers,
    lockAnswers: lockAnswers,
    sortForReview: sortForReview,
    canEliminate: canEliminate,
    applyEliminations: applyEliminations,
    checkWinner: checkWinner,
    remainingMs: remainingMs,
  };
}));

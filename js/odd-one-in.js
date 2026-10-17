/*
 * Odd One In: client.
 * Mode A (everyone's phone): window.Net room, the server reducer owns the clock and the answers.
 * Mode B (one phone): pass-to-type, pure OoiRules in this file, nothing leaves the device.
 * Motion, SFX, Haptic and Theme are optional and always called guarded.
 */
(function () {
  'use strict';

  const R = window.OoiRules;
  const $ = (id) => document.getElementById(id);

  const KEY_USED = 'pg_ooi_used';     // device memory of recent questions (host)
  const KEY_NAME = 'pg_ooi_name';
  const KEY_TIMER = 'pg_ooi_timer';
  const KEY_LOCAL = 'pg_ooi_local';   // one-phone game in progress
  const KEY_SERVER_LEGACY = 'ooi_server_url';
  const KEY_SERVER = 'pg_server_url';
  const GOLD = '#d6a84a';

  const S = {
    screen: 'screen-home',
    mode: null,          // 'net' | 'local'
    room: null,
    state: null,         // latest private view (net)
    offset: 0,           // serverNow minus Date.now()
    clock: null,
    ring: null,
    clockKey: '',
    listKey: '',
    elimKey: '',
    winnerKey: '',
    tickRetry: null,
    questions: null,
    local: null,
    timerSeconds: R.TIMER.default,
    localNames: [],
  };

  // ---------------------------------------------------------------- helpers
  function esc(text) { const d = document.createElement('div'); d.textContent = text == null ? '' : String(text); return d.innerHTML; }
  function store(key, value) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }
  function load(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
  function sfx(name) { try { window.SFX?.play?.(name); } catch (e) { /* ignore */ } }
  function haptic(kind) { try { (kind === 'heavy' ? window.Haptic?.heavy : window.Haptic?.light)?.(); } catch (e) { /* ignore */ } }
  function joinNames(names) {
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    if (names.length <= 3) return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    return names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' more';
  }

  function toast(text, kind) {
    if (window.Motion?.toast) { try { window.Motion.toast(text, { kind: kind || 'info' }); return; } catch (e) { /* fall through */ } }
    const el = $('ooi-toast');
    if (!el) return;
    el.textContent = text;
    el.className = 'ooi-toast' + (kind === 'error' ? ' error' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  function showErr(id, msg) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 4000);
  }

  async function go(id, direction) {
    if (S.screen === id) return;
    const from = S.screen;
    S.screen = id;
    const M = window.Motion;
    if (M?.screen) {
      try { await M.screen(from, id, { direction: direction || 'forward' }); } catch (e) { /* fallback below */ }
    }
    if (S.screen !== id) return; // another transition started meanwhile
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
  }

  function setTone(round) { document.body.dataset.tone = round ? String(((round - 1) % 8) + 1) : '0'; }
  function setView(view) {
    document.body.classList.toggle('ooi-view-out', view === 'out');
    document.body.classList.toggle('ooi-view-winner', view === 'winner');
  }

  // In-page confirmation box for leaving, closing or removing. Never a native dialog.
  function askConfirm(title, text, yesLabel, onYes) {
    const box = $('ooi-confirm');
    if (!box) { onYes(); return; }
    if (box.parentElement !== document.body) document.body.appendChild(box);
    $('ooi-confirm-title').textContent = title;
    $('ooi-confirm-text').textContent = text;
    $('ooi-confirm-yes').textContent = yesLabel;
    const close = () => { box.classList.add('hidden'); $('ooi-confirm-yes').onclick = null; };
    $('ooi-confirm-yes').onclick = () => { close(); onYes(); };
    $('ooi-confirm-no').onclick = close;
    $('ooi-confirm-overlay').onclick = close;
    box.classList.remove('hidden');
  }

  // Two-tap destructive confirmation, no confirm() anywhere.
  function armDanger(btn, fn) {
    if (btn.dataset.armed === '1') {
      btn.dataset.armed = '';
      btn.textContent = btn.dataset.label;
      fn();
      return;
    }
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = 'Tap again to end';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; }, 3000);
  }

  // Device memory of recent questions, host side, pruned to the cooldown.
  function deviceUsed() { return R.pruneUsed(load(KEY_USED, []), Date.now()); }
  function rememberUsed(list) {
    const map = new Map();
    deviceUsed().concat(list || []).forEach((e) => { if (e && e.q) map.set(e.q, Math.max(e.at || 0, map.get(e.q) || 0)); });
    store(KEY_USED, R.pruneUsed(Array.from(map, ([q, at]) => ({ q, at })), Date.now()));
  }

  function setTimerSetting(value) {
    S.timerSeconds = Math.min(R.TIMER.max, Math.max(R.TIMER.min, value));
    store(KEY_TIMER, S.timerSeconds);
    $('local-timer-value').textContent = S.timerSeconds;
  }

  // ---------------------------------------------------------------- clock
  // One loop owns the countdown. Remaining time comes from a function so the
  // server deadline (net) or the local deadline (one phone) is the only truth.
  function stopClock() {
    if (S.clock) { clearInterval(S.clock); S.clock = null; }
    try { S.ring?.stop?.(true); } catch (e) { /* ignore */ }
    S.ring = null;
  }

  function runClock(opts) {
    stopClock();
    const ringEl = opts.ring ? $('timer-ring') : null;
    const numEl = opts.num ? $(opts.num) : null;
    const total = Math.max(1, opts.totalMs);
    let lastSec = null;
    let motionRing = false;

    if (ringEl) {
      ringEl.classList.toggle('paused', !!opts.paused);
      ringEl.classList.remove('motion-ring', 'timer-ring', 'is-urgent');
      ringEl.innerHTML = '<span class="ooi-num" id="timer-num"></span>';
      if (!opts.paused && window.Motion?.timerRing) {
        try {
          S.ring = window.Motion.timerRing(ringEl, { seconds: Math.ceil(opts.remaining() / 1000) }) || null;
          motionRing = !!S.ring;
          if (motionRing) ringEl.classList.add('motion-ring');
        } catch (e) { motionRing = false; }
      }
    }

    const paint = () => {
      const rem = Math.max(0, opts.remaining());
      const sec = Math.ceil(rem / 1000);
      if (ringEl && !motionRing) {
        ringEl.style.setProperty('--ooi-progress', String(rem / total));
        const n = $('timer-num');
        if (n) n.textContent = String(sec);
        ringEl.classList.toggle('urgent', !opts.paused && sec > 0 && sec <= 3);
      }
      if (numEl && sec > 0 && numEl.textContent !== String(sec)) {
        numEl.textContent = String(sec);
        numEl.classList.remove('bump');
        void numEl.offsetWidth;
        numEl.classList.add('bump');
      }
      if (!opts.paused && sec !== lastSec) {
        // Motion's ring plays its own tick and urgent sounds; only the fallback does it here.
        if (lastSec !== null && sec > 0 && !motionRing) sfx(sec <= 3 ? 'urgent' : 'tick');
        lastSec = sec;
      }
      if (!opts.paused && rem <= 0) {
        stopClock();
        if (ringEl && !motionRing) { const n = $('timer-num'); if (n) n.textContent = '0'; }
        opts.onDone?.();
      }
    };
    paint();
    if (!opts.paused) S.clock = setInterval(paint, 100);
  }

  // ---------------------------------------------------------------- shared renderers
  function renderLobby(vm) {
    $('lobby-code').textContent = vm.code;
    $('lobby-status').textContent = vm.isHost
      ? (vm.players.length < R.MIN_PLAYERS ? 'Share the code with your friends' : 'Everyone in? Tap start')
      : 'Waiting for ' + vm.hostName + ' to start';
    $('lobby-share').classList.toggle('hidden', !vm.isHost);
    const list = $('lobby-players');
    list.innerHTML = vm.players.map((p) =>
      '<li class="player-item" data-id="' + esc(p.id) + '"><span>' + esc(p.name) + (p.isHost ? '<span class="tag">Game Master</span>' : '') + '' + '</span>' +
      (vm.isHost && !p.isHost ? '<button type="button" class="remove-btn" data-remove="' + esc(p.id) + '" aria-label="Remove ' + esc(p.name) + '" data-name="' + esc(p.name) + '">&times;</button>' : '') + '</li>').join('');
    $('lobby-timer-setting').classList.toggle('hidden', !vm.isHost);
    $('lobby-timer-value').textContent = vm.timerSeconds;
    const start = $('lobby-start-btn');
    start.classList.toggle('hidden', !vm.isHost);
    start.disabled = vm.players.length < R.MIN_PLAYERS;
    const missing = R.MIN_PLAYERS - vm.players.length;
    $('lobby-hint').textContent = vm.isHost
      ? (missing > 0 ? 'Need ' + missing + ' more player' + (missing > 1 ? 's' : '') : vm.players.length + ' players, ' + vm.timerSeconds + ' seconds per answer')
      : 'Answer time ' + vm.timerSeconds + ' seconds';
    $('lobby-leave-btn').textContent = vm.isHost ? 'Close room' : 'Leave room';
  }

  function renderReady(vm) {
    setTone(vm.round);
    setView(vm.meOut ? 'out' : null);
    $('ready-round').textContent = 'Round ' + vm.round;
    $('ready-question').textContent = vm.question;
    $('ready-hint').textContent = vm.meOut ? "You're out. Watch this round." : '';
    const key = 'ready:' + vm.round + ':' + vm.clockKey;
    if (S.clockKey !== key) {
      S.clockKey = key;
      runClock({ num: 'ready-count', totalMs: R.GET_READY_MS, remaining: vm.remaining, paused: vm.paused, onDone: vm.onDone });
    }
    go('screen-ready');
  }

  function renderAnswer(vm) {
    setTone(vm.round);
    setView(vm.meOut ? 'out' : null);
    $('answer-round').textContent = 'Round ' + vm.round + (vm.turnLabel ? ', ' + vm.turnLabel : '');
    $('answer-question').textContent = vm.question;
    $('answer-form').classList.toggle('hidden', vm.meOut || vm.answered);
    $('answer-locked').classList.toggle('hidden', vm.meOut || !vm.answered);
    $('answer-out').classList.toggle('hidden', !vm.meOut);
    if (vm.answered) $('answer-locked-text').textContent = vm.answer || '';
    const waiting = vm.waitingFor.length ? 'Waiting for ' + joinNames(vm.waitingFor) : 'Everyone is in. Locking answers';
    $('answer-waiting').textContent = waiting;
    $('answer-out-waiting').textContent = waiting;
    $('answer-paused').classList.toggle('hidden', !vm.paused);
    $('answer-paused-by').textContent = vm.hostName || 'the Game Master';
    $('answer-host-row').classList.toggle('hidden', !vm.hostControls);
    $('host-pause-btn').textContent = vm.paused ? 'Resume' : 'Pause';
    const input = $('answer-input');
    input.disabled = !!vm.paused;
    $('answer-submit-btn').disabled = !!vm.paused;
    const key = 'answer:' + vm.round + ':' + vm.clockKey + ':' + (vm.paused ? 'p' : 'r');
    if (S.clockKey !== key) {
      S.clockKey = key;
      if (!vm.keepInput) input.value = '';
      runClock({ ring: true, totalMs: vm.totalMs, remaining: vm.remaining, paused: vm.paused, onDone: vm.onDone });
    }
    go('screen-answer').then(() => { if (!vm.meOut && !vm.answered && !vm.paused && S.screen === 'screen-answer') input.focus({ preventScroll: true }); });
  }

  function renderReview(vm) {
    stopClock();
    setTone(vm.round);
    setView(vm.meOut ? 'out' : null);
    $('review-round').textContent = 'Round ' + vm.round;
    $('review-question').textContent = vm.question;
    const list = $('review-list');
    const listKey = 'review:' + vm.round + ':' + vm.list.map((x) => x.id).join(',') + ':' + (vm.isHost ? 'h' : 'p');
    if (S.listKey !== listKey) {
      S.listKey = listKey;
      S.elimKey = '';
      list.innerHTML = vm.list.map((a) => {
        const tag = vm.isHost && !a.eliminated ? 'button' : 'div';
        const flag = a.blank ? 'No answer' : (a.duplicate ? 'Duplicate' : '');
        return '<' + tag + (tag === 'button' ? ' type="button"' : '') + ' class="answer-item' + (a.blank ? ' is-blank' : '') + (a.duplicate ? ' is-duplicate' : '') + (a.eliminated ? ' is-out' : '') + '" data-id="' + esc(a.id) + '">' +
          '<span class="ans-main"><span class="ans-text">' + (a.blank ? 'Nothing' : esc(a.answer)) + '</span><span class="ans-name">' + esc(a.name) + (a.isHost ? ', Game Master' : '') + '' + '</span></span>' +
          (flag ? '<span class="ans-flag">' + flag + '</span>' : '') +
          (vm.isHost ? '<span class="ans-check" aria-hidden="true">&#10003;</span>' : '') +
          '</' + tag + '>';
      }).join('');
      try { window.Motion?.stagger?.(list, { selector: '.answer-item', delay: 50 }); } catch (e) { /* ignore */ }
    }
    list.querySelectorAll('.answer-item').forEach((el) => el.classList.toggle('is-selected', vm.selected.has(el.dataset.id)));

    // Eliminations animate once per round on every phone.
    const elimKey = 'elim:' + vm.round + ':' + vm.eliminatedThisRound.join(',');
    if (vm.reviewDone && vm.eliminatedThisRound.length && S.elimKey !== elimKey) {
      S.elimKey = elimKey;
      const hasMotion = typeof window.Motion?.eliminate === 'function';
      if (!hasMotion) { sfx('elim'); haptic('heavy'); }
      vm.eliminatedThisRound.forEach((id, i) => {
        const el = list.querySelector('.answer-item[data-id="' + CSS.escape(id) + '"]');
        if (!el) return;
        el.classList.remove('is-selected');
        if (el.tagName === 'BUTTON') el.disabled = true;
        setTimeout(() => {
          let done = false;
          if (hasMotion) { try { done = !!window.Motion.eliminate(el, { shake: i === 0 }); } catch (e) { done = false; } }
          if (!done) el.classList.add('ooi-fall');
          el.classList.add('is-out');
        }, i * 220);
      });
    } else if (vm.reviewDone) {
      vm.eliminatedThisRound.forEach((id) => list.querySelector('.answer-item[data-id="' + CSS.escape(id) + '"]')?.classList.add('is-out'));
    }

    $('review-host').classList.toggle('hidden', !vm.isHost);
    const primary = $('review-primary-btn');
    primary.classList.remove('btn-out');
    if (vm.isHost) {
      if (vm.reviewDone) {
        primary.textContent = 'Next round';
        $('review-sub').textContent = vm.eliminatedThisRound.length + ' out, ' + vm.aliveCount + ' still in';
      } else if (vm.selected.size) {
        primary.textContent = 'Eliminate ' + vm.selected.size;
        primary.classList.add('btn-out');
        $('review-sub').textContent = vm.selected.size + ' selected';
      } else {
        primary.textContent = 'Nobody out, next round';
        $('review-sub').textContent = 'Tap who is out: blank, bogus or duplicate';
      }
    } else {
      $('review-sub').textContent = vm.reviewDone
        ? vm.eliminatedThisRound.length + ' out. Waiting for ' + vm.hostName
        : (vm.selected.size ? vm.hostName + ' picked ' + vm.selected.size : vm.hostName + ' is deciding');
    }
    go('screen-review');
  }

  function renderWinner(vm) {
    stopClock();
    setTone(0);
    setView('winner');
    $('winner-name').textContent = vm.name;
    $('winner-again-btn').classList.toggle('hidden', !vm.isHost);
    $('winner-hint').textContent = vm.isHost ? '' : 'Waiting for ' + vm.hostName + ' to play again';
    const key = 'winner:' + vm.key;
    go('screen-winner').then(() => {
      if (S.winnerKey === key) return;
      S.winnerKey = key;
      sfx('win');
      haptic('heavy');
      try { window.Motion?.winner?.($('winner-card'), { color: GOLD }); } catch (e) { /* ignore */ }
    });
  }

  function resetRenderKeys() { S.clockKey = S.listKey = S.elimKey = S.winnerKey = ''; }

  // ---------------------------------------------------------------- mode A: everyone's phone
  function serverNow() { return Date.now() + S.offset; }

  function attachRoom(room) {
    S.mode = 'net';
    S.room = room;
    S.local = null;
    resetRenderKeys();
    room.on?.('state', onNetState);
    room.on?.('status', onNetStatus);
    if (room.state) onNetState(room.state);
  }

  function onNetStatus(status) {
    if (status === 'waking') toast('Waking up the server, hang on');
    else if (status === 'offline') toast('Connection lost, retrying', 'error');
  }

  function send(type, payload) {
    if (!S.room) return Promise.resolve(null);
    return S.room.send(type, payload || {}).then((state) => {
      if (state && (!S.state || state.version >= S.state.version)) onNetState(state);
      return state;
    }).catch((e) => { toast(e?.message || 'Something went wrong', 'error'); return null; });
  }

  // The clock ran out on this phone: ask the server to settle. It uses its own clock,
  // so retry until the phase actually moves on.
  function requestTick() {
    clearTimeout(S.tickRetry);
    const key = S.state ? S.state.phase + ':' + S.state.deadline : '';
    let tries = 0;
    const attempt = () => {
      if (S.mode !== 'net' || !S.room || !S.state) return;
      if (S.state.phase + ':' + S.state.deadline !== key) return;
      tries += 1;
      S.room.send('tick', {}).then((st) => { if (st) onNetState(st); }).catch(() => {}).finally(() => {
        if (S.state && S.state.phase + ':' + S.state.deadline === key && tries < 20) S.tickRetry = setTimeout(attempt, 500);
      });
    };
    attempt();
  }

  function onNetState(state) {
    if (!state || S.mode !== 'net') return;
    if (S.state && typeof state.version === 'number' && state.version < S.state.version) return;
    const prev = S.state;
    S.state = state;
    if (typeof state.serverNow === 'number') S.offset = state.serverNow - Date.now();
    const me = state.me || {};
    const players = state.players || [];
    const host = players.find((p) => p.id === state.hostId) || {};
    if (me.isHost && Array.isArray(state.used)) rememberUsed(state.used);
    if (!players.some((p) => p.id === me.id) && state.phase !== 'lobby') { leaveToHome('You were removed from the room'); return; }
    if (prev && prev.phase !== 'lobby' && state.phase === 'lobby' && state.endedEarly) toast('Game ended by ' + (me.isHost ? 'you' : host.name));

    const remaining = () => R.remainingMs(state, serverNow());
    const waitingFor = R.alivePlayers(players).filter((p) => !(state.answered || []).includes(p.id)).map((p) => p.name);
    const settings = state.settings || { timerSeconds: R.TIMER.default };

    switch (state.phase) {
      case 'lobby':
        stopClock();
        setTone(0);
        setView(null);
        renderLobby({ code: state.code, players, isHost: !!me.isHost, meId: me.id, hostName: host.name || 'the Game Master', timerSeconds: settings.timerSeconds });
        go('screen-lobby', prev && prev.phase !== 'lobby' ? 'back' : 'forward');
        break;
      case 'ready':
        renderReady({ round: state.round, question: state.question, meOut: !!me.eliminated, clockKey: state.deadline, remaining, paused: state.paused, onDone: requestTick });
        break;
      case 'answer':
        renderAnswer({
          round: state.round, question: state.question, meOut: !!me.eliminated, answered: !!me.answered, answer: me.answer,
          waitingFor, paused: state.paused, hostName: host.name, hostControls: !!me.isHost,
          clockKey: state.deadline, totalMs: settings.timerSeconds * 1000, remaining, onDone: requestTick,
          keepInput: !!prev && prev.phase === 'answer' && prev.round === state.round,
        });
        break;
      case 'review':
        renderReview({
          round: state.round, question: state.question, list: state.review || [], isHost: !!me.isHost, meId: me.id, meOut: !!me.eliminated,
          selected: new Set(state.selected || []), eliminatedThisRound: state.eliminatedThisRound || [], reviewDone: !!state.reviewDone,
          hostName: host.name || 'the Game Master', aliveCount: R.alivePlayers(players).length,
        });
        break;
      case 'winner': {
        const w = players.find((p) => p.id === state.winnerId) || {};
        renderWinner({ name: w.name || 'Nobody', isHost: !!me.isHost, hostName: host.name || 'the Game Master', key: state.code + ':' + state.winnerId + ':' + state.round });
        break;
      }
      default:
        break;
    }
  }

  function leaveToHome(message) {
    stopClock();
    clearTimeout(S.tickRetry);
    try { S.room?.leave?.(); } catch (e) { /* ignore */ }
    S.room = null;
    S.state = null;
    S.mode = null;
    resetRenderKeys();
    setTone(0);
    setView(null);
    if (message) toast(message);
    go('screen-home', 'back');
  }

  function netAvailable() {
    if (window.Net && typeof window.Net.create === 'function') return true;
    toast('Online play is not loaded on this page yet. Try One phone.', 'error');
    return false;
  }

  async function netCreate() {
    const name = R.cleanName($('net-name-input').value);
    if (name.length < 2) { showErr('net-error', 'Enter your name first'); return; }
    if (!netAvailable()) return;
    store(KEY_NAME, name);
    const btn = $('net-create-btn');
    btn.disabled = true;
    btn.textContent = 'Creating';
    try {
      const room = await window.Net.create('ooi', name, { timerSeconds: S.timerSeconds, recentQuestions: deviceUsed() });
      attachRoom(room);
    } catch (e) {
      showErr('net-error', e?.message || 'Could not reach the server');
    }
    btn.disabled = false;
    btn.textContent = 'Create a room';
  }

  async function netJoin() {
    const code = $('join-code-input').value.replace(/\D/g, '');
    const name = R.cleanName($('join-name-input').value);
    if (code.length !== 4) { showErr('join-error', 'Enter the 4-digit room code'); return; }
    if (name.length < 2) { showErr('join-error', 'Enter your name first'); return; }
    if (!netAvailable()) return;
    store(KEY_NAME, name);
    const btn = $('join-btn');
    btn.disabled = true;
    btn.textContent = 'Joining';
    try {
      const room = await window.Net.join('ooi', code, name);
      attachRoom(room);
    } catch (e) {
      showErr('join-error', e?.message === 'started' ? 'That game has already started' : (e?.message || 'Room not found'));
    }
    btn.disabled = false;
    btn.textContent = 'Join';
  }

  async function netRejoin() {
    if (!window.Net?.rejoin) return false;
    try {
      const room = await window.Net.rejoin('ooi');
      if (room) { attachRoom(room); return true; }
    } catch (e) { /* no session */ }
    return false;
  }

  // Copy that also works on plain http pages (the clipboard API needs https or localhost).
  async function copyText(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      const done = document.execCommand('copy');
      ta.remove();
      return !!done;
    } catch (e) { return false; }
  }

  function shareUrl() { return window.location.origin + window.location.pathname + '?code=' + (S.state?.code || ''); }

  async function shareRoom() {
    const code = S.state?.code || '';
    const text = 'Join my Odd One In game. Room ' + code;
    // Opens WhatsApp when it is installed, otherwise WhatsApp Web, with the invite ready to send.
    const link = 'https://wa.me/?text=' + encodeURIComponent(text + '\n' + shareUrl());
    const win = window.open(link, '_blank');
    if (!win) { if (await copyText(text + '\n' + shareUrl())) toast('Invite copied, paste it in WhatsApp'); else toast('Room code ' + code); }
  }

  // ---------------------------------------------------------------- mode B: one phone
  async function loadQuestions() {
    if (S.questions) return S.questions;
    try {
      const res = await fetch('../questions.json', { cache: 'no-cache' });
      S.questions = R.loadQuestions(await res.json());
    } catch (e) {
      S.questions = { tier1: ['Name a fruit.'], tier2: ['Name a season.'], tier3: ['Name a side of a coin.'] };
    }
    return S.questions;
  }

  function saveLocal() { store(KEY_LOCAL, S.local); }

  function renderLocalSetup() {
    $('local-players').innerHTML = S.localNames.map((n, i) =>
      '<li class="player-item"><span>' + esc(n) + (i === 0 ? '<span class="tag">Game Master</span>' : '') + '</span><button type="button" class="remove-btn" data-remove="' + i + '" aria-label="Remove ' + esc(n) + '" data-name="' + esc(n) + '">&times;</button></li>').join('');
    $('local-timer-value').textContent = S.timerSeconds;
    const n = S.localNames.length;
    $('local-start-btn').disabled = n < R.MIN_PLAYERS;
    $('local-hint').textContent = n < R.MIN_PLAYERS
      ? 'Add at least ' + R.MIN_PLAYERS + ' players, ' + (R.MIN_PLAYERS - n) + ' more to go'
      : n + ' players, ' + S.timerSeconds + ' seconds per answer. The first name is the Game Master.';
  }

  function localAddName() {
    const input = $('local-name-input');
    const name = R.cleanName(input.value);
    if (!name) return;
    if (S.localNames.some((n) => n.toLowerCase() === name.toLowerCase())) { toast(name + ' is already in', 'error'); return; }
    if (S.localNames.length >= R.MAX_PLAYERS) { toast('That is the maximum, ' + R.MAX_PLAYERS + ' players', 'error'); return; }
    S.localNames.push(name);
    input.value = '';
    input.focus();
    sfx('tap');
    renderLocalSetup();
  }

  async function localStart() {
    if (S.localNames.length < R.MIN_PLAYERS) return;
    await loadQuestions();
    S.mode = 'local';
    resetRenderKeys();
    S.local = {
      players: S.localNames.map((name, i) => ({ id: 'l' + i, name, isHost: i === 0, eliminated: false })),
      timerSeconds: S.timerSeconds,
      round: 0, question: '', tier: null, used: deviceUsed(),
      answers: {}, order: [], turn: 0, phase: 'pass', deadline: 0,
      selected: [], eliminatedThisRound: [], reviewDone: false, winnerId: null,
    };
    localBeginRound();
  }

  function localBeginRound() {
    const L = S.local;
    const alive = R.alivePlayers(L.players);
    L.round += 1;
    L.tier = R.pickTier(alive.length);
    const picked = R.pickQuestion(R.tierPool(S.questions, L.tier), L.used);
    L.question = picked.question;
    L.used = picked.used;
    rememberUsed(L.used);
    L.answers = {};
    L.order = alive.map((p) => p.id);
    L.turn = 0;
    L.selected = [];
    L.eliminatedThisRound = [];
    L.reviewDone = false;
    L.phase = 'pass';
    saveLocal();
    renderLocal();
  }

  function localCurrent() { const L = S.local; return L.players.find((p) => p.id === L.order[L.turn]); }

  function renderLocal() {
    const L = S.local;
    if (!L) return;
    const host = L.players.find((p) => p.isHost) || {};
    switch (L.phase) {
      case 'pass': {
        stopClock();
        setTone(L.round);
        setView(null);
        const p = localCurrent();
        $('pass-round').textContent = 'Round ' + L.round + ', player ' + (L.turn + 1) + ' of ' + L.order.length;
        $('pass-name').textContent = p.name;
        $('pass-sub').textContent = 'Make sure nobody else can see the screen. Tap I\'m ready and the question and clock appear.';
        go('screen-pass');
        break;
      }
      case 'answer': {
        const p = localCurrent();
        renderAnswer({
          round: L.round, turnLabel: p.name + "'s turn", question: L.question, meOut: false, answered: false, answer: '',
          waitingFor: [], paused: false, hostName: host.name, hostControls: false,
          clockKey: L.deadline, totalMs: L.timerSeconds * 1000, remaining: () => Math.max(0, L.deadline - Date.now()),
          onDone: () => localLockTurn($('answer-input').value),
        });
        break;
      }
      case 'review':
        renderReview({
          round: L.round, question: L.question, list: R.sortForReview(L.players, L.answers), isHost: true, meId: null, meOut: false,
          selected: new Set(L.selected), eliminatedThisRound: L.eliminatedThisRound, reviewDone: L.reviewDone,
          hostName: host.name, aliveCount: R.alivePlayers(L.players).length,
        });
        break;
      case 'winner': {
        const w = L.players.find((p) => p.id === L.winnerId) || {};
        renderWinner({ name: w.name || 'Nobody', isHost: true, hostName: host.name, key: 'local:' + L.round + ':' + L.winnerId });
        break;
      }
      default:
        break;
    }
  }

  function localReady() {
    const L = S.local;
    L.phase = 'answer';
    L.deadline = Date.now() + L.timerSeconds * 1000;
    saveLocal();
    renderLocal();
  }

  // Locks this player's answer (typed text when time runs out, or the submitted text) and moves on.
  function localLockTurn(text) {
    const L = S.local;
    if (!L || L.phase !== 'answer') return;
    const p = localCurrent();
    L.answers[p.id] = R.cleanAnswer(text);
    stopClock();
    L.turn += 1;
    if (L.turn < L.order.length) {
      L.phase = 'pass';
    } else {
      L.answers = R.lockAnswers(L.players, L.answers);
      L.phase = 'review';
    }
    saveLocal();
    renderLocal();
  }

  function localSelect(id) {
    const L = S.local;
    if (L.reviewDone) return;
    const i = L.selected.indexOf(id);
    if (i >= 0) L.selected.splice(i, 1); else L.selected.push(id);
    saveLocal();
    renderLocal();
  }

  function localPrimary() {
    const L = S.local;
    if (L.reviewDone || !L.selected.length) { localBeginRound(); return; }
    const err = R.canEliminate(L.players, L.selected);
    if (err) { toast(err, 'error'); return; }
    L.players = R.applyEliminations(L.players, L.selected, L.round);
    L.eliminatedThisRound = L.selected.slice();
    L.selected = [];
    L.reviewDone = true;
    const winner = R.checkWinner(L.players);
    if (winner) { L.winnerId = winner.id; L.phase = 'winner'; }
    saveLocal();
    renderLocal();
  }

  function localEnd(toSetup) {
    stopClock();
    S.local = null;
    S.mode = null;
    store(KEY_LOCAL, null);
    resetRenderKeys();
    setTone(0);
    setView(null);
    if (toSetup) { renderLocalSetup(); go('screen-local-setup', 'back'); }
    else go('screen-home', 'back');
  }

  function localResume() {
    const saved = load(KEY_LOCAL, null);
    if (!saved || !Array.isArray(saved.players) || saved.phase === 'winner') { store(KEY_LOCAL, null); return false; }
    S.local = saved;
    S.mode = 'local';
    S.localNames = saved.players.map((p) => p.name);
    if (saved.phase === 'answer') saved.phase = 'pass'; // the clock does not survive a refresh, restart this player's turn
    loadQuestions().then(renderLocal);
    return true;
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    const savedName = load(KEY_NAME, '');
    $('net-name-input').value = savedName;
    $('join-name-input').value = savedName;
    S.timerSeconds = Math.min(R.TIMER.max, Math.max(R.TIMER.min, Number(load(KEY_TIMER, R.TIMER.default)) || R.TIMER.default));
    $('lobby-timer-value').textContent = S.timerSeconds;
    $('local-timer-value').textContent = S.timerSeconds;
    document.querySelectorAll('.mode-card, .stepper-btn').forEach((el) => { try { window.Motion?.press?.(el); } catch (e) { /* ignore */ } });

    // home
    $('mode-create-btn').addEventListener('click', () => { sfx('tap'); go('screen-net'); });
    $('mode-join-btn').addEventListener('click', () => { sfx('tap'); go('screen-join'); });
    // ONE PHONE MODE DISABLED for now: the card is commented out in the page. Restore both to bring it back.
    // $('mode-local-btn').addEventListener('click', () => { sfx('tap'); renderLocalSetup(); go('screen-local-setup'); });
    $('server-settings-link').addEventListener('click', () => {
      let current = '';
      try { current = window.Net?.getServerUrl?.() || load(KEY_SERVER, '') || localStorage.getItem(KEY_SERVER_LEGACY) || ''; } catch (e) { /* ignore */ }
      $('server-url-input').value = current;
      go('screen-server');
    });
    $('server-save-btn').addEventListener('click', () => {
      const url = $('server-url-input').value.trim();
      if (window.Net?.setServerUrl) window.Net.setServerUrl(url);
      else { store(KEY_SERVER, url || null); try { if (!url) localStorage.removeItem(KEY_SERVER_LEGACY); } catch (e) { /* ignore */ } }
      toast(url ? 'Server saved' : 'Using the default server');
      go('screen-net', 'back');
    });
    $('server-back-btn').addEventListener('click', () => go('screen-net', 'back'));
    // Top-left back icons trigger the screen's own Back button
    document.querySelectorAll('.topbar-back[data-back]').forEach((b) => {
      b.addEventListener('click', () => { const t = $(b.dataset.back); if (t) t.click(); });
    });
    // Rules popup, the same as Mafia and Undercover
    const rulesModal = $('rules-modal');
    if (rulesModal && $('rules-btn')) {
      if (rulesModal.parentElement !== document.body) document.body.appendChild(rulesModal);
      const openRules = () => { rulesModal.classList.remove('hidden'); const s = rulesModal.querySelector('.rules-scroll'); if (s) s.scrollTop = 0; };
      const closeRules = () => rulesModal.classList.add('hidden');
      $('rules-btn').addEventListener('click', openRules);
      $('close-rules').addEventListener('click', closeRules);
      $('rules-modal-overlay').addEventListener('click', closeRules);
    }

    // net setup
    $('net-create-btn').addEventListener('click', netCreate);
    $('net-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') netCreate(); });
    $('net-back-btn').addEventListener('click', () => go('screen-home', 'back'));
    $('join-btn').addEventListener('click', netJoin);
    $('join-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') netJoin(); });
    $('join-code-input').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
    $('join-back-btn').addEventListener('click', () => go('screen-home', 'back'));

    // lobby
    $('lobby-start-btn').addEventListener('click', () => { sfx('tap'); send('start'); });
    $('lobby-leave-btn').addEventListener('click', () => leaveToHome());
    $('lobby-back-icon').addEventListener('click', () => {
      const host = !!S.state?.players?.find?.((p) => p.id === S.state?.me?.id)?.isHost;
      if (host) askConfirm('Close the room?', 'The game ends and everyone is sent home.', 'Close room', () => leaveToHome());
      else askConfirm('Leave the room?', 'You can join again with the same code.', 'Leave room', () => leaveToHome());
    });
    $('lobby-rules-btn').addEventListener('click', () => $('rules-btn').click());
    $('lobby-players').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      askConfirm('Remove ' + (btn.dataset.name || 'this player') + '?', 'They can join again with the room code.', 'Remove', () => send('kick', { playerId: btn.dataset.remove }));
    });
    $('lobby-timer-minus').addEventListener('click', () => send('setTimer', { timerSeconds: Math.max(R.TIMER.min, (S.state?.settings?.timerSeconds || R.TIMER.default) - 1) }));
    $('lobby-timer-plus').addEventListener('click', () => send('setTimer', { timerSeconds: Math.min(R.TIMER.max, (S.state?.settings?.timerSeconds || R.TIMER.default) + 1) }));
    $('share-btn').addEventListener('click', shareRoom);
    $('share-copy-btn').addEventListener('click', async () => {
      const url = shareUrl();
      if (await copyText(url)) toast('Link copied'); else toast('Could not copy. Room code ' + (S.state?.code || ''));
    });

    // local setup
    $('local-add-form').addEventListener('submit', (e) => { e.preventDefault(); localAddName(); });
    $('local-players').addEventListener('click', (e) => {
      const i = e.target.closest('[data-remove]')?.dataset.remove;
      if (i !== undefined) { S.localNames.splice(Number(i), 1); renderLocalSetup(); }
    });
    $('local-timer-minus').addEventListener('click', () => { setTimerSetting(S.timerSeconds - 1); renderLocalSetup(); });
    $('local-timer-plus').addEventListener('click', () => { setTimerSetting(S.timerSeconds + 1); renderLocalSetup(); });
    $('local-start-btn').addEventListener('click', () => { sfx('tap'); localStart(); });
    $('local-back-btn').addEventListener('click', () => go('screen-home', 'back'));

    // pass the phone
    $('pass-ready-btn').addEventListener('click', () => { sfx('tap'); localReady(); });
    $('pass-end-btn').addEventListener('click', (e) => armDanger(e.currentTarget, () => localEnd(true)));

    // answer
    const submit = () => {
      const text = R.cleanAnswer($('answer-input').value);
      if (!text) { toast('Type an answer first', 'error'); $('answer-input').focus(); return; }
      sfx('tap');
      haptic('light');
      if (S.mode === 'local') { localLockTurn(text); return; }
      $('answer-submit-btn').disabled = true;
      send('answer', { text }).then(() => { $('answer-submit-btn').disabled = false; });
    };
    $('answer-submit-btn').addEventListener('click', submit);
    $('answer-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    $('host-pause-btn').addEventListener('click', () => send(S.state?.paused ? 'resume' : 'pause'));
    $('host-skip-btn').addEventListener('click', () => send('skip'));
    $('host-reset-btn').addEventListener('click', () => askConfirm('Restart the timer?', 'Everyone answers this question again from the start.', 'Restart', () => send('reset')));
    $('host-end-btn').addEventListener('click', (e) => armDanger(e.currentTarget, () => send('endGame')));

    // review
    $('review-list').addEventListener('click', (e) => {
      const el = e.target.closest('button.answer-item');
      if (!el || el.disabled) return;
      sfx('tap');
      if (S.mode === 'local') localSelect(el.dataset.id);
      else send('select', { playerId: el.dataset.id });
    });
    $('review-primary-btn').addEventListener('click', () => {
      sfx('tap');
      if (S.mode === 'local') { localPrimary(); return; }
      const st = S.state;
      if (!st) return;
      if (st.reviewDone || !(st.selected || []).length) send('nextRound');
      else send('eliminate');
    });
    $('review-end-btn').addEventListener('click', (e) => armDanger(e.currentTarget, () => { if (S.mode === 'local') localEnd(true); else send('endGame'); }));

    // winner
    $('winner-again-btn').addEventListener('click', () => { sfx('tap'); if (S.mode === 'local') localEnd(true); else send('restart'); });
    $('winner-home-btn').addEventListener('click', () => { if (S.mode === 'local') localEnd(false); else leaveToHome(); });

    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.mode === 'net' && S.state) onNetState(S.state); });
  }

  async function boot() {
    wire();
    const params = new URLSearchParams(window.location.search);
    const code = (params.get('code') || '').replace(/\D/g, '').slice(0, 4);
    if (code) {
      $('join-code-input').value = code;
      go('screen-join');
      setTimeout(() => { try { $('join-name-input').focus(); } catch (e) { /* ignore */ } }, 400);
      return;
    }
    if (await netRejoin()) return;
    localResume();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());

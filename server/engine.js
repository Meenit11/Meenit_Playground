'use strict';
/**
 * Room engine for Meenit's Playground.
 *
 * Generic, game-agnostic. Game rules live in ./games/<game>.js modules
 * (see PROTOCOL.md section 3). The engine owns rooms, codes, player ids,
 * persistence, expiry and fan-out of private views to subscribers.
 *
 * Reducers are treated as pure: the engine deep-clones state before every
 * call into a game module, stamps version/updatedAt afterwards and never
 * hands its own copy out.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  dataFile: path.join(__dirname, 'data', 'rooms.json'),
  gamesDir: path.join(__dirname, 'games'),
  persistDebounceMs: 250,
  expiryMs: 6 * 60 * 60 * 1000,
  sweepMs: 60 * 1000,
  maxRooms: 5000,
  now: () => Date.now(),
  log: (...args) => console.log(new Date().toISOString(), ...args),
};

const GAME_NAME_RE = /^[a-z0-9_-]{1,32}$/;
const CODE_RE = /^\d{4}$/;
const PLAYER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NAME_MAX = 24;
const COMMON_ACTIONS = ['start', 'leave', 'kick', 'restart'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function clone(value) {
  return structuredClone(value);
}

function newId() {
  return crypto.randomBytes(9).toString('base64url');
}

function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

function sameName(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function createEngine(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const rooms = new Map(); // code -> { code, game, state, lastActionAt }
  const subs = new Map(); // code -> Set<{ playerId, onState, onClose }>
  const modules = new Map(); // game -> module
  let saveTimer = null;
  let savePending = false;
  let sweepTimer = null;
  let closed = false;

  // ---------- game modules ----------
  function loadGame(game) {
    if (!GAME_NAME_RE.test(String(game || ''))) {
      throw new HttpError(400, 'Unknown game');
    }
    if (modules.has(game)) return modules.get(game);
    const file = path.join(opts.gamesDir, `${game}.js`);
    let mod;
    try {
      mod = require(file);
    } catch (e) {
      if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(file)) {
        throw new HttpError(400, `Unknown game '${game}'`);
      }
      opts.log(`game module ${game} failed to load:`, e);
      throw new HttpError(500, `The ${game} game is not available right now`);
    }
    for (const fn of ['validateSettings', 'init', 'join', 'reduce', 'view']) {
      if (typeof mod[fn] !== 'function') {
        opts.log(`game module ${game} is missing ${fn}()`);
        throw new HttpError(500, `The ${game} game is not available right now`);
      }
    }
    modules.set(game, mod);
    return mod;
  }

  function callModule(fn) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const message = e && e.message ? String(e.message) : 'That move is not allowed';
      throw new HttpError(400, message);
    }
  }

  // ---------- helpers ----------
  function getRoom(code) {
    const room = rooms.get(String(code));
    if (!room) throw new HttpError(404, 'Room not found');
    return room;
  }

  function requirePlayerId(playerId) {
    if (!PLAYER_ID_RE.test(String(playerId || ''))) {
      throw new HttpError(400, 'playerId is required');
    }
    return String(playerId);
  }

  function findPlayer(state, playerId) {
    return (state.players || []).find((p) => p && p.id === playerId) || null;
  }

  function newCode() {
    if (rooms.size >= 9000) throw new HttpError(503, 'No room codes left, try again later');
    for (let i = 0; i < 100; i++) {
      const code = String(1000 + crypto.randomInt(9000));
      if (!rooms.has(code)) return code;
    }
    throw new HttpError(503, 'Could not find a free room code, try again');
  }

  function isConnected(code, playerId) {
    const set = subs.get(code);
    if (!set) return false;
    for (const s of set) if (s.playerId === playerId) return true;
    return false;
  }

  function ensureShape(state, room) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.players)) {
      throw new HttpError(500, 'The game returned an invalid state');
    }
    state.code = room.code;
    state.game = room.game;
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    if (typeof state.phase !== 'string') state.phase = 'lobby';
    return state;
  }

  function commit(room, nextState) {
    const now = opts.now();
    const state = ensureShape(nextState, room);
    state.createdAt = room.state ? room.state.createdAt : now;
    state.updatedAt = now;
    state.version = room.state ? (room.state.version || 0) + 1 : 1;
    room.state = state;
    room.lastActionAt = now;
    if (state.players.length === 0) {
      deleteRoom(room.code, 'Room closed');
      return state;
    }
    scheduleSave();
    broadcast(room.code);
    return state;
  }

  function view(room, playerId) {
    const mod = loadGame(room.game);
    const full = clone(room.state);
    let v = callModule(() => mod.view(full, playerId));
    if (!v || typeof v !== 'object') throw new HttpError(500, 'The game returned an invalid view');
    v = clone(v);
    for (const key of ['code', 'game', 'createdAt', 'updatedAt', 'version']) v[key] = room.state[key];
    if (!Array.isArray(v.players)) v.players = [];
    for (const p of v.players) {
      if (p && typeof p === 'object') p.connected = isConnected(room.code, p.id);
    }
    v.me = { ...(v.me && typeof v.me === 'object' ? v.me : {}), id: playerId };
    return v;
  }

  function broadcast(code) {
    const set = subs.get(code);
    const room = rooms.get(code);
    if (!set || !room) return;
    for (const sub of [...set]) {
      if (!findPlayer(room.state, sub.playerId)) {
        set.delete(sub);
        safe(() => sub.onClose && sub.onClose('removed'));
        continue;
      }
      let v;
      try {
        v = view(room, sub.playerId);
      } catch (e) {
        opts.log('view failed', code, e.message);
        continue;
      }
      safe(() => sub.onState(v));
    }
    if (set.size === 0) subs.delete(code);
  }

  function safe(fn) {
    try {
      fn();
    } catch (e) {
      opts.log('subscriber callback failed:', e && e.message);
    }
  }

  function deleteRoom(code, reason) {
    rooms.delete(code);
    const set = subs.get(code);
    subs.delete(code);
    if (set) for (const sub of set) safe(() => sub.onClose && sub.onClose(reason));
    scheduleSave();
  }

  // ---------- public API ----------
  function createRoom({ game, hostName, settings } = {}) {
    if (closed) throw new HttpError(503, 'Server is shutting down');
    const mod = loadGame(game);
    const name = cleanName(hostName);
    if (!name) throw new HttpError(400, 'Please enter your name');
    if (settings !== undefined && (settings === null || typeof settings !== 'object' || Array.isArray(settings))) {
      throw new HttpError(400, 'Invalid settings');
    }
    if (rooms.size >= opts.maxRooms) throw new HttpError(503, 'The server is full, try again later');
    const merged = { ...clone(mod.defaultSettings || {}), ...clone(settings || {}) };
    const validSettings = callModule(() => mod.validateSettings(merged)) || merged;
    const hostId = newId();
    const code = newCode();
    const room = { code, game: String(game), state: null, lastActionAt: opts.now() };
    const init = callModule(() => mod.init({ code, hostId, hostName: name, settings: clone(validSettings) }));
    ensureShape(init, room);
    if (!init.hostId) init.hostId = hostId;
    rooms.set(code, room);
    const state = commit(room, init);
    return { code, playerId: hostId, state: view(room, hostId) };
  }

  function join(code, { name, playerId } = {}) {
    const room = getRoom(code);
    const mod = loadGame(room.game);
    const cleaned = cleanName(name);
    if (playerId !== undefined && playerId !== null && playerId !== '') {
      const pid = requirePlayerId(playerId);
      const existing = findPlayer(room.state, pid);
      if (existing) {
        if (cleaned && !sameName(cleaned, existing.name)) {
          const taken = room.state.players.some((p) => p.id !== pid && sameName(p.name, cleaned));
          if (taken) throw new HttpError(409, 'That name is already taken');
          const next = clone(room.state);
          findPlayer(next, pid).name = cleaned;
          commit(room, next);
        }
        return { playerId: pid, state: view(room, pid) };
      }
    }
    if (room.state.phase !== 'lobby') throw new HttpError(409, 'started');
    if (!cleaned) throw new HttpError(400, 'Please enter your name');
    if (room.state.players.some((p) => sameName(p.name, cleaned))) {
      throw new HttpError(409, 'That name is already taken');
    }
    const pid = newId();
    const player = { id: pid, name: cleaned, isHost: false };
    const next = callModule(() => mod.join(clone(room.state), player));
    if (!findPlayer(next, pid)) throw new HttpError(500, 'The game did not add the player');
    commit(room, next);
    return { playerId: pid, state: view(room, pid) };
  }

  function getView(code, playerId) {
    const room = getRoom(code);
    const pid = requirePlayerId(playerId);
    if (!findPlayer(room.state, pid)) throw new HttpError(403, 'You are not in this room');
    return view(room, pid);
  }

  function action(code, playerId, type, payload) {
    const room = getRoom(code);
    const pid = requirePlayerId(playerId);
    if (!findPlayer(room.state, pid)) throw new HttpError(403, 'You are not in this room');
    if (typeof type !== 'string' || !type.trim() || type.length > 64) {
      throw new HttpError(400, 'Invalid action');
    }
    const mod = loadGame(room.game);
    const act = { type: type.trim(), payload: payload === undefined ? {} : clone(payload) };
    const next = callModule(() => mod.reduce(clone(room.state), act, pid));
    if (!next || typeof next !== 'object') throw new HttpError(400, 'Invalid action');
    commit(room, next);
    if (!rooms.has(room.code) || !findPlayer(room.state, pid)) {
      return room.state ? stripForLeaver(room, pid) : null;
    }
    return view(room, pid);
  }

  function stripForLeaver(room, pid) {
    // The player is no longer in the room; return a minimal public view.
    return { code: room.code, game: room.game, phase: room.state.phase, version: room.state.version, players: [], me: { id: pid, left: true } };
  }

  function leave(code, playerId) {
    const room = rooms.get(String(code));
    const pid = requirePlayerId(playerId);
    if (!room || !findPlayer(room.state, pid)) return { ok: true };
    const mod = loadGame(room.game);
    let next;
    try {
      next = mod.reduce(clone(room.state), { type: 'leave', payload: {} }, pid);
    } catch (e) {
      // Fall back to removing the player directly so leaving always works.
      next = clone(room.state);
      next.players = next.players.filter((p) => p.id !== pid);
    }
    if (!next || !Array.isArray(next.players)) {
      next = clone(room.state);
      next.players = next.players.filter((p) => p.id !== pid);
    }
    commit(room, next);
    return { ok: true };
  }

  /**
   * subscribe(code, playerId, { onState(view), onClose(reason) }) -> unsubscribe()
   * Marks the player connected, pushes the current view immediately and on
   * every change. onClose fires with 'removed' (kicked/left) or 'Room closed'.
   */
  function subscribe(code, playerId, { onState, onClose } = {}) {
    const room = getRoom(code);
    const pid = requirePlayerId(playerId);
    if (!findPlayer(room.state, pid)) throw new HttpError(403, 'You are not in this room');
    const sub = { playerId: pid, onState: onState || (() => {}), onClose };
    if (!subs.has(room.code)) subs.set(room.code, new Set());
    subs.get(room.code).add(sub);
    broadcast(room.code); // everyone sees the new connected flag, sub gets its first view
    let done = false;
    return function unsubscribe() {
      if (done) return;
      done = true;
      const set = subs.get(room.code);
      if (!set) return;
      set.delete(sub);
      if (set.size === 0) subs.delete(room.code);
      if (rooms.has(room.code)) broadcast(room.code);
    };
  }

  // ---------- persistence ----------
  function scheduleSave() {
    savePending = true;
    if (saveTimer || closed) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow();
    }, opts.persistDebounceMs);
    if (saveTimer.unref) saveTimer.unref();
  }

  function saveNow() {
    savePending = false;
    if (!opts.dataFile) return;
    const data = {
      savedAt: opts.now(),
      rooms: [...rooms.values()].map((r) => ({ code: r.code, game: r.game, state: r.state, lastActionAt: r.lastActionAt })),
    };
    try {
      fs.mkdirSync(path.dirname(opts.dataFile), { recursive: true });
      const tmp = `${opts.dataFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, opts.dataFile);
    } catch (e) {
      opts.log('could not save rooms:', e.message);
    }
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (savePending) saveNow();
  }

  function load() {
    if (!opts.dataFile || !fs.existsSync(opts.dataFile)) return 0;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(opts.dataFile, 'utf8'));
    } catch (e) {
      opts.log('could not read rooms file, starting empty:', e.message);
      return 0;
    }
    let count = 0;
    for (const r of Array.isArray(data.rooms) ? data.rooms : []) {
      if (!r || !CODE_RE.test(String(r.code)) || !r.state || !Array.isArray(r.state.players)) continue;
      try {
        loadGame(r.game);
      } catch (e) {
        opts.log(`skipping saved room ${r.code}: ${e.message}`);
        continue;
      }
      rooms.set(String(r.code), { code: String(r.code), game: String(r.game), state: r.state, lastActionAt: Number(r.lastActionAt) || opts.now() });
      count++;
    }
    sweep();
    return count;
  }

  // ---------- expiry ----------
  function sweep() {
    const now = opts.now();
    let removed = 0;
    for (const room of [...rooms.values()]) {
      if (now - room.lastActionAt >= opts.expiryMs) {
        deleteRoom(room.code, 'Room closed');
        removed++;
      }
    }
    return removed;
  }

  function startSweeper() {
    if (sweepTimer) return;
    sweepTimer = setInterval(sweep, opts.sweepMs);
    if (sweepTimer.unref) sweepTimer.unref();
  }

  function close() {
    closed = true;
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
    flush();
    for (const [code, set] of subs) {
      for (const sub of set) safe(() => sub.onClose && sub.onClose('Server restarting'));
      subs.delete(code);
    }
  }

  return {
    createRoom,
    join,
    getView,
    action,
    leave,
    subscribe,
    load,
    flush,
    sweep,
    startSweeper,
    close,
    loadGame,
    get roomCount() {
      return rooms.size;
    },
    has: (code) => rooms.has(String(code)),
    options: opts,
    HttpError,
    COMMON_ACTIONS,
  };
}

module.exports = { createEngine, HttpError, cleanName, GAME_NAME_RE, CODE_RE, PLAYER_ID_RE };

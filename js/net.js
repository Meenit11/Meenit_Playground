/*
 * Meenit's Playground: client network library (window.Net).
 * Plain browser script, no modules. Load it before any game script.
 *
 * ============================ SET YOUR SERVER ============================
 * After deploying server/ on Render, put your service host on the next line
 * (just the host, no https:// and no trailing slash). That is the only edit
 * needed. Players can still override it in the app via Net.setServerUrl().
 */
var DEFAULT_RENDER_HOST = 'YOUR-SERVICE.onrender.com';
/* ======================================================================== */

(function (global) {
  'use strict';

  var DEFAULT_RENDER_URL = 'https://' + DEFAULT_RENDER_HOST;
  var PLACEHOLDER_HOST = 'YOUR-SERVICE.onrender.com';

  /*
   * Server URL resolution order:
   *   1. window.PG_SERVER_URL          (a page can hard-code one)
   *   2. localStorage 'pg_server_url'  (set from the settings screen)
   *   3. localStorage 'ooi_server_url' (legacy key, '/api/rooms' suffix stripped)
   *   4. dev machine: when the page is opened on localhost or 127.0.0.1,
   *      the same host on port 3001
   *   5. DEFAULT_RENDER_URL above
   */
  var KEY_URL = 'pg_server_url';
  var KEY_LEGACY_URL = 'ooi_server_url';
  var REQUEST_TIMEOUT_MS = 8000;
  var WAKE_TIMEOUT_MS = 60000;
  var SLOW_AFTER_MS = 2500;        // a request slower than this means 'waking'
  var POLL_MS = 1500;
  var PING_MS = 25000;
  var SOCKET_SILENCE_MS = 40000;   // no message for this long: reconnect
  var SESSION_TTL_MS = 3 * 60 * 60 * 1000;
  var MAX_RETRIES = 3;
  var DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

  var FRIENDLY = {
    started: 'This game has already started. Ask the host for a new room.',
  };
  var MSG_UNREACHABLE = 'Could not reach the server. Check your connection and try again.';
  var MSG_WAKING = 'The server is waking up. This can take up to a minute.';
  var MSG_NOT_CONFIGURED = 'No server is set. Open settings and enter the server URL.';

  // ------------------------------------------------------------ utilities
  function storageGet(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { global.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }
  function storageRemove(key) {
    try { global.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function NetError(message, status, code) {
    var err = new Error(message);
    err.name = 'NetError';
    err.status = status || 0;
    err.code = code || (status ? 'http_' + status : 'network');
    err.isNetError = true;
    return err;
  }

  function friendly(raw, status) {
    if (raw && FRIENDLY[raw]) return FRIENDLY[raw];
    if (raw && typeof raw === 'string') return raw;
    if (status === 404) return 'Room not found. Check the code and try again.';
    if (status === 413) return 'That is too much data to send.';
    if (status >= 500) return 'Something went wrong on the server. Try again.';
    return 'Something went wrong. Try again.';
  }

  function normaliseUrl(raw) {
    var url = String(raw || '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
      if (/^wss?:\/\//i.test(url)) url = url.replace(/^ws/i, 'http');
      else url = (isDevHost(url.split(/[/:]/)[0]) ? 'http://' : 'https://') + url;
    }
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/api\/rooms$/i, '').replace(/\/api$/i, '').replace(/\/ws$/i, '');
    return url.replace(/\/+$/, '');
  }

  function isDevHost(host) {
    var h = String(host || '').toLowerCase();
    if (DEV_HOSTS.indexOf(h) !== -1) return true;
    // Private network addresses and bare machine names: the site is being served
    // from a laptop on the same Wi-Fi, so the game server is on that machine too.
    if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
    if (/\.local$/.test(h)) return true;
    if (h && h.indexOf('.') === -1) return true;
    return false;
  }

  function getServerUrl() {
    if (global.PG_SERVER_URL) return normaliseUrl(global.PG_SERVER_URL);
    var stored = storageGet(KEY_URL);
    if (stored) return normaliseUrl(stored);
    var legacy = storageGet(KEY_LEGACY_URL);
    if (legacy) return normaliseUrl(legacy);
    var loc = global.location || {};
    if (isDevHost(loc.hostname)) return 'http://' + loc.hostname + ':3001';
    return DEFAULT_RENDER_URL;
  }

  function setServerUrl(url) {
    var clean = normaliseUrl(url);
    if (!clean) {
      storageRemove(KEY_URL);
      storageRemove(KEY_LEGACY_URL);
      return getServerUrl();
    }
    storageSet(KEY_URL, clean);
    storageRemove(KEY_LEGACY_URL);
    return clean;
  }

  function isConfigured() {
    var url = getServerUrl();
    return !!url && url.indexOf(PLACEHOLDER_HOST) === -1;
  }

  function wsUrl(code, playerId) {
    var base = getServerUrl().replace(/^http/i, 'ws');
    return base + '/ws?code=' + encodeURIComponent(code) + '&playerId=' + encodeURIComponent(playerId);
  }

  function mixedContentError() {
    var loc = global.location || {};
    var url = getServerUrl();
    if (loc.protocol === 'https:' && /^http:\/\//i.test(url) && !isDevHost(url.replace(/^http:\/\//i, '').split(/[/:]/)[0])) {
      return NetError('The server URL must start with https:// because this site is opened over https. Open settings and fix the URL.', 0, 'mixed_content');
    }
    return null;
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ------------------------------------------------------------ events
  function Emitter() {
    this._listeners = {};
  }
  Emitter.prototype.on = function (event, fn) {
    var self = this;
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return function () { self.off(event, fn); };
  };
  Emitter.prototype.off = function (event, fn) {
    var list = this._listeners[event];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  };
  Emitter.prototype.emit = function (event) {
    var args = Array.prototype.slice.call(arguments, 1);
    var list = (this._listeners[event] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i].apply(null, args); } catch (e) { if (global.console) console.error('Net listener failed', e); }
    }
  };

  var netEvents = new Emitter();
  var netStatus = 'connecting';
  function setNetStatus(status) {
    if (status === netStatus) return;
    netStatus = status;
    netEvents.emit('status', status);
  }

  // ------------------------------------------------------------ requests
  function fetchJson(method, path, body, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, timeoutMs);
    var opts = { method: method, headers: {}, cache: 'no-store' };
    if (controller) opts.signal = controller.signal;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(getServerUrl() + path, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = null; }
        return { status: res.status, data: data };
      });
    }).then(function (out) {
      clearTimeout(timer);
      return out;
    }, function (err) {
      clearTimeout(timer);
      var aborted = err && (err.name === 'AbortError');
      throw NetError(aborted ? 'The server took too long to answer.' : MSG_UNREACHABLE, 0, aborted ? 'timeout' : 'network');
    });
  }

  function isRetryable(result) {
    return result.data === null || result.status === 502 || result.status === 503 || result.status === 504;
  }

  /*
   * request(method, path, body, { retries, timeout, quiet })
   * Resolves to parsed JSON. Rejects with a NetError carrying a human message,
   * .status (HTTP status or 0) and .code (raw server error string).
   */
  function request(method, path, body, options) {
    options = options || {};
    var retries = options.retries === undefined ? MAX_RETRIES : options.retries;
    var timeout = options.timeout || REQUEST_TIMEOUT_MS;
    var mixed = mixedContentError();
    if (mixed) return Promise.reject(mixed);
    if (!isConfigured()) return Promise.reject(NetError(MSG_NOT_CONFIGURED, 0, 'not_configured'));
    var attempt = 0;
    var slowTimer = null;

    function markWaking() {
      if (!options.quiet) setNetStatus('waking');
    }

    function tryOnce() {
      slowTimer = setTimeout(markWaking, SLOW_AFTER_MS);
      return fetchJson(method, path, body, timeout).then(function (res) {
        clearTimeout(slowTimer);
        if (isRetryable(res)) throw NetError(MSG_WAKING, res.status, 'waking');
        if (res.status >= 200 && res.status < 300) return res.data;
        var raw = res.data && res.data.error;
        throw NetError(friendly(raw, res.status), res.status, raw || ('http_' + res.status));
      }, function (err) {
        clearTimeout(slowTimer);
        throw err;
      }).catch(function (err) {
        var retryable = err.code === 'network' || err.code === 'timeout' || err.code === 'waking';
        if (retryable && attempt < retries && global.navigator && global.navigator.onLine !== false) {
          attempt += 1;
          markWaking();
          return delay(Math.min(1000 * Math.pow(2, attempt - 1), 6000)).then(tryOnce);
        }
        if (retryable && !options.quiet) setNetStatus(global.navigator && global.navigator.onLine === false ? 'offline' : 'waking');
        if (err.code === 'waking') err.message = MSG_WAKING;
        throw err;
      });
    }
    return tryOnce();
  }

  /*
   * wake(onProgress): GET /api/health until it answers or 60 s pass.
   * onProgress({ attempt, elapsedMs, remainingMs }) before every try.
   */
  function wake(onProgress) {
    var started = Date.now();
    var attempt = 0;
    if (!isConfigured()) return Promise.reject(NetError(MSG_NOT_CONFIGURED, 0, 'not_configured'));
    setNetStatus('waking');
    function loop() {
      attempt += 1;
      var elapsed = Date.now() - started;
      if (typeof onProgress === 'function') {
        try { onProgress({ attempt: attempt, elapsedMs: elapsed, remainingMs: Math.max(0, WAKE_TIMEOUT_MS - elapsed) }); } catch (e) { /* ignore */ }
      }
      return request('GET', '/api/health', undefined, { retries: 0, quiet: true }).then(function (health) {
        setNetStatus('connecting');
        return health;
      }, function (err) {
        if (err.code === 'mixed_content' || err.code === 'not_configured') throw err;
        if (Date.now() - started >= WAKE_TIMEOUT_MS) {
          setNetStatus('offline');
          throw NetError('The server is not answering. Check the server URL in settings and try again.', 0, 'wake_timeout');
        }
        return delay(2000).then(loop);
      });
    }
    return loop();
  }

  // ------------------------------------------------------------ sessions
  function sessionKey(game) { return 'pg_session_' + game; }

  function saveSession(game, data) {
    storageSet(sessionKey(game), JSON.stringify({ code: data.code, playerId: data.playerId, game: game, name: data.name || '', savedAt: Date.now() }));
  }
  function loadSession(game) {
    var raw = storageGet(sessionKey(game));
    if (!raw) return null;
    var s = null;
    try { s = JSON.parse(raw); } catch (e) { s = null; }
    if (!s || !s.code || !s.playerId || !s.savedAt || Date.now() - s.savedAt > SESSION_TTL_MS) {
      storageRemove(sessionKey(game));
      return null;
    }
    return s;
  }
  function clearSession(game) { storageRemove(sessionKey(game)); }

  // ------------------------------------------------------------ Room
  var activeRooms = [];

  function Room(game, code, playerId, name, state) {
    Emitter.call(this);
    this.game = game;
    this.code = code;
    this.playerId = playerId;
    this.name = name;
    this.state = state || null;
    this.status = 'connecting';
    this.closed = false;
    this._socket = null;
    this._pollTimer = null;
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this._lastMessageAt = 0;
    this._failingSince = 0;
    this._sessionTouchedAt = Date.now();
    activeRooms.push(this);
  }
  Room.prototype = Object.create(Emitter.prototype);
  Room.prototype.constructor = Room;

  Room.prototype._setStatus = function (status) {
    if (this.closed && status !== 'offline') return;
    if (status === this.status) return;
    this.status = status;
    setNetStatus(status);
    this.emit('status', status);
  };

  Room.prototype._apply = function (state) {
    if (!state || typeof state !== 'object' || this.closed) return;
    if (this.state && typeof state.version === 'number' && typeof this.state.version === 'number' && state.version < this.state.version) return;
    this.state = state;
    if (Date.now() - this._sessionTouchedAt > 60000) {
      this._sessionTouchedAt = Date.now();
      saveSession(this.game, this);
    }
    this.emit('state', state);
  };

  Room.prototype._connect = function () {
    var self = this;
    if (this.closed || this._socket) return;
    if (typeof WebSocket === 'undefined') { this._startPolling(); return; }
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    var socket;
    try {
      socket = new WebSocket(wsUrl(this.code, this.playerId));
    } catch (e) {
      this._startPolling();
      this._scheduleReconnect();
      return;
    }
    this._socket = socket;
    if (this.status !== 'polling') this._setStatus('connecting');

    socket.onopen = function () {
      if (self._socket !== socket) return;
      self._reconnectAttempt = 0;
      self._failingSince = 0;
      self._lastMessageAt = Date.now();
      self._stopPolling();
      self._setStatus('live');
      self._startPing();
    };
    socket.onmessage = function (event) {
      if (self._socket !== socket) return;
      self._lastMessageAt = Date.now();
      var msg = null;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (!msg) return;
      if (msg.type === 'state') self._apply(msg.state);
      else if (msg.type === 'ack') self._apply(msg.state);
      else if (msg.type === 'error') {
        if (msg.closed) self._gone(msg.error);
        else self.emit('error', NetError(friendly(msg.error, msg.status), msg.status || 400, msg.error));
      }
    };
    socket.onclose = function () {
      if (self._socket !== socket) return;
      self._socket = null;
      self._stopPing();
      if (self.closed) return;
      self._startPolling();
      self._scheduleReconnect();
    };
    socket.onerror = function () { /* onclose follows */ };
  };

  Room.prototype._scheduleReconnect = function () {
    var self = this;
    if (this.closed || this._reconnectTimer) return;
    var wait = Math.min(1000 * Math.pow(2, this._reconnectAttempt), 15000) + Math.random() * 500;
    this._reconnectAttempt += 1;
    this._reconnectTimer = setTimeout(function () {
      self._reconnectTimer = null;
      self._connect();
    }, wait);
  };

  Room.prototype._startPing = function () {
    var self = this;
    this._stopPing();
    this._pingTimer = setInterval(function () {
      var socket = self._socket;
      if (!socket || socket.readyState !== 1) return;
      if (Date.now() - self._lastMessageAt > SOCKET_SILENCE_MS) {
        try { socket.close(); } catch (e) { /* ignore */ }
        return;
      }
      try { socket.send(JSON.stringify({ type: 'ping' })); } catch (e) { /* ignore */ }
    }, PING_MS);
  };
  Room.prototype._stopPing = function () {
    clearInterval(this._pingTimer);
    this._pingTimer = null;
  };

  Room.prototype._startPolling = function () {
    var self = this;
    if (this.closed || this._pollTimer) return;
    this._setStatus('polling');
    this.refresh();
    this._pollTimer = setInterval(function () { self.refresh(); }, POLL_MS);
  };
  Room.prototype._stopPolling = function () {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  };

  /* Fetch the latest private view once. Resolves to state or null. */
  Room.prototype.refresh = function () {
    var self = this;
    if (this.closed || this._refreshing) return Promise.resolve(this.state);
    this._refreshing = true;
    return request('GET', '/api/rooms/' + this.code + '?playerId=' + encodeURIComponent(this.playerId), undefined, { retries: 0, quiet: true })
      .then(function (data) {
        self._refreshing = false;
        self._failingSince = 0;
        if (!self._socket || self._socket.readyState !== 1) self._setStatus('polling');
        self._apply(data && data.state);
        return self.state;
      }, function (err) {
        self._refreshing = false;
        if (err.status === 404 || err.status === 403) { self._gone(err.message); return null; }
        if (err.status && err.status < 500) return null;
        if (!self._failingSince) self._failingSince = Date.now();
        var offline = (global.navigator && global.navigator.onLine === false) || Date.now() - self._failingSince > WAKE_TIMEOUT_MS;
        self._setStatus(offline ? 'offline' : 'waking');
        return null;
      });
  };

  /* send(type, payload) -> Promise<state>. Rejects with NetError on 4xx. */
  Room.prototype.send = function (type, payload) {
    var self = this;
    if (this.closed) return Promise.reject(NetError('You have left this room.', 0, 'closed'));
    return request('POST', '/api/rooms/' + this.code + '/action', { playerId: this.playerId, type: type, payload: payload === undefined ? {} : payload }, { retries: 1 })
      .then(function (data) {
        if (self.status === 'waking' || self.status === 'offline') self._setStatus(self._socket && self._socket.readyState === 1 ? 'live' : 'polling');
        self._apply(data && data.state);
        return self.state;
      }, function (err) {
        if (err.status === 404) self._gone(err.message);
        throw err;
      });
  };

  Room.prototype.leave = function () {
    if (this.closed) return Promise.resolve();
    var code = this.code, playerId = this.playerId;
    this._teardown();
    clearSession(this.game);
    this._setStatus('offline');
    return request('POST', '/api/rooms/' + code + '/leave', { playerId: playerId }, { retries: 0, quiet: true })
      .then(function () { return undefined; }, function () { return undefined; });
  };

  Room.prototype._gone = function (reason) {
    if (this.closed) return;
    this._teardown();
    clearSession(this.game);
    this._setStatus('offline');
    this.emit('closed', reason || 'This room is closed.');
  };

  Room.prototype._teardown = function () {
    this.closed = true;
    this._stopPolling();
    this._stopPing();
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    var socket = this._socket;
    this._socket = null;
    if (socket) {
      socket.onclose = null;
      try { socket.close(); } catch (e) { /* ignore */ }
    }
    var i = activeRooms.indexOf(this);
    if (i !== -1) activeRooms.splice(i, 1);
  };

  /* Called when the tab becomes visible or the device comes back online. */
  Room.prototype._wakeUp = function () {
    if (this.closed) return;
    this._reconnectAttempt = 0;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    var socket = this._socket;
    if (socket && socket.readyState === 1 && Date.now() - this._lastMessageAt < SOCKET_SILENCE_MS) {
      this.refresh();
      return;
    }
    if (socket) {
      this._socket = null;
      socket.onclose = null;
      try { socket.close(); } catch (e) { /* ignore */ }
    }
    this.refresh();
    this._connect();
  };

  function wakeAllRooms() {
    for (var i = 0; i < activeRooms.length; i++) activeRooms[i]._wakeUp();
  }
  if (global.document && global.document.addEventListener) {
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.visibilityState === 'visible') wakeAllRooms();
    });
  }
  if (global.addEventListener) {
    global.addEventListener('online', wakeAllRooms);
    global.addEventListener('pageshow', function (e) { if (e && e.persisted) wakeAllRooms(); });
  }

  // ------------------------------------------------------------ entry points
  function validGame(game) {
    if (typeof game !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(game)) {
      return Promise.reject(NetError('Unknown game.', 0, 'bad_game'));
    }
    return null;
  }

  function openRoom(game, code, playerId, name, state) {
    for (var i = activeRooms.length - 1; i >= 0; i--) activeRooms[i]._teardown();
    var room = new Room(game, code, playerId, name, state);
    saveSession(game, room);
    room._connect();
    if (state) setTimeout(function () { if (!room.closed) room.emit('state', room.state); }, 0);
    return room;
  }

  function create(game, hostName, settings) {
    var bad = validGame(game);
    if (bad) return bad;
    var name = String(hostName || '').trim();
    if (!name) return Promise.reject(NetError('Please enter your name.', 0, 'name'));
    return request('POST', '/api/rooms', { game: game, hostName: name, settings: settings || {} }).then(function (data) {
      return openRoom(game, data.code, data.playerId, name, data.state);
    });
  }

  function join(game, code, name) {
    var bad = validGame(game);
    if (bad) return bad;
    var cleanCode = String(code || '').replace(/\D/g, '');
    var cleanName = String(name || '').trim();
    if (cleanCode.length !== 4) return Promise.reject(NetError('Enter the 4-digit room code.', 0, 'code'));
    if (!cleanName) return Promise.reject(NetError('Please enter your name.', 0, 'name'));
    return request('POST', '/api/rooms/' + cleanCode + '/join', { name: cleanName }).then(function (data) {
      return openRoom(game, cleanCode, data.playerId, cleanName, data.state);
    });
  }

  /*
   * rejoin(game) -> Room | null. Null when there is no usable session or the
   * room is gone. Rejects (NetError) only when the server cannot be reached,
   * so the UI can offer a retry instead of silently dropping the game.
   */
  function rejoin(game) {
    var bad = validGame(game);
    if (bad) return bad;
    var session = loadSession(game);
    if (!session) return Promise.resolve(null);
    return request('POST', '/api/rooms/' + session.code + '/join', { name: session.name || undefined, playerId: session.playerId })
      .then(function (data) {
        if (data.playerId !== session.playerId) { clearSession(game); return null; }
        return openRoom(game, session.code, session.playerId, session.name, data.state);
      }, function (err) {
        if (err.status && err.status < 500) { clearSession(game); return null; }
        throw err;
      });
  }

  function hasSession(game) {
    return !!loadSession(game);
  }

  global.Net = {
    create: create,
    join: join,
    rejoin: rejoin,
    hasSession: hasSession,
    clearSession: clearSession,
    wake: wake,
    health: function () { return request('GET', '/api/health', undefined, { retries: 0, quiet: true }); },
    request: request,
    setServerUrl: setServerUrl,
    getServerUrl: getServerUrl,
    isConfigured: isConfigured,
    on: function (event, fn) { return netEvents.on(event, fn); },
    off: function (event, fn) { netEvents.off(event, fn); },
    get status() { return netStatus; },
    get rooms() { return activeRooms.slice(); },
    DEFAULT_RENDER_URL: DEFAULT_RENDER_URL,
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    POLL_MS: POLL_MS,
    SESSION_TTL_MS: SESSION_TTL_MS,
    version: '1.0.0',
  };
})(typeof window !== 'undefined' ? window : this);

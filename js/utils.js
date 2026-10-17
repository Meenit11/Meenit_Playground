// ================================
// SHARED UTILITIES
// Loaded first on every page, before motion.js / sfx.js / theme.js.
// Plain script, no dependencies.
// ================================

/**
 * Every localStorage key the playground writes, in one place.
 * The home-page long-press reset clears `keys` plus anything starting with `prefixes`.
 * Game agents: add new keys here instead of hard-coding them in index.html.
 */
window.PG_STORAGE_KEYS = {
    keys: [
        // Odd One In
        'ooi_used_tier1_broad', 'ooi_used_tier2_medium', 'ooi_used_tier3_narrow', 'ooi_session', 'ooi_server_url',
        // Undercover
        'uc_used_tier1_broad', 'uc_used_tier2_medium', 'uc_used_tier3_narrow', 'uc_session',
        // Mafia
        'mafia_players', 'mafia_session',
        // Act-O-Matic
        'aom_used_actions',
        // Shared (rooms, server)
        'pg_server_url', 'pg_session_mafia', 'pg_session_undercover', 'pg_session_ooi'
    ],
    prefixes: ['ooi_', 'uc_', 'mafia_', 'aom_', 'pg_session_', 'meenit-'],
    // Preferences survive a reset on purpose.
    keep: ['pg_theme', 'pg_muted']
};

/**
 * Clears all game data listed in PG_STORAGE_KEYS. Returns the number of keys removed.
 */
function resetAllGameData() {
    const { keys, prefixes, keep } = window.PG_STORAGE_KEYS;
    const remove = new Set(keys);
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && prefixes.some(p => k.startsWith(p))) remove.add(k);
    }
    keep.forEach(k => remove.delete(k));
    remove.forEach(k => { try { localStorage.removeItem(k); } catch (_) { } });
    try { sessionStorage.clear(); } catch (_) { }
    return remove.size;
}

/** querySelector / querySelectorAll shorthands. qsa returns a real array. */
function qs(sel, root) {
    return (root || document).querySelector(sel);
}

function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
}

/**
 * Generates a random alphanumeric ID
 */
function generateId() {
    return Math.random().toString(36).substring(2, 9).toUpperCase();
}

/**
 * Saves game state to localStorage with a prefix
 */
function saveGame(gameKey, state) {
    try {
        localStorage.setItem(`meenit-${gameKey}`, JSON.stringify(state));
    } catch (e) {
        console.error('Error saving game:', e);
    }
}

/**
 * Loads game state from localStorage
 */
function loadGame(gameKey) {
    try {
        const data = localStorage.getItem(`meenit-${gameKey}`);
        return data ? JSON.parse(data) : null;
    } catch (e) {
        console.error('Error loading game:', e);
        return null;
    }
}

/**
 * Creates a DOM element with classes and attributes
 */
function createElement(tag, options = {}) {
    const el = document.createElement(tag);

    if (options.classes) {
        options.classes.forEach(c => {
            if (c) el.classList.add(c);
        });
    }

    if (options.text) el.textContent = options.text;
    if (options.html) el.innerHTML = options.html;

    if (options.attrs) {
        Object.entries(options.attrs).forEach(([key, value]) => {
            el.setAttribute(key, value);
        });
    }

    return el;
}

/**
 * Adds a shake animation to an element
 */
function shakeElement(element) {
    if (!element) return;
    element.classList.add('animate-shake');
    setTimeout(() => {
        element.classList.remove('animate-shake');
    }, 500);
}

/**
 * Returns a random item from an array
 */
function getRandomItem(array) {
    if (!array || array.length === 0) return null;
    return array[Math.floor(Math.random() * array.length)];
}

/**
 * Shows a specific screen by ID and hides others.
 * Legacy helper: prefer `Motion.screen(fromId, toId, { direction })` which animates.
 */
function showScreen(screenId, allScreenIds) {
    allScreenIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('hidden', id !== screenId);
        }
    });
}

/**
 * Mounts a brand SVG (BRAND.md "Mounting a title") into `el`.
 * Inline when fetch works (theme tokens flow into the SVG), <img> fallback otherwise.
 * `opts.rename = ['pg-wordmark-', 'pg-wordmark-splash-']` rewrites ids and classes so a
 * second copy of the same asset can share the page without duplicate clip ids.
 * Resolves to 'inline' | 'img'. The SVG text is fetched once per URL.
 */
const _brandCache = {};
function mountBrand(el, opts) {
    opts = opts || {};
    if (!el) return Promise.resolve('img');
    const src = opts.src || el.dataset.brand;
    if (!_brandCache[src]) {
        _brandCache[src] = (typeof fetch === 'function'
            ? fetch(src).then(r => (r.ok ? r.text() : '')).catch(() => '')
            : Promise.resolve(''));
    }
    return _brandCache[src].then(text => {
        if (text && text.indexOf('<svg') !== -1) {
            if (opts.rename) text = text.split(opts.rename[0]).join(opts.rename[1]);
            el.innerHTML = text;
        }
        if (el.querySelector('svg')) return 'inline';
        el.innerHTML = '';
        const img = document.createElement('img');
        img.src = src;
        img.alt = el.dataset.alt || '';
        img.draggable = false;
        el.appendChild(img);
        return 'img';
    });
}

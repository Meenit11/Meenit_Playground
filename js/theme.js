/* ============================================================
   Meenit's Playground – Theme
   window.Theme: get() -> 'dark'|'light', set(mode), toggle(), mountToggle(container), syncMeta()
   Persisted in localStorage 'pg_theme'. Sets data-theme on <html> and keeps
   meta[name=theme-color] in step: the page's own dark colour (default #12101c), #f6f2ea light.

   A page whose CSS only has a dark palette sets data-theme-lock="dark" on <html>:
   the stored preference is ignored there, set() is a no-op and no theme toggle is mounted.

   Put this inline in <head>, after the theme-color meta and BEFORE the stylesheets:
   <script>(function(){var r=document.documentElement,t=r.getAttribute('data-theme-lock');if(t!=='light'&&t!=='dark'){t='dark';try{t=localStorage.getItem('pg_theme')==='light'?'light':'dark'}catch(e){}}r.setAttribute('data-theme',t);var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute('data-dark',m.getAttribute('content'));if(t==='light')m.setAttribute('content','#f6f2ea')}})()</script>
   ============================================================ */
(function () {
  'use strict';

  const KEY = 'pg_theme';
  const root = document.documentElement;
  const toggles = new Set();
  let idSeq = 0;
  const lockAttr = root.getAttribute('data-theme-lock');
  const LOCK = lockAttr === 'light' || lockAttr === 'dark' ? lockAttr : null;

  function get() {
    if (LOCK) return LOCK;
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  const DARK = '#12101c';
  const LIGHT = '#f6f2ea';

  function metaEl() {
    const meta = document.querySelector('meta[name="theme-color"]');
    // Remember the page's own dark colour once (the inline bootstrap normally does this).
    if (meta && !meta.hasAttribute('data-dark')) {
      const c = meta.getAttribute('content');
      meta.setAttribute('data-dark', c && c.toLowerCase() !== LIGHT ? c : DARK);
    }
    return meta;
  }

  function syncMeta() {
    const meta = metaEl();
    if (!meta) return;
    meta.setAttribute('content', get() === 'light' ? LIGHT : (meta.getAttribute('data-dark') || DARK));
  }

  function set(mode, opts) {
    opts = opts || {};
    if (LOCK) { syncMeta(); return LOCK; }
    mode = mode === 'light' ? 'light' : 'dark';
    const animate = opts.animate !== false && !(window.Motion && window.Motion.reduced);
    if (animate) {
      root.classList.add('theme-switching');
      clearTimeout(set._t);
      set._t = setTimeout(() => root.classList.remove('theme-switching'), 520);
    }
    root.setAttribute('data-theme', mode);
    try { localStorage.setItem(KEY, mode); } catch (_) { }
    toggles.forEach(btn => {
      btn.setAttribute('aria-pressed', mode === 'light' ? 'true' : 'false');
      btn.setAttribute('aria-label', mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    });
    syncMeta();
    window.dispatchEvent(new CustomEvent('pg:theme', { detail: { theme: mode } }));
    return mode;
  }

  function toggle() {
    const next = get() === 'light' ? 'dark' : 'light';
    try { window.SFX && window.SFX.play('tap'); } catch (_) { }
    try { window.Haptic && window.Haptic.light(); } catch (_) { }
    return set(next);
  }

  function mountToggle(container) {
    if (LOCK) return null;
    const host = typeof container === 'string' ? document.querySelector(container) : (container || document.body);
    if (!host) return null;
    const id = 'pg-moon-' + (++idSeq);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pg-fab pg-theme';
    let rays = '';
    for (let i = 0; i < 8; i++) {
      rays += '<line class="ray" x1="12" y1="2.2" x2="12" y2="4.6" transform="rotate(' + (i * 45) + ' 12 12)"/>';
    }
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<defs><mask id="' + id + '"><rect width="24" height="24" fill="#fff"/><circle class="moon-mask" cx="16" cy="8" r="6" fill="#000"/></mask></defs>' +
      '<g class="icon-rot">' +
      '<g class="rays">' + rays + '</g>' +
      '<circle class="sun-core" cx="12" cy="12" r="5" mask="url(#' + id + ')"/>' +
      '</g></svg>';
    btn.addEventListener('click', () => {
      toggle();
      // A little extra kick on the icon itself.
      if (window.Motion && !window.Motion.reduced && btn.animate) {
        btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.86)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
      }
    });
    host.appendChild(btn);
    toggles.add(btn);
    btn.setAttribute('aria-pressed', get() === 'light' ? 'true' : 'false');
    btn.setAttribute('aria-label', get() === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    return btn;
  }

  // Apply the stored theme now in case the inline bootstrap was not included.
  (function boot() {
    let stored = null;
    try { stored = localStorage.getItem(KEY); } catch (_) { }
    const current = root.getAttribute('data-theme');
    const mode = LOCK ? LOCK : stored === 'light' || stored === 'dark' ? stored : (current === 'light' ? 'light' : 'dark');
    if (current !== mode) root.setAttribute('data-theme', mode);
  })();

  document.addEventListener('DOMContentLoaded', () => {
    syncMeta();
    document.querySelectorAll('[data-pg-toggles]').forEach(host => {
      if (!host.querySelector('.pg-theme')) mountToggle(host);
    });
  });

  window.Theme = { get, set, toggle, mountToggle, syncMeta, locked: !!LOCK, colors: { dark: DARK, light: LIGHT } };
})();

/* Arrival half of the home card zoom.
   The home page grows the tapped card to fill the screen in the game's colour,
   stores that colour, then navigates. This script runs in <head> of each game page,
   before first paint, so the page opens on the same full-screen colour and then
   dissolves it while the content settles in. Plain script, no dependencies. */
(function () {
  'use strict';
  var KEY = 'pg_card_zoom';
  var data = null;
  try {
    data = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    sessionStorage.removeItem(KEY);
  } catch (e) { data = null; }
  if (!data || !data.color || Date.now() - (data.t || 0) > 4000) return;
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
  if (reduced) return;

  var root = document.documentElement;
  root.style.setProperty('--pg-zoom-color', data.color);
  root.style.setProperty('--pg-zoom-accent', data.accent || data.color);
  root.classList.add('pg-zoom-in');
  if (data.title) {
    root.style.setProperty('--pg-zoom-title', JSON.stringify(String(data.title)));
    root.style.setProperty('--pg-zoom-font', (data.fontPx || 48) + 'px');
    root.style.setProperty('--pg-zoom-top', (data.top || 64) + 'px');
    root.style.setProperty('--pg-zoom-weight', data.weight || '800');
  }

  var css =
    'html.pg-zoom-in{background:var(--pg-zoom-color)}' +
    'html.pg-zoom-in::after{content:"";position:fixed;inset:0;z-index:2147483000;pointer-events:none;' +
    'background:radial-gradient(120% 90% at 50% 40%,color-mix(in srgb,var(--pg-zoom-accent) 30%,transparent) 0%,transparent 70%),var(--pg-zoom-color);' +
    'animation:pgZoomVeil .55s cubic-bezier(.4,0,.2,1) .12s forwards}' +
    'html.pg-zoom-in body{animation:pgZoomBody .7s cubic-bezier(.22,1,.36,1) .08s backwards}' +
    '@keyframes pgZoomVeil{to{opacity:0;visibility:hidden}}' +
    '@keyframes pgZoomBody{from{opacity:0;transform:scale(1.04)}to{opacity:1;transform:none}}' +
    'html.pg-zoom-in::before{content:var(--pg-zoom-title,"");position:fixed;left:0;right:0;top:var(--pg-zoom-top);' +
    'z-index:2147483001;text-align:center;font:var(--pg-zoom-weight) var(--pg-zoom-font)/1.1 Syne,system-ui,sans-serif;' +
    'letter-spacing:-0.02em;color:var(--pg-zoom-accent);text-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:none;' +
    'animation:pgZoomTitle .6s cubic-bezier(.4,0,.2,1) .15s forwards}' +
    '@keyframes pgZoomTitle{to{opacity:0;transform:translateY(-14px) scale(.9)}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  setTimeout(function () { root.classList.remove('pg-zoom-in'); }, 1100);
})();

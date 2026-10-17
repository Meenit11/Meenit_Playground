/* ============================================================
   Meenit's Playground – Motion
   window.Motion: screen, stagger, press, flipReveal, characterEnter,
   eliminate, dayNight, timerRing, winner, toast, pulse.
   CSS + Web Animations API only. Transform and opacity everywhere that
   runs every frame. Honours prefers-reduced-motion by shortening to fades.
   Load after utils.js. Games call it guarded: window.Motion?.screen(...)
   ============================================================ */
(function () {
  'use strict';

  // ---------- Shared curves and helpers ----------
  const CURVE = {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    pop: 'cubic-bezier(0.18, 1.4, 0.4, 1)',
    settle: 'cubic-bezier(0.22, 1, 0.36, 1)'
  };

  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(mq && mq.matches);
  const supportsWAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

  function $(x, root) {
    if (!x) return null;
    if (typeof x === 'string') {
      return document.getElementById(x) || (root || document).querySelector(x);
    }
    return x;
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /** element.animate wrapper that always resolves and never throws. */
  function run(el, keyframes, options) {
    if (!el || !supportsWAAPI) {
      return { finished: Promise.resolve(), cancel() { }, finish() { } };
    }
    try {
      const anim = el.animate(keyframes, options);
      anim.finished.catch(() => { });
      return anim;
    } catch (_) {
      return { finished: Promise.resolve(), cancel() { }, finish() { } };
    }
  }

  function done(anim) {
    return anim && anim.finished ? anim.finished.catch(() => { }) : Promise.resolve();
  }

  function ensurePositioned(el) {
    if (el && getComputedStyle(el).position === 'static') el.style.position = 'relative';
  }

  function sfx(name) {
    try { window.SFX && window.SFX.play(name); } catch (_) { }
  }

  function haptic(kind) {
    try { window.Haptic && window.Haptic[kind] && window.Haptic[kind](); } catch (_) { }
  }

  function primaryColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#c9a86c';
  }

  // ---------- 1. Screen transitions ----------
  // Outgoing screen is lifted out of flow (absolute) and slides away while the incoming
  // one takes its place in flow. No blank frame, no layout jump, scroll reset to top.
  let screenBusy = null;

  function screen(fromId, toId, opts) {
    opts = opts || {};
    const direction = opts.direction || 'forward';
    const to = $(toId);
    if (!to) return Promise.resolve();
    let from = fromId ? $(fromId) : null;
    if (!from) {
      from = Array.from(document.querySelectorAll('.screen')).find(s => s !== to && !s.classList.contains('hidden')) || null;
    }
    if (from === to) {
      to.classList.remove('hidden');
      return Promise.resolve();
    }

    // Finish any transition in flight instantly, then start this one.
    if (screenBusy) screenBusy.finishNow();

    const r = reduced();
    const dx = direction === 'back' ? -1 : direction === 'none' ? 0 : 1;
    const scrollY = window.scrollY || 0;
    const parent = to.parentElement;
    if (parent) ensurePositioned(parent);

    // Hide every other screen, prepare the pair.
    document.querySelectorAll('.screen').forEach(s => {
      if (s !== to && s !== from) s.classList.add('hidden');
    });

    const hasFrom = from && !from.classList.contains('hidden');
    if (hasFrom) from.classList.add('is-leaving');
    to.classList.remove('hidden');
    to.classList.add('is-entering');
    window.scrollTo(0, 0);

    const outAnim = hasFrom
      ? run(from, [
        { opacity: 1, transform: `translate(0, ${-scrollY}px)` },
        { opacity: 0, transform: `translate(${-dx * 40}px, ${-scrollY}px) scale(${dx ? 1 : 0.98})` }
      ], { duration: r ? 120 : 230, easing: CURVE.exit, fill: 'forwards' })
      : null;

    const inAnim = run(to, [
      { opacity: 0, transform: dx ? `translateX(${dx * 48}px)` : 'scale(0.985)' },
      { opacity: 1, transform: 'none' }
    ], { duration: r ? 160 : 380, delay: r ? 0 : 60, easing: CURVE.standard, fill: 'backwards' });

    let settled = false;
    function settle() {
      if (settled) return;
      settled = true;
      if (hasFrom) {
        from.classList.add('hidden');
        from.classList.remove('is-leaving');
      }
      to.classList.remove('is-entering');
      if (outAnim) outAnim.cancel();
      if (inAnim && inAnim.cancel) inAnim.cancel();
      screenBusy = null;
    }

    screenBusy = { finishNow: settle };
    const p = Promise.all([done(outAnim), done(inAnim)]).then(settle);

    // Auto-stagger any list the incoming screen marked with data-stagger.
    to.querySelectorAll('[data-stagger]').forEach(list => {
      stagger(list, { delay: Number(list.getAttribute('data-stagger')) || undefined, selector: list.getAttribute('data-stagger-selector') || undefined });
    });
    return p;
  }

  // ---------- 2. Staggered list entrance ----------
  function stagger(container, opts) {
    opts = opts || {};
    const c = $(container);
    if (!c) return Promise.resolve();
    const items = opts.selector ? Array.from(c.querySelectorAll(opts.selector)) : Array.from(c.children);
    if (!items.length) return Promise.resolve();
    const r = reduced();
    const n = items.length;
    const step = Math.min(opts.delay == null ? 55 : opts.delay, 480 / n);
    const LIMIT = 18; // past this the items are off screen anyway
    const from = opts.from || 'up';
    const start = from === 'left' ? 'translateX(-18px)' : from === 'right' ? 'translateX(18px)' : from === 'scale' ? 'scale(0.9)' : 'translateY(16px) scale(0.98)';
    const promises = items.map((el, i) => {
      if (i >= LIMIT) return Promise.resolve();
      const a = run(el, [
        { opacity: 0, transform: r ? 'none' : start },
        { opacity: 1, transform: 'none' }
      ], { duration: r ? 150 : 380, delay: r ? 0 : i * step, easing: CURVE.pop, fill: 'backwards' });
      return done(a);
    });
    return Promise.all(promises);
  }

  // ---------- 3. Press feedback ----------
  // Delegated: anything matching PRESS_SEL gets a spring press without wiring.
  // Motion.press(el) opts an arbitrary element in.
  const PRESS_SEL = '.btn, .game-card, .press, [data-press], .pg-fab, .list-item[role="button"], .choice, .option';
  let pressed = null;

  function pressDown(el) {
    if (!el || el.disabled || el.classList.contains('no-press')) return;
    if (pressed && pressed.el !== el) pressRelease();
    const r = reduced();
    const down = run(el, [
      { transform: 'scale(1)' },
      { transform: r ? 'scale(0.99)' : 'scale(0.95)' }
    ], { duration: 110, easing: CURVE.standard, fill: 'forwards' });
    pressed = { el, down };
    sfx('tap');
    haptic('light');
  }

  function pressRelease() {
    if (!pressed) return;
    const { el, down } = pressed;
    pressed = null;
    const r = reduced();
    const up = run(el, [
      { transform: r ? 'scale(0.99)' : 'scale(0.95)' },
      { transform: 'scale(1)' }
    ], { duration: r ? 100 : 300, easing: CURVE.spring });
    down.cancel();
    done(up);
  }

  function press(el) {
    const node = $(el);
    if (!node) return;
    if (node.setAttribute) node.setAttribute('data-press', '');
  }

  document.addEventListener('pointerdown', e => {
    if (e.button && e.button !== 0) return;
    const el = e.target && e.target.closest ? e.target.closest(PRESS_SEL) : null;
    if (el) pressDown(el);
  }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(t => window.addEventListener(t, pressRelease, { passive: true }));
  window.addEventListener('blur', pressRelease);

  // ---------- 4. Hold-to-reveal flip card ----------
  function flipReveal(cardEl, opts) {
    opts = opts || {};
    const card = $(cardEl);
    if (!card) return null;
    if (card._pgFlip) {
      card._pgFlip.update(opts);
      card._pgFlip.reset(true);
      return card._pgFlip;
    }
    card.classList.add('flip-card');

    let inner = card.querySelector(':scope > .flip-inner');
    let front, back;
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'flip-inner';
      back = document.createElement('div');
      back.className = 'flip-face flip-back';
      while (card.firstChild) back.appendChild(card.firstChild);
      front = document.createElement('div');
      front.className = 'flip-face flip-front';
      inner.appendChild(front);
      inner.appendChild(back);
      card.appendChild(inner);
    } else {
      front = inner.querySelector('.flip-front');
      back = inner.querySelector('.flip-back');
    }

    const R = 40;
    const C = 2 * Math.PI * R;
    front.innerHTML =
      '<svg class="flip-ring" viewBox="0 0 92 92" aria-hidden="true">' +
      '<circle class="flip-ring-track" cx="46" cy="46" r="' + R + '"/>' +
      '<circle class="flip-ring-fill" cx="46" cy="46" r="' + R + '" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '"/>' +
      '</svg><div class="flip-label"></div>';
    const ring = front.querySelector('.flip-ring-fill');
    const label = front.querySelector('.flip-label');

    const state = { holdMs: 900, label: 'Hold to reveal', onRevealed: null, revealed: false, timer: null, startedAt: 0, pointerId: null };

    function update(o) {
      if (o.holdMs) state.holdMs = o.holdMs;
      if (o.label) state.label = o.label;
      if (o.onRevealed) state.onRevealed = o.onRevealed;
      label.textContent = state.label;
    }
    update(opts);

    let scaleAnim = null;
    function setRing(progress) {
      ring.style.strokeDashoffset = String(C * (1 - progress));
    }
    let raf = 0;
    function tickRing() {
      const p = Math.min(1, (performance.now() - state.startedAt) / state.holdMs);
      setRing(p);
      if (p < 1 && state.timer) raf = requestAnimationFrame(tickRing);
    }

    function start(e) {
      if (state.revealed || state.timer) return;
      if (e.button && e.button !== 0) return;
      state.pointerId = e.pointerId;
      try { front.setPointerCapture(e.pointerId); } catch (_) { }
      state.startedAt = performance.now();
      scaleAnim = run(card, [{ transform: 'scale(1)' }, { transform: reduced() ? 'scale(1)' : 'scale(0.97)' }], { duration: 160, easing: CURVE.standard, fill: 'forwards' });
      haptic('light');
      sfx('tap');
      state.timer = setTimeout(complete, state.holdMs);
      raf = requestAnimationFrame(tickRing);
    }

    function cancel() {
      if (!state.timer) return;
      clearTimeout(state.timer);
      state.timer = null;
      cancelAnimationFrame(raf);
      // Unwind the ring
      const current = parseFloat(ring.style.strokeDashoffset) || C;
      run(ring, [{ strokeDashoffset: current }, { strokeDashoffset: C }], { duration: 220, easing: CURVE.exit }).finished.then(() => setRing(0)).catch(() => setRing(0));
      if (scaleAnim) { run(card, [{ transform: 'scale(0.97)' }, { transform: 'scale(1)' }], { duration: 260, easing: CURVE.spring }); scaleAnim.cancel(); scaleAnim = null; }
    }

    async function complete() {
      state.timer = null;
      cancelAnimationFrame(raf);
      setRing(1);
      state.revealed = true;
      card.classList.add('is-revealed');
      haptic('heavy');
      sfx('reveal');
      if (scaleAnim) { scaleAnim.cancel(); scaleAnim = null; }
      const r = reduced();
      const flip = r
        ? run(inner, [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration: 300, easing: 'ease' })
        : run(inner, [
          { transform: 'rotateY(0deg) scale(1)' },
          { transform: 'rotateY(90deg) scale(1.06)', offset: 0.45 },
          { transform: 'rotateY(180deg) scale(1)' }
        ], { duration: 680, easing: CURVE.standard, fill: 'forwards' });
      if (r) {
        setTimeout(() => { inner.style.transform = 'rotateY(180deg)'; }, 150);
      }
      await done(flip);
      if (!r) { inner.style.transform = 'rotateY(180deg)'; flip.cancel(); }
      if (typeof state.onRevealed === 'function') state.onRevealed(card);
      card.dispatchEvent(new CustomEvent('pg:revealed', { bubbles: true }));
    }

    function reset(instant) {
      cancel();
      state.revealed = false;
      card.classList.remove('is-revealed');
      setRing(0);
      if (inner.style.transform) {
        if (instant || reduced()) {
          inner.style.transform = '';
        } else {
          const back = run(inner, [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { duration: 420, easing: CURVE.standard, fill: 'forwards' });
          inner.style.transform = '';
          done(back).then(() => back.cancel());
        }
      }
    }

    function destroy() {
      cancel();
      front.removeEventListener('pointerdown', start);
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => front.removeEventListener(t, cancel));
      card.removeEventListener('contextmenu', prevent);
      delete card._pgFlip;
    }

    function prevent(e) { e.preventDefault(); }

    front.addEventListener('pointerdown', start);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => front.addEventListener(t, cancel));
    card.addEventListener('contextmenu', prevent);
    // Keyboard: Enter/Space hold is awkward, so a press reveals directly.
    front.setAttribute('tabindex', '0');
    front.setAttribute('role', 'button');
    front.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !state.revealed) { e.preventDefault(); complete(); }
    });

    const api = {
      el: card,
      update,
      reset,
      destroy,
      reveal: complete,
      get revealed() { return state.revealed; }
    };
    card._pgFlip = api;
    return api;
  }

  // ---------- 5. Character entrance with glow ----------
  function characterEnter(imgEl, opts) {
    opts = opts || {};
    const img = $(imgEl);
    if (!img) return Promise.resolve();
    const color = opts.glowColor || primaryColor();
    const parent = img.parentElement;
    if (!parent) return Promise.resolve();
    ensurePositioned(parent);

    let glow = parent.querySelector(':scope > .char-glow[data-for]');
    if (!glow) {
      glow = document.createElement('span');
      glow.className = 'char-glow';
      glow.setAttribute('data-for', '');
      glow.style.inset = 'auto';
      parent.insertBefore(glow, img);
    }
    if (glow._pgLoop) { glow._pgLoop.cancel(); glow._pgLoop = null; }
    glow.style.setProperty('--glow', color);
    img.style.position = 'relative';
    img.style.zIndex = '1';

    function placeGlow() {
      const w = img.offsetWidth, h = img.offsetHeight;
      const size = Math.max(w, h) * 1.4;
      glow.style.width = size + 'px';
      glow.style.height = size + 'px';
      glow.style.left = (img.offsetLeft + w / 2 - size / 2) + 'px';
      glow.style.top = (img.offsetTop + h / 2 - size / 2) + 'px';
    }

    const r = reduced();
    // Wait for the image box, but never hang on a stalled image.
    const ready = (img.complete || !img.src) ? Promise.resolve() : Promise.race([
      new Promise(res => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); }),
      delay(1200)
    ]);

    // Start the image entrance right away, the glow once we know its box.
    const enter = run(img, [
      { opacity: 0, transform: r ? 'none' : 'translateY(36px) scale(0.72)' },
      { opacity: 1, transform: 'none' }
    ], { duration: r ? 180 : 640, easing: CURVE.pop, fill: 'backwards' });

    return ready.then(() => {
      placeGlow();
      const burst = run(glow, [
        { opacity: 0, transform: 'scale(0.5)' },
        { opacity: r ? 0.5 : 0.95, transform: 'scale(1.18)', offset: 0.55 },
        { opacity: 0.55, transform: 'scale(1)' }
      ], { duration: r ? 240 : 900, easing: CURVE.standard, fill: 'forwards' });
      return Promise.all([done(enter), done(burst)]).then(() => {
        if (r) return;
        glow._pgLoop = run(glow, [
          { opacity: 0.55, transform: 'scale(1)' },
          { opacity: 0.72, transform: 'scale(1.08)' },
          { opacity: 0.55, transform: 'scale(1)' }
        ], { duration: 3200, iterations: Infinity, easing: 'ease-in-out' });
        burst.cancel();
      });
    });
  }

  // ---------- 6. Elimination ----------
  function eliminate(el, opts) {
    opts = opts || {};
    const node = $(el);
    if (!node) return Promise.resolve();
    ensurePositioned(node);
    const r = reduced();
    const strike = document.createElement('span');
    strike.className = 'pg-strike';
    node.appendChild(strike);
    sfx('elim');
    haptic('heavy');

    if (r) {
      strike.style.transform = 'scaleX(1)';
      node.classList.add('is-eliminated');
      return done(run(node, [{ opacity: 1 }, { opacity: 0.45 }], { duration: 200 }));
    }

    const seq = (async () => {
      await done(run(strike, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 220, easing: CURVE.standard, fill: 'forwards' }));
      strike.style.transform = 'scaleX(1)';
      if (opts.shake) {
        const target = node.closest('.screen') || node.closest('.game-container') || node.closest('.container') || document.body;
        run(target, [
          { transform: 'translate(0,0)' }, { transform: 'translate(-7px, 2px)' }, { transform: 'translate(6px, -2px)' },
          { transform: 'translate(-5px, 1px)' }, { transform: 'translate(4px, -1px)' }, { transform: 'translate(-2px, 0)' }, { transform: 'translate(0,0)' }
        ], { duration: 380, easing: 'linear' });
      }
      await done(run(node, [
        { transform: 'translateY(0) rotate(0deg)', opacity: 1, filter: 'grayscale(0)' },
        { transform: 'translateY(-5px) rotate(0.6deg)', opacity: 1, filter: 'grayscale(0.2)', offset: 0.18 },
        { transform: 'translateY(12px) rotate(-2.4deg)', opacity: 0.4, filter: 'grayscale(1)', offset: 0.7 },
        { transform: 'translateY(0) rotate(0deg)', opacity: 0.45, filter: 'grayscale(1)' }
      ], { duration: 620, easing: CURVE.settle, fill: 'forwards' })).then(() => {
        node.classList.add('is-eliminated');
      });
      node.getAnimations && node.getAnimations().forEach(a => a.cancel());
    })();
    return seq;
  }

  // ---------- 7. Day / night sky ----------
  const SKY = {
    night: {
      bg: 'linear-gradient(180deg, #040611 0%, #0a1130 50%, #1b2047 100%)',
      orb: 'is-moon', stars: true, label: 'Night falls', wash: 'rgba(28, 38, 96, 0.4)', glow: '#7b8ce6', sound: 'night', theme: '#07091a'
    },
    morning: {
      bg: 'linear-gradient(180deg, #2a1b4b 0%, #b84f3f 55%, #ffb46a 100%)',
      orb: 'is-sun', stars: false, label: 'Morning', wash: 'rgba(255, 150, 80, 0.2)', glow: '#ff9a3c', sound: 'day', theme: '#2a1b4b'
    },
    day: {
      bg: 'linear-gradient(180deg, #6fb9ff 0%, #bfe3ff 60%, #fff3d2 100%)',
      orb: 'is-sun', stars: false, label: 'Day', wash: 'rgba(120, 190, 255, 0.18)', glow: '#ffd166', sound: 'day', theme: '#6fb9ff'
    }
  };
  let sky = null;

  function buildSky() {
    sky = document.createElement('div');
    sky.className = 'pg-sky';
    sky.setAttribute('aria-hidden', 'true');
    const bg = document.createElement('div');
    bg.className = 'pg-sky-bg';
    sky.appendChild(bg);
    const stars = [];
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('span');
      s.className = 'pg-sky-star';
      s.style.left = (4 + Math.random() * 92) + '%';
      s.style.top = (3 + Math.random() * 52) + '%';
      const sz = 2 + Math.round(Math.random() * 2);
      s.style.width = sz + 'px';
      s.style.height = sz + 'px';
      sky.appendChild(s);
      stars.push(s);
    }
    const orb = document.createElement('div');
    orb.className = 'pg-sky-orb';
    sky.appendChild(orb);
    const label = document.createElement('div');
    label.className = 'pg-sky-label';
    sky.appendChild(label);
    document.body.appendChild(sky);
    sky._parts = { bg, stars, orb, label };
    if (!document.querySelector('.pg-ambient')) {
      const amb = document.createElement('div');
      amb.className = 'pg-ambient';
      amb.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(amb, document.body.firstChild);
    }
  }

  function applySkyVars(mode) {
    const p = SKY[mode];
    const root = document.documentElement;
    root.style.setProperty('--sky-wash', p.wash);
    root.style.setProperty('--sky-glow', p.glow);
    root.setAttribute('data-sky', mode);
    root.dispatchEvent(new CustomEvent('pg:sky', { detail: { mode } }));
  }

  function dayNight(mode, opts) {
    opts = opts || {};
    const p = SKY[mode] || SKY.night;
    mode = SKY[mode] ? mode : 'night';
    if (!sky) buildSky();
    const { bg, stars, orb, label } = sky._parts;
    const r = reduced();
    sky.getAnimations && sky.getAnimations({ subtree: true }).forEach(a => a.cancel());

    bg.style.background = p.bg;
    orb.className = 'pg-sky-orb ' + p.orb;
    label.textContent = opts.label || p.label;
    sfx(p.sound);
    haptic('light');

    if (r) {
      applySkyVars(mode);
      const fade = run(sky, [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 700, easing: 'ease' });
      label.style.opacity = '1';
      orb.style.opacity = '1';
      done(fade).then(() => { label.style.opacity = ''; orb.style.opacity = ''; });
      setTimeout(() => { if (typeof opts.onCovered === 'function') opts.onCovered(); }, 280);
      return delay(280);
    }

    const hold = opts.hold == null ? 420 : opts.hold;
    const COVER = 1100;
    const total = COVER + hold + 700;

    run(sky, [
      { opacity: 0 }, { opacity: 1, offset: 320 / total }, { opacity: 1, offset: (COVER + hold) / total }, { opacity: 0 }
    ], { duration: total, easing: 'linear', fill: 'forwards' });

    // Orb: rises from below with a slight overshoot, drifts up during the dissolve.
    const orbFrom = p.orb === 'is-moon' ? 'translate(40px, 220px) scale(0.5)' : 'translate(0, 260px) scale(0.55)';
    run(orb, [
      { opacity: 0, transform: orbFrom },
      { opacity: 1, transform: 'translate(0, -8px) scale(1.04)', offset: 0.5 },
      { opacity: 1, transform: 'translate(0, 0) scale(1)', offset: 0.72 },
      { opacity: 1, transform: 'translate(0, -24px) scale(1)' }
    ], { duration: total, easing: CURVE.standard, fill: 'forwards' });

    // Stars twinkle in (night) or fade (morning/day).
    stars.forEach((s, i) => {
      if (p.stars) {
        run(s, [
          { opacity: 0, transform: 'scale(0.3)' },
          { opacity: 1, transform: 'scale(1.3)', offset: 0.3 },
          { opacity: 0.55 + (i % 3) * 0.15, transform: 'scale(1)', offset: 0.5 },
          { opacity: 1, transform: 'scale(1.2)', offset: 0.75 },
          { opacity: 0.6, transform: 'scale(1)' }
        ], { duration: total, delay: (i * 37) % 420, easing: 'ease-in-out', fill: 'forwards' });
      } else {
        run(s, [{ opacity: 0 }, { opacity: 0 }], { duration: total, fill: 'forwards' });
      }
    });

    run(label, [
      { opacity: 0, transform: 'translateY(14px)' },
      { opacity: 0, transform: 'translateY(14px)', offset: 0.28 },
      { opacity: 1, transform: 'translateY(0)', offset: 0.5 },
      { opacity: 1, transform: 'translateY(0)', offset: 0.7 },
      { opacity: 0, transform: 'translateY(-10px)' }
    ], { duration: total, easing: CURVE.standard, fill: 'forwards' });

    // The theme colour of the browser chrome follows the sky.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', p.theme);

    setTimeout(() => {
      applySkyVars(mode);
      if (typeof opts.onCovered === 'function') opts.onCovered();
    }, COVER);
    setTimeout(() => {
      sky.getAnimations && sky.getAnimations({ subtree: true }).forEach(a => a.cancel());
      // Scene dissolved: browser chrome goes back to the page theme.
      try { window.Theme && window.Theme.syncMeta && window.Theme.syncMeta(); } catch (_) { }
    }, total + 50);
    return delay(COVER);
  }

  // ---------- 8. Countdown ring ----------
  function timerRing(el, opts) {
    opts = opts || {};
    const node = $(el);
    if (!node) return { stop() { }, remaining: 0 };
    if (node._pgTimer) node._pgTimer.stop(true);
    const seconds = Math.max(1, Number(opts.seconds) || 10);
    const R = 52, C = 2 * Math.PI * R;
    node.classList.add('timer-ring');
    node.classList.remove('is-urgent');
    node.innerHTML =
      '<svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<circle class="timer-track" cx="60" cy="60" r="' + R + '"/>' +
      '<circle class="timer-fill" cx="60" cy="60" r="' + R + '" stroke-dasharray="' + C + '" stroke-dashoffset="0"/>' +
      '</svg><div class="timer-num">' + seconds + '</div>';
    const fill = node.querySelector('.timer-fill');
    const num = node.querySelector('.timer-num');
    const r = reduced();
    const total = seconds * 1000;
    const start = performance.now();
    let last = seconds;
    let raf = 0;
    let stopped = false;

    function popNumber(big) {
      run(num, [
        { transform: big ? 'scale(1.35)' : 'scale(1.12)' },
        { transform: 'scale(1)' }
      ], { duration: r ? 120 : 320, easing: CURVE.spring });
    }

    function frame(now) {
      if (stopped) return;
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / total);
      fill.style.strokeDashoffset = String(C * progress);
      const remaining = Math.max(0, Math.ceil((total - elapsed) / 1000));
      if (remaining !== last) {
        last = remaining;
        num.textContent = String(remaining);
        if (remaining > 0) {
          const urgent = remaining <= 3;
          if (urgent) {
            node.classList.add('is-urgent');
            sfx('urgent');
            haptic('light');
            if (!r) run(node, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 360, easing: CURVE.standard });
          } else {
            sfx('tick');
          }
          popNumber(urgent);
          if (typeof opts.onTick === 'function') opts.onTick(remaining);
        }
      }
      if (progress >= 1) {
        stopped = true;
        node._pgTimer = null;
        num.textContent = '0';
        node.classList.add('is-urgent');
        if (!r) run(node, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 420, easing: CURVE.spring });
        haptic('heavy');
        if (typeof opts.onDone === 'function') opts.onDone();
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    const api = {
      el: node,
      get remaining() { return last; },
      stop(silent) {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(raf);
        node._pgTimer = null;
        if (!silent) node.classList.remove('is-urgent');
      }
    };
    node._pgTimer = api;
    return api;
  }

  // ---------- 9. Winner: podium rise + confetti ----------
  function confettiBurst(x, y, colors, count) {
    const layer = document.createElement('div');
    layer.className = 'pg-confetti';
    document.body.appendChild(layer);
    const n = Math.min(count || 36, 44);
    const anims = [];
    const G = 1500; // px/s^2
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.style.background = colors[i % colors.length];
      const angle = (-90 + (Math.random() - 0.5) * 150) * Math.PI / 180;
      const speed = 380 + Math.random() * 420;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const T = 1.5 + Math.random() * 0.6;
      const spin = (Math.random() - 0.5) * 1080;
      const tilt = Math.random() * 360;
      const frames = [];
      const STEPS = 7;
      for (let k = 0; k <= STEPS; k++) {
        const t = (k / STEPS) * T;
        const px = x + vx * t;
        const py = y + vy * t + 0.5 * G * t * t;
        frames.push({
          transform: `translate(${px.toFixed(0)}px, ${py.toFixed(0)}px) rotateZ(${(spin * t / T).toFixed(0)}deg) rotateX(${(tilt + 540 * t / T).toFixed(0)}deg)`,
          opacity: k >= STEPS - 1 ? 0 : 1,
          offset: k / STEPS
        });
      }
      if (Math.random() < 0.35) { s.style.width = '7px'; s.style.height = '7px'; s.style.borderRadius = '50%'; }
      layer.appendChild(s);
      anims.push(done(run(s, frames, { duration: T * 1000, easing: 'linear', fill: 'forwards' })));
    }
    return Promise.all(anims).then(() => layer.remove());
  }

  function winner(container, opts) {
    opts = opts || {};
    const el = $(container);
    const color = opts.color || primaryColor();
    const r = reduced();
    sfx('win');
    haptic('heavy');
    const promises = [];
    let cx = window.innerWidth / 2, cy = window.innerHeight * 0.42;

    if (el) {
      el.classList.add('winner-stage');
      el.style.setProperty('--glow', color);
      let halo = el.querySelector(':scope > .winner-halo');
      if (!halo) {
        halo = document.createElement('span');
        halo.className = 'winner-halo';
        el.insertBefore(halo, el.firstChild);
      }
      if (halo._pgLoop) halo._pgLoop.cancel();
      promises.push(done(run(el, [
        { opacity: 0, transform: r ? 'none' : 'translateY(64px) scale(0.88)' },
        { opacity: 1, transform: r ? 'none' : 'translateY(-10px) scale(1.03)', offset: 0.68 },
        { opacity: 1, transform: 'none' }
      ], { duration: r ? 200 : 760, easing: CURVE.standard, fill: 'backwards' })));
      const burst = run(halo, [
        { opacity: 0, transform: 'scale(0.6)' },
        { opacity: r ? 0.4 : 0.8, transform: 'scale(1.25)', offset: 0.6 },
        { opacity: 0.45, transform: 'scale(1)' }
      ], { duration: r ? 240 : 1000, delay: r ? 0 : 200, easing: CURVE.standard, fill: 'forwards' });
      done(burst).then(() => {
        if (r) return;
        halo._pgLoop = run(halo, [
          { opacity: 0.45, transform: 'scale(1)' }, { opacity: 0.6, transform: 'scale(1.06)' }, { opacity: 0.45, transform: 'scale(1)' }
        ], { duration: 2800, iterations: Infinity, easing: 'ease-in-out' });
        burst.cancel();
      });
      const rect = el.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = Math.max(40, rect.top + Math.min(rect.height * 0.35, 120));
    }
    if (opts.x != null) cx = opts.x;
    if (opts.y != null) cy = opts.y;

    if (!r) {
      const colors = [color, '#ffffff', '#ffd166', '#6ad4ff', '#ff7ab6', color];
      promises.push(delay(el ? 260 : 0).then(() => confettiBurst(cx, cy, colors, opts.count || 36)));
      if (opts.count !== 0) {
        promises.push(delay(900).then(() => confettiBurst(cx + (Math.random() - 0.5) * 120, cy, colors, 18)));
      }
    }
    return Promise.all(promises);
  }

  // ---------- 10. Toast ----------
  let toastBox = null;

  function toast(text, opts) {
    opts = opts || {};
    const kind = opts.kind || 'info';
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'pg-toasts';
      toastBox.setAttribute('role', 'status');
      toastBox.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastBox);
    }
    while (toastBox.children.length >= 3) toastBox.firstChild.remove();

    const el = document.createElement('div');
    el.className = 'pg-toast is-' + kind;
    el.innerHTML = '<span class="pg-toast-dot"></span><span class="pg-toast-text"></span>';
    el.querySelector('.pg-toast-text').textContent = String(text == null ? '' : text);
    toastBox.appendChild(el);

    const r = reduced();
    run(el, [
      { opacity: 0, transform: r ? 'none' : 'translateY(-18px) scale(0.94)' },
      { opacity: 1, transform: 'none' }
    ], { duration: r ? 150 : 380, easing: CURVE.pop, fill: 'backwards' });
    if (kind === 'error') { sfx('error'); haptic('heavy'); }
    else if (kind === 'success') { sfx('tap'); }

    let gone = false;
    function dismiss(dir) {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      const out = dir
        ? [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dir * 140}px)` }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: r ? 'none' : 'translateY(-12px) scale(0.96)' }];
      done(run(el, out, { duration: r ? 120 : 220, easing: CURVE.exit, fill: 'forwards' })).then(() => el.remove());
    }
    const duration = opts.duration || (kind === 'error' ? 3600 : 2400);
    const timer = setTimeout(dismiss, duration);

    let startX = null;
    el.addEventListener('pointerdown', e => { startX = e.clientX; }, { passive: true });
    el.addEventListener('pointerup', e => {
      if (startX == null) return;
      const dx = e.clientX - startX;
      startX = null;
      dismiss(Math.abs(dx) > 40 ? Math.sign(dx) : 0);
    }, { passive: true });

    el.dismiss = dismiss;
    return el;
  }

  // ---------- 11. Pulse nudge ----------
  function pulse(el) {
    const node = $(el);
    if (!node) return Promise.resolve();
    const r = reduced();
    if (r) return done(run(node, [{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], { duration: 300 }));
    ensurePositioned(node);
    const ring = document.createElement('span');
    ring.className = 'pg-pulse-ring';
    node.appendChild(ring);
    const a = run(node, [
      { transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: 0.25 }, { transform: 'scale(1)', offset: 0.5 },
      { transform: 'scale(1.04)', offset: 0.72 }, { transform: 'scale(1)' }
    ], { duration: 720, easing: CURVE.standard });
    const b = run(ring, [
      { opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.16)' }
    ], { duration: 720, easing: CURVE.standard, fill: 'forwards' });
    return Promise.all([done(a), done(b)]).then(() => ring.remove());
  }

  // ---------- Boot ----------
  // alert() becomes a toast: nothing in a party game should block the thread.
  // Safety net only: no page should still use the native dialog.
  window.alert = function (msg) { toast(msg, { kind: 'warn' }); };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.screen:not(.hidden) [data-stagger], [data-stagger-now]').forEach(list => {
      stagger(list, { delay: Number(list.getAttribute('data-stagger')) || undefined });
    });
  });

  window.Motion = {
    screen, stagger, press, flipReveal, characterEnter, eliminate, dayNight, timerRing, winner, toast, pulse,
    get reduced() { return reduced(); },
    curves: CURVE
  };
})();

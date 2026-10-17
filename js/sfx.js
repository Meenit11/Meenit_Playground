/* ============================================================
   Meenit's Playground – SFX and Haptic
   window.SFX: synthesised Web Audio sounds, no audio files.
     SFX.play('tap'|'tick'|'urgent'|'reveal'|'elim'|'night'|'day'|'win'|'error')
     SFX.muted (boolean), SFX.toggle() -> muted, SFX.mountToggle(container) -> button
   Unlocked on the first touch. Mute persisted in localStorage 'pg_muted'.
   window.Haptic: Haptic.light(), Haptic.heavy(), navigator.vibrate guarded.
   ============================================================ */
(function () {
  'use strict';

  const KEY = 'pg_muted';
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (_) { }
  const toggles = new Set();

  function ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.4;
        master.connect(ctx.destination);
      } catch (_) { ctx = null; return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => { });
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (!c) return;
    try {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch (_) { }
  }
  ['pointerdown', 'touchend', 'keydown'].forEach(t => window.addEventListener(t, unlock, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx) ensure(); });

  // ---------- Building blocks ----------
  function tone(o) {
    const c = ctx;
    const t0 = c.currentTime + (o.at || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    const attack = o.attack || 0.004;
    const peak = o.gain == null ? 0.2 : o.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    if (o.sustain) g.gain.setValueAtTime(peak, t0 + o.dur - (o.release || 0.1));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let node = osc;
    if (o.filter) {
      const f = c.createBiquadFilter();
      f.type = o.filter.type || 'lowpass';
      f.frequency.value = o.filter.freq || 1200;
      f.Q.value = o.filter.q || 0.7;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  function noise(o) {
    const c = ctx;
    if (!noiseBuffer) {
      noiseBuffer = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + (o.at || 0);
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    const f = c.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 800, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    f.Q.value = o.q || 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain == null ? 0.15 : o.gain, t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + o.dur + 0.05);
  }

  // ---------- Recipes ----------
  const SOUNDS = {
    tap() {
      tone({ type: 'sine', freq: 1500, to: 900, dur: 0.05, gain: 0.18 });
    },
    tick() {
      tone({ type: 'square', freq: 2300, dur: 0.018, gain: 0.07, filter: { type: 'highpass', freq: 1200 } });
    },
    urgent() {
      tone({ type: 'sine', freq: 880, dur: 0.07, gain: 0.26 });
      tone({ type: 'sine', freq: 1175, dur: 0.09, gain: 0.22, at: 0.08 });
      tone({ type: 'sine', freq: 150, to: 60, dur: 0.14, gain: 0.3 });
    },
    reveal() {
      [523.25, 659.25, 783.99].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.34, gain: 0.16, at: i * 0.09, attack: 0.01 }));
      tone({ type: 'sine', freq: 1567.98, dur: 0.5, gain: 0.07, at: 0.26, attack: 0.03 });
    },
    elim() {
      noise({ type: 'lowpass', freq: 1400, to: 300, dur: 0.18, gain: 0.3 });
      tone({ type: 'sawtooth', freq: 320, to: 70, dur: 0.46, gain: 0.16, filter: { type: 'lowpass', freq: 1100 } });
      tone({ type: 'sine', freq: 95, to: 40, dur: 0.28, gain: 0.3, at: 0.26 });
    },
    night() {
      tone({ type: 'sine', freq: 110, dur: 1.7, gain: 0.16, attack: 0.35, sustain: true, release: 0.7, filter: { type: 'lowpass', freq: 500 } });
      tone({ type: 'sine', freq: 110.8, dur: 1.7, gain: 0.12, attack: 0.4, sustain: true, release: 0.7 });
      tone({ type: 'triangle', freq: 220, dur: 1.4, gain: 0.05, attack: 0.5, sustain: true, release: 0.5, filter: { type: 'lowpass', freq: 700 } });
      tone({ type: 'sine', freq: 2093, dur: 0.45, gain: 0.035, at: 0.7, attack: 0.05 });
      tone({ type: 'sine', freq: 2637, dur: 0.5, gain: 0.03, at: 1.0, attack: 0.05 });
    },
    day() {
      [392, 493.88, 587.33, 783.99].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.62, gain: 0.11, at: i * 0.1, attack: 0.02 }));
      noise({ type: 'bandpass', freq: 400, to: 3200, dur: 0.75, gain: 0.05, q: 1.2, attack: 0.2 });
    },
    win() {
      noise({ type: 'highpass', freq: 2000, dur: 0.09, gain: 0.14 });
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        const last = i === notes.length - 1;
        tone({ type: 'triangle', freq: f, dur: last ? 0.8 : 0.22, gain: 0.16, at: i * 0.12, attack: 0.008 });
        tone({ type: 'square', freq: f / 2, dur: last ? 0.8 : 0.22, gain: 0.05, at: i * 0.12, filter: { type: 'lowpass', freq: 1800 } });
      });
      tone({ type: 'sine', freq: 2093, dur: 0.6, gain: 0.05, at: 0.42, attack: 0.04 });
    },
    error() {
      tone({ type: 'square', freq: 180, dur: 0.09, gain: 0.16, filter: { type: 'lowpass', freq: 900 } });
      tone({ type: 'square', freq: 160, dur: 0.11, gain: 0.16, at: 0.14, filter: { type: 'lowpass', freq: 900 } });
    }
  };

  function play(name) {
    if (muted) return;
    const c = ensure();
    if (!c || c.state !== 'running') return;
    const fn = SOUNDS[name];
    if (!fn) return;
    try { fn(); } catch (_) { }
  }

  function setMuted(next) {
    muted = !!next;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (_) { }
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : 0.4, ctx.currentTime, 0.03);
    }
    toggles.forEach(btn => {
      btn.classList.toggle('is-muted', muted);
      btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
      btn.setAttribute('aria-label', muted ? 'Unmute sounds' : 'Mute sounds');
    });
    window.dispatchEvent(new CustomEvent('pg:mute', { detail: { muted } }));
    return muted;
  }

  function toggle() {
    setMuted(!muted);
    if (!muted) { ensure(); setTimeout(() => play('tap'), 30); }
    try { window.Haptic && window.Haptic.light(); } catch (_) { }
    return muted;
  }

  function mountToggle(container) {
    const host = typeof container === 'string' ? document.querySelector(container) : (container || document.body);
    if (!host) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pg-fab pg-mute';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4 9.5v5h3.2L12 18.6V5.4L7.2 9.5H4z" fill="currentColor"/>' +
      '<path class="wave wave-1" d="M15 9.2a4 4 0 0 1 0 5.6"/>' +
      '<path class="wave wave-2" d="M17.6 6.6a7.6 7.6 0 0 1 0 10.8"/>' +
      '<path class="cross" d="M15 9.5l5 5M20 9.5l-5 5"/>' +
      '</svg>';
    btn.addEventListener('click', toggle);
    host.appendChild(btn);
    toggles.add(btn);
    setMuted(muted);
    return btn;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-pg-toggles]').forEach(host => {
      if (!host.querySelector('.pg-mute')) mountToggle(host);
    });
  });

  window.SFX = {
    play,
    toggle,
    mountToggle,
    setMuted,
    get muted() { return muted; },
    get unlocked() { return !!ctx && ctx.state === 'running'; }
  };

  // ---------- Haptic ----------
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  function vib(pattern) {
    if (!canVibrate) return false;
    try { return navigator.vibrate(pattern); } catch (_) { return false; }
  }
  window.Haptic = {
    supported: canVibrate,
    light() { return vib(10); },
    heavy() { return vib([30, 30, 50]); }
  };
})();

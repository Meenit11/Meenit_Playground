# Meenit's Playground brand kit

Pixel-arcade wordmark and game titles. Everything is self-contained SVG (no fonts, no external
requests) with CSS animations inside the file, so each asset works inline and as an `<img>`.
Entrance plays once on load (under 1.2 s), then a subtle idle loop. `prefers-reduced-motion`
shows the final frame. Regenerate from `scratchpad/brand/gen.py` if geometry changes.

## Files

| Path | Use |
|------|-----|
| `images/brand/wordmark.svg` | Home hero, animated (64 x 36 viewBox) |
| `images/brand/wordmark-static.svg` | Same, no animation (emails, og images) |
| `images/brand/mark.svg` | Square mark, idle blink and halo float |
| `images/brand/title-mafia.svg`, `title-undercover.svg`, `title-odd-one-in.svg`, `title-act-o-matic.svg` | Game titles |
| `favicon.svg`, `favicon.ico` (16/32/48), `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png` (180), `icons/maskable-512.png` | Icons |
| `manifest.webmanifest` | PWA manifest, `start_url ./index.html`, standalone |
| `css/brand.css` | `.brand-wordmark`, `.brand-title`, per-game tokens, entrance hooks |

## Head snippet (every page)

Paths are relative because the site is served from a GitHub Pages sub-path.
Root pages (`index.html`) use the first block; pages in `games/` prefix with `../`.

```html
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#12101c">
<link rel="stylesheet" href="css/brand.css">
```

```html
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="icon" href="../favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="../icons/apple-touch-icon.png">
<link rel="manifest" href="../manifest.webmanifest">
<meta name="theme-color" content="#12101c">
<link rel="stylesheet" href="../css/brand.css">
```

Every page also carries the theme bootstrap from the top of `js/theme.js` right after the
`theme-color` meta, and `<div class="pg-fab-row" data-pg-toggles></div>` as the first
child of `<body>` (sfx.js and theme.js mount the mute and theme toggles into it).
Mafia and Undercover only have a dark palette, so their `<html>` carries
`data-theme-lock="dark"`: the stored theme is ignored there and no theme toggle is shown.

Game pages may keep their own `theme-color` (Mafia `#0a080c`, Undercover `#0c0c14`,
Act-O-Matic `#111111`, Odd One In the new olive). `Theme.toggle()` should update the meta
to the light base when switching themes.

## Mounting a title

Inline is preferred: CSS tokens and the page theme flow into the SVG. The wrapper class
`brand-title--<game>` carries the palette for dark and light (`[data-theme]` on `<html>`).

```html
<div class="brand-title brand-title--mafia" data-brand="../images/brand/title-mafia.svg" role="heading" aria-level="1"></div>
<script>
  document.querySelectorAll('[data-brand]').forEach(async el => {
    try {
      const r = await fetch(el.dataset.brand);
      if (r.ok) el.innerHTML = await r.text();
    } catch (e) { /* fall through to img */ }
    if (!el.querySelector('svg')) {
      el.innerHTML = '<img src="' + el.dataset.brand + '" alt="' + (el.dataset.alt || '') + '">';
    }
  });
</script>
```

`<img>` fallback (also fine on its own, animations still play, built-in palette follows
`prefers-color-scheme` instead of `[data-theme]`):

```html
<div class="brand-title brand-title--mafia"><img src="../images/brand/title-mafia.svg" alt="Mafia"></div>
```

Home page: `<div class="brand-wordmark" data-brand="images/brand/wordmark.svg"></div>`.
Keep the existing long-press-to-reset handler on `.brand-wordmark`.

Replay the entrance: re-insert the SVG (`el.innerHTML = el.innerHTML`). Freeze everything:
set `data-motion="off"` on the wrapper or on `<html>`. Wrapper entrance for already
visible screens: add `brand-enter` or `brand-enter-delayed`.

Inline `<style>` blocks are scoped to the root class (`.pg-title-mafia`, `.pg-wordmark`), and
all ids are prefixed, so several different titles can share one page. Do not inline the same
title twice on one page (duplicate clip ids).

## Tokens

Brand: base `#12101c`, indigo `#2b2f7c` (light `#4a52c7`, deep `#15173f`), gold `#f2b63d`
(light `#ffd166`, dark `#b07a14`), ink `#f4efe4` dark theme, `#1b1a2e` light theme.

| Title | ink (currentColor) dark / light | `--t-accent` dark / light | `--t-shade` dark / light |
|-------|------|------|------|
| Mafia | `#8b3a4a` / `#6e2d3a` | `#c9a86c` / `#8a6a2e` (`--t-glint` `#ff3b5c`) | `#0a080c` / `#2a1016` |
| Undercover | `#e8e4dc` / `#2a1f4a` | `#8b5cf6` / `#6d28d9` | `#4c1d95` / `#c4b5fd` |
| Odd One In | `#e9e4cf` / `#2e3a14` | `#d4b84a` / `#b8981c` | `#2a3314` / `#c9cfa8` |
| Act-O-Matic | `#f0c040` / `#8a5f00` | `#d4a017` / `#b8860b` | `#5a3d05` / `#f3dfa1` |

Wordmark: `--pg-ink` (defaults to currentColor), `--pg-accent` and `--pg-shade` (gold).
Set them on `.brand-wordmark` to recolour.

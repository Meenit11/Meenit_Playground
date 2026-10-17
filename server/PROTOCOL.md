# Meenit's Playground: shared contracts

Every agent builds against this file. Do not change an interface here without
noting it in your final report. Integration reconciles differences at the end.

## 1. File ownership (parallel phase)

| Agent      | Owns (create or edit)                                                                                   |
|------------|----------------------------------------------------------------------------------------------------------|
| backend    | `server/**` (except `server/games/*.js` reducers), `js/net.js`, `server/test/**`                          |
| mafia      | `games/mafia.html`, `js/mafia.js`, `css/mafia.css`, `js/rules/mafia-rules.js`, `server/games/mafia.js`, `tests/mafia*.test.js` |
| undercover | `games/undercover.html`, `js/undercover.js`, `css/undercover.css`, `js/rules/undercover-rules.js`, `server/games/undercover.js`, `tests/undercover*.test.js`, `words.json` |
| oddonein   | `games/odd-one-in.html`, `js/odd-one-in.js`, `css/odd-one-in.css`, `js/rules/ooi-rules.js`, `server/games/ooi.js`, `tests/ooi*.test.js`, `questions.json` |
| motion     | `css/global.css`, `css/home.css`, `index.html`, `js/motion.js`, `js/sfx.js`, `js/theme.js`, `js/utils.js`, `games/act-o-matic.html`, `js/act-o-matic.js`, `css/act-o-matic.css` |
| branding   | `images/brand/**`, `manifest.webmanifest`, `favicon.svg`, `favicon.ico`, `icons/**`, `css/brand.css`, `BRAND.md` |

Anything not listed: do not touch. If you need a change in another agent's
file, write it in your final report under "Integration requests".

## 2. Backend room protocol

Base URL: configurable, default derived as today (`ooi_server_url` key stays
for compatibility, new key `pg_server_url`). All JSON. CORS open.

### REST
- `GET  /api/health` -> `{ ok: true, uptime, rooms }` (used by wake-up screen)
- `POST /api/rooms` body `{ game, hostName, settings }` -> `{ code, playerId, state }`
  - `game` is one of `mafia | undercover | ooi`
  - `settings` is game specific, validated by the game module
- `POST /api/rooms/:code/join` body `{ name, playerId? }` -> `{ playerId, state }`
  - a known `playerId` re-attaches (rejoin after refresh), name may be updated
  - join after start is refused with `409 { error: 'started' }` unless `playerId` is known
- `GET  /api/rooms/:code?playerId=X` -> `{ state }` (state is the private view for X)
- `POST /api/rooms/:code/action` body `{ playerId, type, payload }` -> `{ state }` or `4xx { error }`
- `POST /api/rooms/:code/leave` body `{ playerId }` -> `{ ok }`

### WebSocket
- URL: `<base with ws/wss>/ws?code=CODE&playerId=ID`
- Server -> client: `{ type: 'state', state }` on every change (private view per socket),
  `{ type: 'error', error }`, `{ type: 'pong' }`
- Client -> server: `{ type: 'action', action: { type, payload } }`, `{ type: 'ping' }`
- Polling fallback: client polls `GET /api/rooms/:code` every 1500 ms when the socket is down.

### Room lifecycle
- Codes: 4 digits, unique among live rooms.
- Persistence: rooms saved to `server/data/rooms.json` on every change (debounced 250 ms)
  and loaded on boot, so a Render restart keeps games alive.
- Expiry: a room is deleted 6 hours after its last action.
- Rejoin: client keeps `{ code, playerId, game, savedAt }` in localStorage key
  `pg_session_<game>` for 3 hours.

### Common state shape (every game)
```
{
  code, game, phase, hostId, createdAt, updatedAt, version,
  settings: {...},
  players: [{ id, name, isHost, connected, ... game fields }],
  me: { id, ... private fields for this viewer },
  ... game specific public fields
}
```
`version` increments on every change. Clients ignore states with a lower version.

## 3. Game module interface (server side)

`server/games/<game>.js` exports:
```js
module.exports = {
  name: 'mafia',
  defaultSettings: {...},
  validateSettings(settings) -> settings | throws Error,
  init({ code, hostId, hostName, settings }) -> state,      // phase 'lobby'
  join(state, player) -> state,                              // lobby only
  reduce(state, action, playerId) -> state | throws Error,   // pure, never mutates input
  view(state, playerId) -> state,                            // private projection
}
```
Common actions every module handles: `start`, `leave`, `kick` (host only), `restart` (host only, back to lobby keeping players).
Rules shared with single-phone mode live in `js/rules/<game>-rules.js`, pure functions,
written as UMD so both the browser (`window.MafiaRules`) and Node (`require`) can use them.

## 4. Client network library `js/net.js` (backend agent)

```js
const room = await Net.create('mafia', hostName, settings)   // -> Room
const room = await Net.join('mafia', code, name)             // -> Room
const room = await Net.rejoin('mafia')                       // -> Room | null (from pg_session_<game>)
room.state                 // latest private view
room.on('state', fn)       // fn(state) on every change
room.on('status', fn)      // fn('connecting'|'live'|'polling'|'waking'|'offline')
await room.send(type, payload)   // resolves to state, rejects with Error(message) on 4xx
room.leave()
Net.setServerUrl(url) / Net.getServerUrl()
Net.wake()                 // GET /api/health with 60 s timeout and a progress callback
```
Behaviour: 8 s request timeout, automatic retry with backoff, wake-up detection
(first request slow or failing -> status 'waking'), WebSocket with polling fallback,
reconnect on visibility change. Game agents may stub this during their work.

## 5. Motion, sound, haptics, theme (motion agent)

Loaded on every page after `utils.js`. Game code calls them guarded:
`window.Motion?.screen(...)`. No hover states anywhere. Touch targets 52 px.

```js
Motion.screen(fromId, toId, { direction: 'forward'|'back'|'none' })  // returns Promise
Motion.stagger(container, { selector, delay })   // list entrance
Motion.press(el)                                  // tap feedback, attach once
Motion.flipReveal(cardEl, { onRevealed })         // hold-to-reveal then 3D flip
Motion.characterEnter(imgEl, { glowColor })       // role character slide + glow
Motion.eliminate(el, { shake: true })             // desaturate, strike, fall
Motion.dayNight(mode)                             // 'night' | 'morning' | 'day', full-screen sky transition
Motion.timerRing(el, { seconds, onTick, onDone }) // countdown ring with urgency in the last 3 s
Motion.winner(container, { color })               // podium rise + confetti
Motion.toast(text, { kind })                      // replaces alert() everywhere
Motion.pulse(el)                                  // attention nudge
SFX.play('tap'|'tick'|'urgent'|'reveal'|'elim'|'night'|'day'|'win'|'error')
SFX.muted / SFX.toggle()                          // persisted in localStorage 'pg_muted'
Haptic.light() / Haptic.heavy()                   // navigator.vibrate guarded
Theme.get() / Theme.toggle()                      // 'dark' | 'light', persisted 'pg_theme', sets data-theme on <html>
```
CSS tokens in `global.css` for both themes under `[data-theme]`. Screen switching
convention: every screen is `.screen`, hidden with `.hidden`; `Motion.screen`
handles the transition so games stop toggling classes directly.

## 6. Branding (branding agent)

- `images/brand/wordmark.svg` animated main logo, `images/brand/mark.svg` square mark
- `images/brand/title-mafia.svg`, `title-undercover.svg`, `title-odd-one-in.svg`, `title-act-o-matic.svg`
  each an inline-able animated SVG title, dark and light theme aware via `currentColor` and CSS vars
- `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`, `favicon.svg`, `favicon.ico`
- `manifest.webmanifest`
- `css/brand.css` with `.brand-title` sizing and entrance animation hooks
- `BRAND.md`: the `<head>` snippet every page must include and how to embed a title

## 7. Simplicity rules (every agent)

- One primary action per screen, visually dominant. Secondary actions are ghost buttons.
- The host sees only what they must tap now. Players see only what they must do now.
- Room setup is at most three steps: name, mode or settings, start.
- No modals during play except destructive confirmations. No settings inside a round.
- Every waiting state says who we are waiting for.
- Copy is short, friendly, no jargon. "Pass the phone to Priya" beats "Next viewer".
- Error states always offer one obvious recovery button.

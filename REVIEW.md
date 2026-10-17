# Phone test checklist

Nothing in this rebuild has run in a real browser. Unit tests and a simulated browser
(jsdom) pass, but animation timing, sound, haptics, layout and real WebSockets on a
phone have not been seen. Work through this list on at least one iPhone (Safari) and
one Android phone (Chrome) before a party. Tick each box.

Tip: open the site from the home screen icon as well as in the browser tab; the
standalone app can behave differently (safe areas, audio unlock).

## 0. Before you start

- [ ] `js/net.js` has your real `DEFAULT_RENDER_HOST`, pushed and live on GitHub Pages.
- [ ] `https://<your-service>.onrender.com/api/health` returns `{ "ok": true, ... }`.
- [ ] Sound is on and the phone is not in silent mode (iPhone side switch).

## 1. Effects showroom (`motion-demo.html`)

Open `<site>/motion-demo.html`. It triggers every effect on demand, so check these first
and then confirm the same effect inside a real game.

- [ ] Screen transitions: Forward to B slides, Crossfade fades, Back to A slides back.
- [ ] Stagger and press: list items enter one by one; buttons dip when pressed.
- [ ] Hold to reveal: holding the card fills the ring, then the card flips. Reset card works.
- [ ] Character entrance: the role picture enters with a glow.
- [ ] Eliminate: the row strikes out and fades; With shake also shakes the screen.
- [ ] Day and night: Night darkens the sky, Morning brightens, Day clears. Under about 1.1 s.
- [ ] Timer ring: Start 8 s counts down smoothly, changes colour near the end, Stop halts it.
- [ ] Winner: podium plus confetti, no stutter.
- [ ] Toasts: all four show at the top, below the notch, and clear on their own.
- [ ] Sounds: each sound button plays; Haptic light and Haptic heavy vibrate (Android only,
      iPhone has no web vibration, that is expected).

## 2. Splash and home (`index.html`)

- [ ] First visit in a new tab: splash plays for about 1.5 s, the wordmark flies into
      the header. Tapping skips it.
- [ ] Reload in the same tab: no splash, home appears straight away.
- [ ] Animated wordmark plays once, then idles. No broken image box.
- [ ] Each game card shows players and "One phone" or "One or many phones".
- [ ] Mute toggle (speaker) and theme toggle (sun and moon) sit top right, clear of the notch.
- [ ] Theme toggle switches dark and light; the browser bar colour follows.
- [ ] Long-press the wordmark: reset dialog appears; Keep my data closes it.
- [ ] Phone with Reduce Motion on: splash and titles show the final frame without motion.

## 3. Animated titles (four game pages)

Open each page and check the title animates once on load, then idles, with no
duplicated text title under it.

- [ ] `games/mafia.html` (Mafia)
- [ ] `games/undercover.html` (Undercover)
- [ ] `games/odd-one-in.html` (Odd One In)
- [ ] `games/act-o-matic.html` (Act-O-Matic)

## 4. Odd One In olive palette (`games/odd-one-in.html`)

- [ ] Dark: olive background, cream text, gold accents. Readable on every screen.
- [ ] Switch to light with the toggle: light olive palette, dark text, cards still visible.
- [ ] Lobby, answer, review and winner screens look right in both themes.
- [ ] Mafia and Undercover stay dark even when light is chosen elsewhere (by design; they
      show only the mute toggle).

## 5. Hero animations in real games

- [ ] Role reveal flip: Mafia one phone (I'm here, show my role) and Undercover one phone
      (I'm here, show me). Hold, ring fills, card flips, role picture enters.
- [ ] Night to day: Mafia one phone, Start Night 1, then the morning and Start the day.
- [ ] Elimination: Mafia Vote out, and Odd One In review when a player is marked out.
- [ ] Timer ring: Odd One In answer screen, counts down from the chosen seconds.
- [ ] Winner: end a game of Mafia and of Odd One In; podium and confetti play.
- [ ] Act-O-Matic: the reel spins and lands on one action with a tick sound per row.

## 6. Sound and haptics

- [ ] First tap anywhere unlocks sound (iPhone needs a tap before any audio).
- [ ] Mute toggle silences every sound and stays muted after a reload and on other pages.
- [ ] Taps, reveal, elimination and winner sounds are not too loud or too long.
- [ ] Android: short vibration on key moments (reveal, elimination, winner).

## 7. Two-phone room, each game

For each of Mafia (needs 5 players, use 5 phones or tabs), Undercover (4) and Odd One In
(3): phone A taps Everyone's phone, Create a room; the others tap Everyone's phone and
enter the code.

- [ ] Mafia: everyone sees only their own role; night actions arrive; day vote works;
      the GM option (I am the GM) shows every role to the host only.
- [ ] Undercover: each phone shows its own word; GM picks and Everyone votes both work;
      Mr. White guess screen appears on Mr. White's phone.
- [ ] Odd One In: answers lock at the same time; the host reviews and marks players out.
- [ ] Share and Copy link (Odd One In lobby) open the share sheet or copy the link.
- [ ] The status pill at the top (Connecting, Reconnecting) does not cover the toggles.

## 8. Rejoin after refresh

- [ ] In the middle of a round, refresh one player's phone: it returns to the same room
      and the same screen, with its secret still private.
- [ ] Lock a phone for a minute and unlock: it catches up without a refresh.
- [ ] Turn Wi-Fi off and on: Offline then Reconnecting, then back to normal.

## 9. Render wake-up

- [ ] Leave the server idle for over 15 minutes (or pause the pinger), then create a room.
      The app shows "Waking up the server, this can take a minute" and the room opens
      within about a minute, with no error.
- [ ] With a wrong URL saved (Odd One In, Everyone's phone, Server settings), the app says
      the server is not answering. Clear the field and Save to go back to the default.

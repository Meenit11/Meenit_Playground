# Meenit's Playground

Mobile party games in plain HTML, CSS and JavaScript. No framework and no build step.
The site is static (GitHub Pages). A small Node.js room server (Render) is only needed
when players use their own phones.

## The games

| Game | Players | One phone | Own phones | In short |
|------|---------|-----------|------------|----------|
| Act-O-Matic | 2+ | Yes | No | Roll a secret action, act it out without words, then guess what you did. |
| Odd One In | 3 to 20 | Yes | Yes | Everyone answers the same question against a timer. Blank, bogus or duplicate answers go out. Last one standing wins. |
| Undercover | 4+ | Yes | Yes | Agents share a word, Spies get a similar one, Mr. White gets none. Describe your word, vote out the impostors. Mr. White, once voted out, can still win by guessing the Agents' word. |
| Mafia | 5 to 20 | Yes | Yes | Night: Mafia pick a victim, the Doctor protects, the Detective checks. Day: the town votes someone out. Optional Jester, Bomber and Lover. |

## Two ways to play

**One phone.** Pass a single phone around the table. The app shows each secret
(role, word, answer box) to one player at a time behind a "pass the phone" screen.
In Mafia one person is the Game Master and reads the night aloud; in Undercover and
Odd One In the phone runs the rounds. Nothing is sent over the network, so this works
offline.

**Own phones** (the "Everyone's phone" card). One player taps Create a room and gets
a 4-digit code. Everyone else opens the same game, taps Everyone's phone and enters
the code. Each phone shows only that player's secret, and the server keeps everyone in
step. A phone that refreshes or locks rejoins the room automatically for 3 hours.
In Mafia the host can play or act as Game Master (GM). In Mafia and Undercover the
room chooses whether the GM picks who goes out by day or everyone votes.

## Deploy

### Easiest: one Render service for the site and the server

1. Push this folder to a GitHub repository.
2. In Render choose New, then Blueprint, and pick the repository. Render reads `render.yaml`
   and creates one free web service that serves the site and runs the room server.
   Without the Blueprint, create a Web Service by hand with: root directory empty,
   build command `cd server && npm install`, start command `cd server && node server.js`,
   and an environment variable `PG_STATIC_DIR` set to `..`.
3. Open the service URL, for example `https://meenits-playground.onrender.com`. That is the
   game. Share that link; the phones talk to the same address, so no server settings are needed.
4. Keep it awake: a free service sleeps after 15 minutes. Set up a free job at cron-job.org that
   requests `https://<your-service>.onrender.com/api/health` every 10 minutes.

Every push to the repository redeploys automatically.

### Alternative: site on GitHub Pages, server on Render

Host the folder on GitHub Pages and run only the server on Render (same build and start
commands, no `PG_STATIC_DIR`). Then set the server address once: edit `js/net.js` and put your
Render host in `DEFAULT_RENDER_HOST`, or enter it under Odd One In, Create a room, Server settings.
The site is served over https, so the server address must be https too.

## Run locally

One command serves the site and the room server on the same port:

```bash
cd server && npm install
PORT=8080 PG_STATIC_DIR=.. node server.js
```

Open `localhost:8080` in a browser. Phones on the same Wi-Fi open `<your-computer-ip>:8080`.
No server settings are needed: when the server also serves the site, every page talks to the
address it was opened from. This also works through port forwarding, tunnels and dev containers,
because only one port is involved.

`PG_STATIC_DIR` is for local testing only. On Render, leave it unset and host the site on
GitHub Pages as described above.

`motion-demo.html` at the root plays every animation, sound and haptic on demand.

## Tests

Node 20 or newer. From the repository root:

```bash
# game rules and reducers
for f in tests/*.test.js; do node --test "$f"; done

# server: REST, WebSocket, persistence, expiry and a two-phone end-to-end run
cd server && npm install && for f in test/*.test.js; do node --test "$f"; done
```

No real browser test runs in this repository. Use `REVIEW.md` for the phone checklist.

## Project layout

| Path | What |
|------|------|
| `index.html` | Home with splash and game cards |
| `games/*.html`, `js/*.js`, `css/*.css` | One page, script and stylesheet per game |
| `js/rules/` | Pure game rules, shared by the one-phone mode and the server |
| `js/net.js` | Client for the room server (REST, WebSocket, polling fallback, rejoin) |
| `js/motion.js`, `js/sfx.js`, `js/theme.js` | Animations, sound and haptics, dark and light theme |
| `server/` | Room server, see `server/README.md` and `server/PROTOCOL.md` |
| `images/brand/`, `icons/`, `manifest.webmanifest`, `BRAND.md` | Branding and app icons |
| `images/legacy/` | Old PNG logos, kept for reference, not used |
| `words.json`, `questions.json`, `actions.json` | Game content |

## Known limits

- The free Render server sleeps when idle (see the pinger above) and loses all rooms
  on a redeploy or spin-down. A game in progress is lost if that happens.
- Rooms expire 6 hours after the last action. Codes are 4 digits.
- One server instance only. Do not scale it to two.
- Mafia and Undercover are dark only by design; the theme toggle appears on the home
  page, Odd One In and Act-O-Matic.
- Server URL setting in the app lives in Odd One In only (it applies to every game).
- Tested with Node unit tests and a simulated browser (jsdom), not on real phones yet.
  Run through `REVIEW.md` before a party.
- Long-press the logo on the home page to reset all saved names, words and sessions.

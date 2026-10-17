# Meenit's Playground server

Small Node.js room server for the multi-phone games (Mafia, Undercover, Odd One In).
One generic engine (`engine.js`, `server.js`) plus one rules module per game in
`games/`. No database: rooms live in memory and are saved to `data/rooms.json`.

The full contract between the site and this server is in `PROTOCOL.md`.

## Run it locally

```bash
cd server
npm install
node server.js
```

The server listens on port 3001. Open the site from the same machine
(`127.0.0.1` or `localhost`) and the app uses port 3001 on that host automatically.
Phones on your Wi-Fi can use your computer's IP: open Odd One In, tap Everyone's
phone, then Server settings, and enter `http://<your-computer-ip>:3001`. This only
works when the site itself is also opened over plain http from your computer.

Tests:

```bash
cd server
npm test
```

## Deploy on Render (free tier)

1. Push the repository to GitHub.
2. In Render, choose New, then Web Service, and connect the repository.
3. Settings:
   - Root Directory: leave empty (the repository root, see the note below)
   - Runtime: Node
   - Build Command: `cd server && npm install`
   - Start Command: `cd server && node server.js`
   - Instance type: Free
4. Deploy. Render gives you a URL such as `https://<your-service>.onrender.com`.
   Open `https://<your-service>.onrender.com/api/health` and check that it
   returns `{ "ok": true, ... }`.

Note on the root directory: the game modules read the shared rules and word
lists from the repository root (`js/rules/`, `words.json`, `questions.json`).
Render only ships files under the root directory, so setting it to `server`
would break those `require` calls at runtime. Keeping the repository root and
prefixing the commands with `cd server` is the simplest working setup.
Optional: under Build Filters add `server/**`, `js/rules/**`, `words.json` and
`questions.json` as included paths so site-only changes do not redeploy the server.

## Point the site at the server (once)

Pick one:

- Edit `js/net.js`: set `DEFAULT_RENDER_HOST` to your host, for example
  `my-playground.onrender.com`, and push. Every visitor uses it with no setup.
- Or enter the full URL in the app: Odd One In, Everyone's phone, Server settings.
  This is stored in the browser as `pg_server_url`, applies to all three online
  games on that device, and overrides the default on that device only.
  The old `ooi_server_url` key is still read and cleaned up automatically.

The site is served over https (GitHub Pages), so the server URL must be https
too. The app refuses a plain `http://` URL with a clear message rather than
failing silently in the browser.

## Keep the server awake

A free Render service sleeps after 15 minutes without traffic and takes 30 to
60 seconds to wake up. The app shows a "waking up" state and keeps retrying, so
nothing is lost, but the first player waits.

To avoid that, set up an external pinger that requests
`https://<your-service>.onrender.com/api/health` every 10 minutes, for example a
free job at cron-job.org. The health endpoint is cheap, supports GET and HEAD,
and returns `{ ok, uptime, rooms, version }`.

## What survives what

- Phone refresh or screen lock: the player rejoins automatically. The app keeps
  `pg_session_<game>` in the browser for 3 hours and the server re-attaches the
  same player id, even mid-game.
- Dropped WebSocket: the app falls back to polling every 1.5 s and reconnects
  with backoff. Tab changes and coming back online trigger an immediate reconnect.
- Server process restart on the same instance: rooms are reloaded from
  `data/rooms.json` (saved 250 ms after every change and on shutdown).
- Spin-down, redeploy or a Render restart on a fresh instance: rooms are lost.
  The free tier has no persistent disk, so the file does not survive these.
  The keep-alive pinger above is what prevents spin-downs in practice. A paid
  instance with a persistent disk mounted at `server/data` would make this
  survive everything.

## Known limits

- Rooms expire 6 hours after the last action. Empty rooms close immediately.
- Room codes are 4 digits, so at most 9000 live rooms. Fine for a party.
- One server instance only. Rooms live in memory, so do not scale to two instances.
- Request bodies are limited to 64 KB and the server accepts JSON only.
- CORS is open (`*`). The server holds no personal data beyond display names
  and these are deleted with the room.
- The free tier is single-region and shared. Expect 100 to 300 ms latency per
  action; the games are designed around that.

## API summary

All responses are JSON. Errors are `{ "error": "short human message" }` with a
4xx or 5xx status.

| Method and path                      | Body                              | Returns                      |
|--------------------------------------|-----------------------------------|------------------------------|
| `GET  /api/health`                   |                                   | `{ ok, uptime, rooms, version }` |
| `POST /api/rooms`                    | `{ game, hostName, settings }`    | `201 { code, playerId, state }` |
| `POST /api/rooms/:code/join`         | `{ name, playerId? }`             | `{ playerId, state }`, `409 { error: "started" }` after start |
| `GET  /api/rooms/:code?playerId=X`   |                                   | `{ state }` (private view)   |
| `POST /api/rooms/:code/action`       | `{ playerId, type, payload }`     | `{ state }` or `4xx { error }` |
| `POST /api/rooms/:code/leave`        | `{ playerId }`                    | `{ ok: true }`               |

WebSocket: `wss://<host>/ws?code=CODE&playerId=ID`. The server pushes
`{ type: "state", state }` on every change (a private view per socket),
`{ type: "error", error }` and `{ type: "pong" }`. The client may send
`{ type: "ping" }` and `{ type: "action", id, action: { type, payload } }`;
an action with an `id` is answered with `{ type: "ack", id, state }`.

Environment variables: `PORT` (default 3001), `PG_DATA_FILE` (default
`server/data/rooms.json`), `PG_LOG=0` to silence request logs.

## Adding a game

Create `games/<name>.js` exporting `name`, `defaultSettings`,
`validateSettings`, `init`, `join`, `reduce` and `view` as described in
`PROTOCOL.md` section 3. Reducers must be pure: return a new state, never
mutate the input. `view` must strip anything a player should not see. The
engine adds `code`, `game`, `createdAt`, `updatedAt`, `version`, the
`connected` flag on players and `me.id`. See `games/_example.js` for a
minimal module.

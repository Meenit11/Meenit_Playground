# Odd One In – Simple API

Multi-device play uses this small in-memory server. No Firebase or database.

## Run the server

```bash
cd server
node server.js
```

Server runs at **http://localhost:3001**.

## Play from different phones

1. Start this server on your computer.
2. Find your computer’s IP (e.g. `192.168.1.5`).
3. On each phone, open the game and set the API URL before loading:
   - Either deploy the game and set `window.OOD_API_BASE = 'http://YOUR_IP:3001'` in the HTML,  
   - Or use a tool like ngrok: `ngrok http 3001` and set `OOD_API_BASE` to the ngrok URL.
4. Game Master: Create game on one device. Share the room code or link.
5. Players: Join from their own devices using the same room code.

## API (for reference)

- `POST /api/rooms` – create room. Body: `{ "gmName": "..." }`. Returns `{ code, state }`.
- `GET /api/rooms/:code` – get current game state.
- `POST /api/rooms/:code/join` – join. Body: `{ "playerName": "..." }`. Returns `{ playerId, state }`.
- `POST /api/rooms/:code/state` – update state (GM). Body: `{ "state": { ... } }`.
- `POST /api/rooms/:code/answer` – submit answer. Body: `{ "playerId", "answer" }`.

Rooms are stored in memory only. Restarting the server clears all rooms.

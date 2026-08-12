# WHO IS REAL?

A memory-manipulation social deduction multiplayer game. Not an Among Us clone —
the core loop is **investigation → corrupted memory → contradiction → trust → discussion → vote**.

## Status: Phase 1 + Phase 2 complete

- [x] Phase 1 — Project architecture (Express + Socket.IO server, static client, folder structure)
- [x] Phase 2 — Lobby (create room, join room, room code, player list, host, start game)
- [ ] Phase 3 — Multiplayer movement (spawning, sync, interpolation, collision)
- [ ] Phase 4 — Core game (roles, objectives, kill, death, win conditions)
- [ ] Phase 5 — Memory System (the core mechanic)
- [ ] Phase 6 — Trust System
- [ ] Phase 7 — Events (blackout, clone, memory wipe, body swap, one sees all, last word)
- [ ] Phase 8 — Meetings (body discovery, discussion, voting, elimination)
- [ ] Phase 9 — Polish
- [ ] Phase 10 — Testing

## Run it

```
npm install
npm start
```

Then open `http://localhost:3000` in several browser tabs (or on different devices on
the same network) to simulate multiple players. You need at least 6 players in a room
before the host can start.

**Playtesting with fewer people:** `MIN_PLAYERS` and `MAX_PLAYERS` are configurable so
you don't have to round up 6 real people just to test the lobby:

```
MIN_PLAYERS=1 npm start   # host can start solo (open several tabs to simulate others)
MIN_PLAYERS=2 npm start   # testing with one friend
```

Leave them unset for a real game — the design target is still 6–12 players.

## What's implemented so far

**Server** (`server/`) is fully authoritative:
- `game/GameState.js` — explicit state machine with an allow-list of valid transitions
  (e.g. you cannot jump straight from `LOBBY` to `VOTING`).
- `game/Player.js` — splits every player into a `toPublic()` view (safe to broadcast to
  everyone) and a `toPrivate()` view (sent only to that player's own socket). Role,
  trust map, and memory log never leak to other clients — this split is the foundation
  the Phase 5/6 memory and trust systems will build on.
- `game/Room.js` — room lifecycle: adding/removing players, host assignment and
  auto-promotion if the host disconnects, min/max player enforcement (6–12).
- `utils/RoomManager.js` — generates unique 5-character room codes and tracks all
  active rooms.
- `server.js` — Socket.IO event handlers for `room:create`, `room:join`, `room:start`,
  and `disconnect`. Never trusts client-sent state; every action is validated
  server-side against the room/player it's registered to (via `socketRegistry`, not
  anything the client claims about itself).

**Client** (`client/`) is a vanilla JS + dark sci-fi terminal UI:
- Main menu → create/join room → lobby with live player list and host controls.
- `js/socket.js` wraps the Socket.IO connection so later modules (game, chat, memory,
  trust) can share it.
- `style.css` establishes the visual language for the whole project: glass panels,
  cyan/red terminal glow, scanline + vignette overlay, occasional title glitch — this
  is the base the Memory UI (Phase 5) and Trust UI (Phase 6) will extend with actual
  corruption/glitch effects on real data.

## Testing notes

This environment has no network access, so `npm install` couldn't be run here. Before
building further phases I validated all dependency-free game logic
(`GameState`, `Player`, `Room`, `RoomManager`) with a standalone Node script — state
transition rules, public/private field separation, host promotion on disconnect,
min/max player enforcement, and lobby-lock-out after start all pass. The Socket.IO
wiring in `server.js` itself still needs a real run — please `npm install && npm start`
and confirm room create/join/start works for you before I build Phase 3 on top of it.

## Project structure

```
who-is-real/
├── client/
│   ├── index.html
│   ├── style.css
│   └── js/
│       ├── socket.js
│       ├── ui.js
│       └── main.js
├── server/
│   ├── server.js
│   └── game/
│       ├── GameState.js
│       ├── Player.js
│       ├── Room.js
│       └── RoomManager.js
├── package.json
└── README.md
```

(`game.js`, `map.js`, `memory.js`, `trust.js`, `events.js`, `chat.js` on the client, and
`MemorySystem.js`, `TrustSystem.js`, `EventSystem.js`, `MeetingSystem.js`,
`RoleSystem.js` on the server, land in Phases 3–8 as the systems they back get built.)

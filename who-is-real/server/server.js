const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const RoomManager = require('./game/RoomManager');
const Player = require('./game/Player');
const { STATES } = require('./game/GameState');
const GameEngine = require('./game/GameEngine');
const { ROLES } = require('./game/RoleSystem');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // required so Render (and any non-localhost host) can reach it
const NAME_MAX_LEN = 16;
const CHAT_MAX_LEN = 240;
const RECONNECT_GRACE_MS = 60 * 1000; // how long a mid-game disconnect stays reclaimable

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }, // prototype only - tighten before real deployment
});

app.use(express.static(path.join(__dirname, '..', 'client')));

const roomManager = new RoomManager();

// Tracks which room/player a given socket belongs to, so we can clean up
// on disconnect without trusting anything the client tells us.
const socketRegistry = new Map(); // socketId -> { roomCode, playerId }

// Mid-game disconnects get a grace period before they're treated as a
// permanent departure, so a refresh/flaky connection doesn't insta-kick
// someone out of a round in progress.
const disconnectGraceTimers = new Map(); // playerId -> Timeout

function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, NAME_MAX_LEN);
  if (trimmed.length === 0) return null;
  return trimmed;
}

function sanitizeChatText(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, CHAT_MAX_LEN);
  if (trimmed.length === 0) return null;
  return trimmed;
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobby:update', room.toLobbySnapshot());
}

function broadcastGamePhase(room) {
  if (room.game) io.to(room.code).emit('game:phase', room.game.toPublicState());
}

io.on('connection', (socket) => {
  // ---------------- lobby ----------------

  socket.on('room:create', (payload, ack) => {
    try {
      const name = sanitizeName(payload && payload.name);
      if (!name) return ack && ack({ ok: false, error: 'Enter a valid name.' });

      const room = roomManager.createRoom();
      const player = new Player({ socketId: socket.id, name });
      room.addPlayer(player);

      socket.join(room.code);
      socketRegistry.set(socket.id, { roomCode: room.code, playerId: player.id });

      ack && ack({ ok: true, room: room.toLobbySnapshot(), you: player.toPrivate() });
      broadcastLobby(room);
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on('room:join', (payload, ack) => {
    try {
      const name = sanitizeName(payload && payload.name);
      const code = payload && typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
      if (!name) return ack && ack({ ok: false, error: 'Enter a valid name.' });
      if (!code) return ack && ack({ ok: false, error: 'Enter a room code.' });

      const room = roomManager.getRoom(code);
      if (!room) return ack && ack({ ok: false, error: 'Room not found.' });

      const player = new Player({ socketId: socket.id, name });
      room.addPlayer(player); // throws if full or already started

      socket.join(room.code);
      socketRegistry.set(socket.id, { roomCode: room.code, playerId: player.id });

      ack && ack({ ok: true, room: room.toLobbySnapshot(), you: player.toPrivate() });
      broadcastLobby(room);
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on('room:start', (payload, ack) => {
    try {
      const reg = socketRegistry.get(socket.id);
      if (!reg) return ack && ack({ ok: false, error: 'Not in a room.' });
      const room = roomManager.getRoom(reg.roomCode);
      if (!room) return ack && ack({ ok: false, error: 'Room not found.' });

      const check = room.canStart(reg.playerId);
      if (!check.ok) return ack && ack({ ok: false, error: check.reason });

      const engine = new GameEngine({ io, room });
      engine.start();
      ack && ack({ ok: true });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  // ---------------- gameplay actions ----------------

  socket.on('game:night-kill', (payload, ack) => {
    try {
      const reg = socketRegistry.get(socket.id);
      if (!reg) return ack && ack({ ok: false, error: 'Not in a room.' });
      const room = roomManager.getRoom(reg.roomCode);
      if (!room || !room.game) return ack && ack({ ok: false, error: 'No active game.' });
      const player = room.players.get(reg.playerId);
      if (!player) return ack && ack({ ok: false, error: 'Player not found.' });

      room.game.submitNightKill(player, payload && payload.targetId);
      ack && ack({ ok: true });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on('game:vote', (payload, ack) => {
    try {
      const reg = socketRegistry.get(socket.id);
      if (!reg) return ack && ack({ ok: false, error: 'Not in a room.' });
      const room = roomManager.getRoom(reg.roomCode);
      if (!room || !room.game) return ack && ack({ ok: false, error: 'No active game.' });
      const player = room.players.get(reg.playerId);
      if (!player) return ack && ack({ ok: false, error: 'Player not found.' });

      room.game.submitVote(player, payload && payload.targetId);
      ack && ack({ ok: true });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  // Discussion-phase chat. Living players are heard by everyone; dead
  // players are only heard by other dead players (spectator-only chat) -
  // "dead players cannot influence the living".
  socket.on('game:chat', (payload) => {
    const reg = socketRegistry.get(socket.id);
    if (!reg) return;
    const room = roomManager.getRoom(reg.roomCode);
    if (!room || !room.game) return;
    if (room.state.current !== STATES.DISCUSSION && room.state.current !== STATES.VOTING) return;
    const player = room.players.get(reg.playerId);
    if (!player) return;
    const text = sanitizeChatText(payload && payload.text);
    if (!text) return;

    const msg = { playerId: player.id, name: player.name, text, alive: player.alive, time: Date.now() };
    if (player.alive) {
      io.to(room.code).emit('game:chat', msg);
    } else {
      for (const p of room.players.values()) {
        if (!p.alive) io.to(p.socketId).emit('game:chat', msg);
      }
    }
  });

  // Night-phase, imposter-only coordination channel.
  socket.on('game:imposter-chat', (payload) => {
    const reg = socketRegistry.get(socket.id);
    if (!reg) return;
    const room = roomManager.getRoom(reg.roomCode);
    if (!room || !room.game) return;
    const player = room.players.get(reg.playerId);
    if (!player || player.role !== ROLES.IMPOSTER || !player.alive) return;
    if (room.state.current !== STATES.NIGHT) return;
    const text = sanitizeChatText(payload && payload.text);
    if (!text) return;

    const msg = { playerId: player.id, name: player.name, text, time: Date.now() };
    for (const p of room.players.values()) {
      if (p.role === ROLES.IMPOSTER) io.to(p.socketId).emit('game:imposter-chat', msg);
    }
  });

  // ---------------- rematch ----------------

  socket.on('room:rematch', (payload, ack) => {
    try {
      const reg = socketRegistry.get(socket.id);
      if (!reg) return ack && ack({ ok: false, error: 'Not in a room.' });
      const room = roomManager.getRoom(reg.roomCode);
      if (!room) return ack && ack({ ok: false, error: 'Room not found.' });
      if (reg.playerId !== room.hostId) return ack && ack({ ok: false, error: 'Chỉ host mới có thể bắt đầu lại.' });
      if (room.state.current !== STATES.GAME_OVER) return ack && ack({ ok: false, error: 'Trận đấu chưa kết thúc.' });

      room.resetForRematch();
      ack && ack({ ok: true });
      broadcastLobby(room);
      io.to(room.code).emit('game:reset');
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  // ---------------- reconnect ----------------

  socket.on('player:reconnect', (payload, ack) => {
    try {
      const roomCode = payload && typeof payload.roomCode === 'string' ? payload.roomCode.toUpperCase() : '';
      const playerId = payload && payload.playerId;
      const token = payload && payload.token;

      const room = roomManager.getRoom(roomCode);
      if (!room) return ack && ack({ ok: false, error: 'Room not found.' });
      const player = room.players.get(playerId);
      if (!player) return ack && ack({ ok: false, error: 'Player not found.' });
      if (!token || player.reconnectToken !== token) return ack && ack({ ok: false, error: 'Invalid session.' });

      const pendingTimer = disconnectGraceTimers.get(playerId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        disconnectGraceTimers.delete(playerId);
      }

      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
      socket.join(room.code);
      socketRegistry.set(socket.id, { roomCode: room.code, playerId: player.id });

      ack && ack({ ok: true, room: room.toLobbySnapshot(), you: player.toPrivate() });

      if (room.game && room.state.current !== STATES.LOBBY) {
        io.to(socket.id).emit('game:you', room.game.privateViewFor(player));
        io.to(socket.id).emit('game:phase', room.game.toPublicState());
      }
      broadcastLobby(room);
      io.to(room.code).emit('game:notice', { text: `${player.name} đã kết nối lại.` });
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  // ---------------- disconnect ----------------

  socket.on('disconnect', () => {
    const reg = socketRegistry.get(socket.id);
    if (!reg) return;
    socketRegistry.delete(socket.id);

    const room = roomManager.getRoom(reg.roomCode);
    if (!room) return;
    const player = room.players.get(reg.playerId);
    if (!player) return;

    const midGame = room.game
      && room.state.current !== STATES.LOBBY
      && room.state.current !== STATES.GAME_OVER;

    if (!midGame) {
      // Lobby (or a finished game nobody rematched yet): just leave outright.
      room.removePlayer(reg.playerId);
      if (!roomManager.cleanupIfEmpty(room.code)) {
        broadcastLobby(room);
        broadcastGamePhase(room);
      }
      return;
    }

    // Mid-round: give them a grace window to reconnect before treating
    // this as a real departure that affects the win condition.
    player.connected = false;
    player.disconnectedAt = Date.now();
    broadcastGamePhase(room);
    io.to(room.code).emit('game:notice', { text: `${player.name} mất kết nối. Đang chờ quay lại (${RECONNECT_GRACE_MS / 1000}s)...` });

    const timer = setTimeout(() => {
      disconnectGraceTimers.delete(player.id);
      if (player.connected) return; // they came back in the meantime

      room.removePlayer(player.id);
      if (room.game) room.game.handlePlayerLeft(player.id);
      if (roomManager.cleanupIfEmpty(room.code)) return;
      broadcastLobby(room);
      broadcastGamePhase(room);
    }, RECONNECT_GRACE_MS);
    disconnectGraceTimers.set(player.id, timer);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`WHO IS REAL? server listening on ${HOST}:${PORT}`);
});

module.exports = { app, server, io };

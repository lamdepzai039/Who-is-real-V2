const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const RoomManager = require('./game/RoomManager');
const Player = require('./game/Player');
const { STATES } = require('./game/GameState');

const PORT = process.env.PORT || 3000;
const NAME_MAX_LEN = 16;

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

function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, NAME_MAX_LEN);
  if (trimmed.length === 0) return null;
  return trimmed;
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobby:update', room.toLobbySnapshot());
}

io.on('connection', (socket) => {
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

      room.state.transition(STATES.COUNTDOWN);
      broadcastLobby(room);
      ack && ack({ ok: true });

      // Simple countdown -> PLAYING. Phase 3+ will hook real game setup here.
      let secondsLeft = 5;
      io.to(room.code).emit('room:countdown', { seconds: secondsLeft });
      const interval = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) {
          clearInterval(interval);
          if (room.state.current === STATES.COUNTDOWN) {
            room.state.transition(STATES.PLAYING);
            io.to(room.code).emit('game:started', room.toLobbySnapshot());
          }
        } else {
          io.to(room.code).emit('room:countdown', { seconds: secondsLeft });
        }
      }, 1000);
    } catch (err) {
      ack && ack({ ok: false, error: err.message });
    }
  });

  socket.on('disconnect', () => {
    const reg = socketRegistry.get(socket.id);
    if (!reg) return;
    socketRegistry.delete(socket.id);

    const room = roomManager.getRoom(reg.roomCode);
    if (!room) return;

    room.removePlayer(reg.playerId);
    if (!roomManager.cleanupIfEmpty(room.code)) {
      broadcastLobby(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`WHO IS REAL? server listening on port ${PORT}`);
});

module.exports = { app, server, io };

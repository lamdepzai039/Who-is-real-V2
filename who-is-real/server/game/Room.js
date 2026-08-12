const { GameState, STATES } = require('./GameState');

// Configurable so the game can be play-tested solo/in small groups without
// waiting for 6 real people. Production deploys should leave these unset
// (defaults to the designed 6-12 range).
const MIN_PLAYERS = clamp(parseInt(process.env.MIN_PLAYERS, 10) || 6, 1, 12);
const MAX_PLAYERS = clamp(parseInt(process.env.MAX_PLAYERS, 10) || 12, MIN_PLAYERS, 20);

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity

function generateRoomCode(length = 5) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // playerId -> Player
    this.hostId = null;
    this.state = new GameState(STATES.LOBBY);
    this.createdAt = Date.now();
    this.minPlayers = MIN_PLAYERS;
    this.maxPlayers = MAX_PLAYERS;
  }

  get playerCount() {
    return this.players.size;
  }

  get isFull() {
    return this.playerCount >= this.maxPlayers;
  }

  isEmpty() {
    return this.playerCount === 0;
  }

  addPlayer(player) {
    if (this.state.current !== STATES.LOBBY) {
      throw new Error('Cannot join a room that is not in LOBBY.');
    }
    if (this.isFull) {
      throw new Error('Room is full.');
    }
    this.players.set(player.id, player);
    if (!this.hostId) {
      this.hostId = player.id;
      player.isHost = true;
    }
    return player;
  }

  removePlayer(playerId) {
    const wasHost = this.hostId === playerId;
    this.players.delete(playerId);

    if (wasHost && this.players.size > 0) {
      // Promote the earliest-joined remaining player (Map preserves insertion order).
      const nextHost = this.players.values().next().value;
      this.hostId = nextHost.id;
      nextHost.isHost = true;
    } else if (this.players.size === 0) {
      this.hostId = null;
    }
  }

  getPlayerBySocketId(socketId) {
    for (const p of this.players.values()) {
      if (p.socketId === socketId) return p;
    }
    return null;
  }

  canStart(requesterId) {
    if (requesterId !== this.hostId) return { ok: false, reason: 'Only the host can start the game.' };
    if (this.state.current !== STATES.LOBBY) return { ok: false, reason: 'Game already started.' };
    if (this.playerCount < this.minPlayers) {
      return { ok: false, reason: `Need at least ${this.minPlayers} players (have ${this.playerCount}).` };
    }
    return { ok: true };
  }

  publicPlayerList() {
    return Array.from(this.players.values()).map((p) => p.toPublic());
  }

  toLobbySnapshot() {
    return {
      code: this.code,
      state: this.state.current,
      hostId: this.hostId,
      minPlayers: this.minPlayers,
      maxPlayers: this.maxPlayers,
      players: this.publicPlayerList(),
    };
  }
}

module.exports = { Room, generateRoomCode, MIN_PLAYERS, MAX_PLAYERS };

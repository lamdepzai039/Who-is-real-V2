const { STATES } = require('./GameState');
const { ROLES, assignRoles } = require('./RoleSystem');

// All durations in ms. Server owns every timer - clients only render an
// absolute `endsAt` timestamp, so nobody's local clock drift matters and
// everyone counts down from the same moment.
const DURATIONS = {
  STARTING: 5000,
  NIGHT: 20000,
  DISCUSSION: 45000,
  VOTING: 30000,
  RESULT: 8000,
};

class GameEngine {
  constructor({ io, room }) {
    this.io = io;
    this.room = room;
    this.round = 0;
    this.endsAt = null;
    this.timer = null;
    this.votes = new Map(); // voterId -> targetId ('SKIP' allowed)
    this.nightChoices = new Map(); // imposterId -> targetId
    this.lastElimination = null;
    this.winner = null;
    this.destroyed = false;
  }

  // ---------------- lifecycle ----------------

  start() {
    const { imposters } = assignRoles(Array.from(this.room.players.values()));
    this.room.game = this;
    this.room.state.transition(STATES.STARTING);

    for (const p of this.room.players.values()) {
      this.emitToPlayer(p, 'game:you', this.privateViewFor(p));
    }
    this.broadcastPhase(DURATIONS.STARTING);
    this.io.to(this.room.code).emit('game:notice', {
      text: `Trận đấu bắt đầu! ${imposters.length} kẻ giả mạo đang trà trộn trong ${this.room.players.size} người.`,
    });

    this._schedule(() => this.beginNight(), DURATIONS.STARTING);
  }

  privateViewFor(player) {
    const imposters = Array.from(this.room.players.values()).filter((p) => p.role === ROLES.IMPOSTER);
    return {
      role: player.role,
      teammates: player.role === ROLES.IMPOSTER
        ? imposters.filter((p) => p.id !== player.id).map((p) => ({ id: p.id, name: p.name }))
        : [],
    };
  }

  beginNight() {
    if (this.destroyed) return;
    this.round += 1;
    this.nightChoices.clear();
    this.room.state.transition(STATES.NIGHT);
    this.broadcastPhase(DURATIONS.NIGHT);
    this.io.to(this.room.code).emit('game:notice', { text: `Vòng ${this.round}: Đêm xuống. Kẻ giả mạo đang hành động...` });
    this._schedule(() => this.resolveNight(), DURATIONS.NIGHT);
  }

  resolveNight() {
    if (this.destroyed) return;
    const killedId = this._majorityChoice(this.nightChoices);
    this.lastElimination = null;

    if (killedId) {
      const victim = this.room.players.get(killedId);
      if (victim && victim.alive) {
        victim.alive = false;
        victim.deathInfo = { time: Date.now(), cause: 'NIGHT_KILL' };
        this.lastElimination = { playerId: victim.id, name: victim.name, role: victim.role, cause: 'NIGHT' };
      }
    }

    if (this._checkWinConditionAndMaybeEnd()) return;
    this.beginDiscussion();
  }

  beginDiscussion() {
    this.room.state.transition(STATES.DISCUSSION);
    this.broadcastPhase(DURATIONS.DISCUSSION);
    const text = this.lastElimination
      ? `${this.lastElimination.name} đã bị sát hại trong đêm.`
      : 'Không ai bị sát hại trong đêm nay.';
    this.io.to(this.room.code).emit('game:notice', { text });
    this._schedule(() => this.beginVoting(), DURATIONS.DISCUSSION);
  }

  beginVoting() {
    if (this.destroyed) return;
    this.votes.clear();
    this.room.state.transition(STATES.VOTING);
    this.broadcastPhase(DURATIONS.VOTING);
    this.io.to(this.room.code).emit('game:notice', { text: 'Bắt đầu bỏ phiếu. Hãy chọn người bạn nghi ngờ.' });
    this._schedule(() => this.resolveVoting(), DURATIONS.VOTING);
  }

  resolveVoting() {
    if (this.destroyed) return;
    this._clearTimer();

    const { winnerId, tie } = this._tallyVotes();
    this.lastElimination = null;

    if (winnerId && !tie) {
      const victim = this.room.players.get(winnerId);
      if (victim && victim.alive) {
        victim.alive = false;
        victim.deathInfo = { time: Date.now(), cause: 'VOTE' };
        this.lastElimination = { playerId: victim.id, name: victim.name, role: victim.role, cause: 'VOTE' };
      }
    }

    this.room.state.transition(STATES.RESULT);
    this.broadcastPhase(DURATIONS.RESULT);
    const text = this.lastElimination
      ? `${this.lastElimination.name} đã bị loại. Họ là ${this.lastElimination.role === ROLES.IMPOSTER ? 'KẺ GIẢ MẠO' : 'THÀNH VIÊN PHI HÀNH ĐOÀN'}.`
      : tie
        ? 'Hòa phiếu - không ai bị loại.'
        : 'Không đủ phiếu - không ai bị loại.';
    this.io.to(this.room.code).emit('game:notice', { text });

    if (this._checkWinConditionAndMaybeEnd()) return;
    this._schedule(() => this.beginNight(), DURATIONS.RESULT);
  }

  endGame(winner) {
    this.winner = winner;
    this._clearTimer();
    this.room.state.transition(STATES.GAME_OVER);
    const results = Array.from(this.room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      alive: p.alive,
      won: p.role === winner,
    }));
    this.io.to(this.room.code).emit('game:over', { winner, results, round: this.round });
  }

  destroy() {
    this.destroyed = true;
    this._clearTimer();
  }

  // ---------------- player actions (server validates everything) ----------------

  submitNightKill(actorPlayer, targetId) {
    if (this.room.state.current !== STATES.NIGHT) throw new Error('Không phải lúc để hành động.');
    if (!actorPlayer.alive) throw new Error('Bạn đã bị loại.');
    if (actorPlayer.role !== ROLES.IMPOSTER) throw new Error('Bạn không có quyền hành động này.');

    const target = this.room.players.get(targetId);
    if (!target || !target.alive) throw new Error('Mục tiêu không hợp lệ.');
    if (target.id === actorPlayer.id) throw new Error('Không thể chọn chính mình.');
    if (target.role === ROLES.IMPOSTER) throw new Error('Không thể chọn đồng đội.');

    this.nightChoices.set(actorPlayer.id, targetId);
    return true;
  }

  submitVote(actorPlayer, targetId) {
    if (this.room.state.current !== STATES.VOTING) throw new Error('Không phải lúc để vote.');
    if (!actorPlayer.alive) throw new Error('Bạn đã bị loại, không thể vote.');

    if (targetId !== 'SKIP') {
      const target = this.room.players.get(targetId);
      if (!target || !target.alive) throw new Error('Mục tiêu không hợp lệ.');
    }

    this.votes.set(actorPlayer.id, targetId);
    this._broadcastVoteProgress();

    const alive = this.room.activePlayers();
    const votedCount = alive.filter((p) => this.votes.has(p.id)).length;
    if (votedCount >= alive.length && alive.length > 0) {
      this.resolveVoting();
    }
    return true;
  }

  // Called after a player is permanently removed from the room (grace
  // period expired) so an in-progress round doesn't hang waiting on
  // someone who is never coming back.
  handlePlayerLeft(playerId) {
    this.votes.delete(playerId);
    this.nightChoices.delete(playerId);
    if (this.room.state.current === STATES.VOTING) {
      const alive = this.room.activePlayers();
      const votedCount = alive.filter((p) => this.votes.has(p.id)).length;
      this._broadcastVoteProgress();
      if (alive.length > 0 && votedCount >= alive.length) {
        this.resolveVoting();
        return;
      }
    }
    if (this.room.state.current !== STATES.GAME_OVER) {
      this._checkWinConditionAndMaybeEnd();
    }
  }

  // ---------------- internals ----------------

  _schedule(fn, ms) {
    this._clearTimer();
    this.timer = setTimeout(fn, ms);
  }

  _clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _majorityChoice(choiceMap) {
    const counts = new Map();
    for (const targetId of choiceMap.values()) {
      if (!targetId) continue;
      counts.set(targetId, (counts.get(targetId) || 0) + 1);
    }
    let top = null;
    let max = 0;
    let tie = false;
    for (const [id, c] of counts.entries()) {
      if (c > max) { max = c; top = id; tie = false; }
      else if (c === max) { tie = true; }
    }
    return tie ? null : top;
  }

  _tallyVotes() {
    const counts = new Map();
    for (const targetId of this.votes.values()) {
      if (!targetId || targetId === 'SKIP') continue;
      counts.set(targetId, (counts.get(targetId) || 0) + 1);
    }
    let winnerId = null;
    let max = 0;
    let tie = false;
    for (const [id, c] of counts.entries()) {
      if (c > max) { max = c; winnerId = id; tie = false; }
      else if (c === max) { tie = true; }
    }
    return { winnerId, tie, counts };
  }

  _checkWinConditionAndMaybeEnd() {
    const alive = this.room.activePlayers();
    const aliveImposters = alive.filter((p) => p.role === ROLES.IMPOSTER).length;
    const aliveCrew = alive.filter((p) => p.role === ROLES.CREW).length;

    let winner = null;
    if (aliveImposters === 0) winner = ROLES.CREW;
    else if (aliveImposters >= aliveCrew) winner = ROLES.IMPOSTER;

    if (winner) {
      this.endGame(winner);
      return true;
    }
    return false;
  }

  _broadcastVoteProgress() {
    const alive = this.room.activePlayers();
    const votedCount = alive.filter((p) => this.votes.has(p.id)).length;
    this.io.to(this.room.code).emit('game:vote-progress', { voted: votedCount, total: alive.length });
  }

  emitToPlayer(player, event, payload) {
    // Socket.IO auto-joins every socket to a room named after its own id,
    // so this reaches exactly that player's current connection - including
    // after a reconnect, since Player.socketId is updated at that point.
    this.io.to(player.socketId).emit(event, payload);
  }

  broadcastPhase(durationMs) {
    this.endsAt = Date.now() + durationMs;
    this.io.to(this.room.code).emit('game:phase', this.toPublicState());
  }

  toPublicState() {
    return {
      phase: this.room.state.current,
      round: this.round,
      endsAt: this.endsAt,
      players: Array.from(this.room.players.values()).map((p) => ({
        id: p.id, name: p.name, alive: p.alive, connected: p.connected, isHost: p.isHost,
      })),
      lastElimination: this.lastElimination,
      winner: this.winner,
    };
  }
}

module.exports = GameEngine;

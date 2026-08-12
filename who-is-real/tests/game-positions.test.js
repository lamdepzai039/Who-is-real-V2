const test = require('node:test');
const assert = require('node:assert/strict');

const { Room } = require('../server/game/Room');
const Player = require('../server/game/Player');
const GameEngine = require('../server/game/GameEngine');

function makeRoomWithPlayers(count = 4) {
  const room = new Room('TEST1');
  for (let i = 0; i < count; i += 1) {
    const player = new Player({ socketId: `socket-${i}`, name: `Player ${i + 1}` });
    room.addPlayer(player);
  }
  return room;
}

test('game phase exposes player positions so canvas can render players', () => {
  const room = makeRoomWithPlayers(4);
  const io = {
    to: () => ({ emit: () => {} }),
  };

  const engine = new GameEngine({ io, room });
  engine.start();

  try {
    const state = engine.toPublicState();
    assert.ok(Array.isArray(state.players));
    assert.ok(state.players.length > 0);
    assert.ok(state.players.every((p) => p.position && typeof p.position.x === 'number' && typeof p.position.y === 'number'));

    const player = room.players.values().next().value;
    engine.movePlayer(player, 1, 0);
    assert.ok(player.position.x > 0);
  } finally {
    engine.destroy();
  }
});

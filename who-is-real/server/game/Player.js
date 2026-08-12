const { randomUUID } = require('crypto');

// Fields that are safe to broadcast to ALL clients unconditionally.
const PUBLIC_FIELDS = [
  'id', 'name', 'alive', 'position', 'currentRoom', 'visibleIdentity', 'isHost', 'connected',
];

class Player {
  constructor({ socketId, name }) {
    this.id = randomUUID();
    this.socketId = socketId;
    this.name = name;
    this.isHost = false;
    this.connected = true;

    // Position / movement (server authoritative)
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.currentRoom = 'CENTRAL';
    this.lastKnownLocation = 'CENTRAL';

    // Life state
    this.alive = true;
    this.deathInfo = null; // { time, location, cause } - server truth, filtered on send

    // Identity - realIdentity/role are NEVER sent to other clients.
    // visibleIdentity is what others see (can be spoofed by MIMIC/BODY_SWAP events).
    this.role = null; // CREW | IMPOSTER | DETECTIVE | MIMIC | EXPERIMENT
    this.realIdentity = this.name;
    this.visibleIdentity = this.name;

    // Social systems
    this.trust = {}; // { [otherPlayerId]: number 0-100 }

    // Memory log - array of memory objects (see MemorySystem for shape).
    // Each entry already contains ONLY the perceived version by the time
    // it reaches here for serialization; the true event lives in MemorySystem.
    this.memory = [];

    this.inventory = [];
    this.cooldowns = {}; // { [actionName]: timestampWhenAvailable }
    this.secretObjectives = [];
  }

  // Returns the subset of this player's data that is safe to send to
  // EVERY client (i.e. what other players are allowed to see about them).
  toPublic() {
    const out = {};
    for (const field of PUBLIC_FIELDS) out[field] = this[field];
    return out;
  }

  // Returns the full private view sent ONLY to this player's own socket.
  toPrivate() {
    return {
      ...this.toPublic(),
      role: this.role,
      trust: this.trust,
      memory: this.memory,
      inventory: this.inventory,
      cooldowns: this.cooldowns,
      lastKnownLocation: this.lastKnownLocation,
    };
  }
}

module.exports = Player;

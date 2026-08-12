const { Room, generateRoomCode } = require('./Room');

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
  }

  createRoom() {
    let code = generateRoomCode();
    let attempts = 0;
    while (this.rooms.has(code) && attempts < 20) {
      code = generateRoomCode();
      attempts++;
    }
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(code.toUpperCase()) || null;
  }

  deleteRoom(code) {
    this.rooms.delete(code);
  }

  // Removes a room if it has no players left. Called after disconnects/leaves.
  cleanupIfEmpty(code) {
    const room = this.rooms.get(code);
    if (room && room.isEmpty()) {
      this.rooms.delete(code);
      return true;
    }
    return false;
  }

  roomCount() {
    return this.rooms.size;
  }
}

module.exports = RoomManager;

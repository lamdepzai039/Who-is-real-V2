// Thin wrapper around the Socket.IO client. Keeps the raw socket object
// in one place so later modules (game.js, chat.js, memory.js...) can
// share a single connection instead of each opening their own.

const NET = (() => {
  const socket = io();

  function emitAck(event, payload) {
    return new Promise((resolve) => {
      socket.emit(event, payload, (response) => resolve(response));
    });
  }

  return { socket, emitAck };
})();

// Phase 1-2: main menu + lobby flow.
// Game/movement/memory/trust systems attach in later phases.

(() => {
  const { socket, emitAck } = NET;

  let currentRoom = null; // last lobby snapshot from the server
  let myPlayerId = null;

  // ---------- Main menu ----------
  const nameInput = UI.$('nameInput');
  const codeInput = UI.$('codeInput');
  const menuHome = UI.$('menuHome');
  const menuJoin = UI.$('menuJoin');
  const menuError = UI.$('menuError');
  const joinError = UI.$('joinError');

  UI.$('btnShowJoin').addEventListener('click', () => {
    menuHome.hidden = true;
    menuJoin.hidden = false;
  });

  UI.$('btnBackToHome').addEventListener('click', () => {
    menuJoin.hidden = true;
    menuHome.hidden = false;
    UI.setError(joinError, null);
  });

  UI.$('btnCreate').addEventListener('click', async () => {
    UI.setError(menuError, null);
    const res = await emitAck('room:create', { name: nameInput.value });
    if (!res || !res.ok) return UI.setError(menuError, (res && res.error) || 'Failed to create room.');
    enterLobby(res);
  });

  UI.$('btnJoin').addEventListener('click', async () => {
    UI.setError(joinError, null);
    const res = await emitAck('room:join', { name: nameInput.value, code: codeInput.value });
    if (!res || !res.ok) return UI.setError(joinError, (res && res.error) || 'Failed to join room.');
    enterLobby(res);
  });

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
  });

  // Occasional subtle title glitch - flavor only, mirrors the "nothing is
  // fully stable" theme before the player even joins a game.
  const titleEl = UI.$('titleGlitch');
  setInterval(() => UI.glitchText(titleEl), 6000);

  // ---------- Lobby ----------
  function enterLobby(res) {
    currentRoom = res.room;
    myPlayerId = res.you.id;
    UI.$('roomCodeDisplay').textContent = res.room.code;
    UI.showScreen('screen-lobby');
    renderLobby(currentRoom);
  }

  function renderLobby(room) {
    currentRoom = room;
    const list = UI.$('playerList');
    list.innerHTML = '';
    room.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'player-list__item';
      li.innerHTML = `
        <span class="player-list__badge">${i + 1}</span>
        <span class="player-list__name">${escapeHtml(p.name)}</span>
        ${p.id === room.hostId ? '<span class="player-list__tag">HOST</span>' : ''}
      `;
      list.appendChild(li);
    });

    UI.$('playerCount').textContent = `${room.players.length} / ${room.maxPlayers}`;

    const statusPill = UI.$('lobbyStatus');
    const ready = room.players.length >= room.minPlayers;
    statusPill.textContent = ready ? 'READY TO START' : 'WAITING FOR PLAYERS';
    statusPill.className = `status-pill ${ready ? 'status-pill--ready' : 'status-pill--waiting'}`;

    const isHost = room.hostId === myPlayerId;
    const startBtn = UI.$('btnStart');
    startBtn.hidden = !isHost;
    startBtn.disabled = !ready;

    UI.$('lobbyHint').textContent = ready
      ? (isHost ? 'You may start the game when ready.' : 'Waiting for the host to start the game.')
      : `Minimum ${room.minPlayers} investigators required to begin.`;
  }

  UI.$('btnStart').addEventListener('click', async () => {
    const res = await emitAck('room:start', {});
    if (!res || !res.ok) alert((res && res.error) || 'Could not start game.');
  });

  UI.$('btnLeave').addEventListener('click', () => {
    window.location.reload();
  });

  UI.$('btnCopyCode').addEventListener('click', () => {
    if (currentRoom) navigator.clipboard.writeText(currentRoom.code).catch(() => {});
  });

  // ---------- Server-driven updates ----------
  socket.on('lobby:update', (room) => {
    if (!currentRoom || room.code !== currentRoom.code) return;
    renderLobby(room);
  });

  socket.on('room:countdown', ({ seconds }) => {
    const overlay = UI.$('countdownOverlay');
    overlay.hidden = false;
    UI.$('countdownNumber').textContent = seconds;
  });

  socket.on('game:started', () => {
    UI.$('countdownOverlay').hidden = true;
    UI.showScreen('screen-game');
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();

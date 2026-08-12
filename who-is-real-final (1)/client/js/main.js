// Main menu + lobby flow, plus session persistence so a page refresh
// mid-game can reconnect instead of losing the player's seat.

const SESSION = { roomCode: null, playerId: null, token: null, name: null };
const SESSION_KEY = 'whoisreal_session';

function saveSession() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(SESSION)); } catch (e) { /* storage unavailable - ok to skip */ }
}
function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearSession() {
  SESSION.roomCode = null; SESSION.playerId = null; SESSION.token = null; SESSION.name = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}

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

  // Occasional subtle title glitch - flavor only.
  const titleEl = UI.$('titleGlitch');
  setInterval(() => UI.glitchText(titleEl), 6000);

  // ---------- Lobby ----------
  function enterLobby(res) {
    currentRoom = res.room;
    myPlayerId = res.you.id;
    SESSION.roomCode = res.room.code;
    SESSION.playerId = res.you.id;
    SESSION.token = res.you.reconnectToken;
    SESSION.name = res.you.name;
    saveSession();

    UI.$('roomCodeDisplay').textContent = res.room.code;
    UI.$('gameRoomCode').textContent = res.room.code;

    if (res.room.state === 'LOBBY') {
      UI.showScreen('screen-lobby');
      renderLobby(currentRoom);
    } else {
      // Reconnected mid-game - game.js picks up rendering once
      // 'game:you' / 'game:phase' arrive right after this ack.
      UI.showScreen('screen-game');
    }
  }
  window.enterLobbySession = enterLobby; // used by the auto-reconnect check below

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
  window.renderLobbySession = renderLobby;

  UI.$('btnStart').addEventListener('click', async () => {
    const res = await emitAck('room:start', {});
    if (!res || !res.ok) alert((res && res.error) || 'Could not start game.');
  });

  UI.$('btnLeave').addEventListener('click', () => {
    clearSession();
    window.location.reload();
  });

  UI.$('btnReturnLobby').addEventListener('click', () => {
    // A finished game that nobody rematched - same as leaving.
    clearSession();
    window.location.reload();
  });

  UI.$('btnCopyCode').addEventListener('click', () => {
    if (currentRoom) navigator.clipboard.writeText(currentRoom.code).catch(() => {});
  });

  // ---------- Server-driven updates ----------
  socket.on('lobby:update', (room) => {
    if (!SESSION.roomCode || room.code !== SESSION.roomCode) return;
    currentRoom = room;
    if (room.state === 'LOBBY') renderLobby(room);
  });

  // Note: we deliberately do NOT clear SESSION on 'disconnect' here - a
  // network drop or tab reload should be reclaimable via the
  // 'player:reconnect' flow below, not treated as an intentional leave.

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- Auto-reconnect on load ----------
  const saved = loadSession();
  if (saved && saved.roomCode && saved.playerId && saved.token) {
    emitAck('player:reconnect', saved).then((res) => {
      if (res && res.ok) {
        Object.assign(SESSION, saved);
        enterLobby(res);
      } else {
        clearSession();
      }
    });
  }
})();

// Gameplay screen: HUD, phase-driven action panel (night kill / vote),
// chat, elimination results, and the game-over / rematch flow.
// Relies on SESSION (roomCode/playerId) set up in main.js.

(() => {
  const { socket, emitAck } = NET;

  const ROLE_LABEL = { CREW: 'PHI HÀNH ĐOÀN', IMPOSTER: 'KẺ GIẢ MẠO' };
  const PHASE_LABEL = {
    LOBBY: 'SẢNH CHỜ',
    STARTING: 'PHÂN VAI TRÒ',
    NIGHT: 'BAN ĐÊM',
    DISCUSSION: 'THẢO LUẬN',
    VOTING: 'BỎ PHIẾU',
    RESULT: 'KẾT QUẢ',
    GAME_OVER: 'KẾT THÚC',
  };

  let myRole = null;
  let teammates = [];
  let phase = null;
  let round = 0;
  let endsAt = null;
  let players = [];
  let countdownHandle = null;
  let noticeTimeout = null;

  function myId() { return SESSION.playerId; }
  function isAlive(id) {
    const p = players.find((x) => x.id === id);
    return !!(p && p.alive);
  }
  function amIAlive() { return isAlive(myId()); }

  // ---------------- role reveal ----------------

  socket.on('game:you', (payload) => {
    myRole = payload.role;
    teammates = payload.teammates || [];
  });

  // ---------------- phase updates (the authoritative game state) ----------------

  socket.on('game:phase', (state) => {
    phase = state.phase;
    round = state.round;
    endsAt = state.endsAt;
    players = state.players;

    UI.showScreen('screen-game');
    UI.$('gameRoomCode').textContent = SESSION.roomCode || '-----';
    UI.$('gameRound').textContent = `Vòng ${round}`;
    UI.$('gamePhaseLabel').textContent = PHASE_LABEL[phase] || phase;
    UI.$('gamePhaseLabel').className = `phase-pill phase-pill--${(phase || '').toLowerCase()}`;
    UI.$('aliveCount').textContent = `${players.filter((p) => p.alive).length} sống`;

    renderPlayerList();
    renderPhaseBody(state);
    startCountdown();
    updateChatAvailability();
  });

  function updateChatAvailability() {
    const canPublicChat = (phase === 'DISCUSSION' || phase === 'VOTING');
    const canImposterChat = (phase === 'NIGHT' && myRole === 'IMPOSTER' && amIAlive());
    const enabled = canPublicChat || canImposterChat;
    chatInput.disabled = !enabled;
    chatInput.placeholder = enabled
      ? (canImposterChat && !canPublicChat ? 'Chat riêng với đồng bọn...' : 'Nhắn tin...')
      : 'Chat không khả dụng lúc này';
  }

  function startCountdown() {
    if (countdownHandle) clearInterval(countdownHandle);
    const timerEl = UI.$('gameTimer');
    const tick = () => {
      if (!endsAt) { timerEl.textContent = '--'; return; }
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      timerEl.textContent = `${remaining}s`;
    };
    tick();
    countdownHandle = setInterval(tick, 250);
  }

  function renderPlayerList() {
    const list = UI.$('gamePlayerList');
    list.innerHTML = '';
    players.forEach((p) => {
      const li = document.createElement('li');
      li.className = `player-status-list__item ${p.alive ? '' : 'player-status-list__item--dead'}`;
      const you = p.id === myId() ? ' (Bạn)' : '';
      const conn = p.connected ? '' : ' · mất kết nối';
      li.innerHTML = `
        <span class="player-status-list__dot ${p.alive ? 'is-alive' : 'is-dead'}"></span>
        <span class="player-status-list__name">${escapeHtml(p.name)}${you}${conn}</span>
        ${p.alive ? '' : '<span class="player-status-list__tag">ĐÃ LOẠI</span>'}
      `;
      list.appendChild(li);
    });
  }

  function renderPhaseBody(state) {
    UI.$('roleBanner').hidden = true;
    UI.$('actionPanel').hidden = true;
    UI.$('voteProgress').hidden = true;
    UI.$('resultCard').hidden = true;
    UI.$('btnSkipVote').hidden = true;
    UI.$('actionFeedback').textContent = '';

    if (phase === 'STARTING') {
      renderRoleBanner();
    } else if (phase === 'NIGHT') {
      renderNightPanel();
    } else if (phase === 'VOTING') {
      renderVotePanel();
    } else if (phase === 'RESULT') {
      renderResultCard(state.lastElimination);
    }
    // DISCUSSION: nothing but chat + player list, both always visible.
  }

  function renderRoleBanner() {
    const banner = UI.$('roleBanner');
    banner.hidden = false;
    const roleEl = UI.$('roleBannerRole');
    roleEl.textContent = myRole ? ROLE_LABEL[myRole] : '???';
    roleEl.className = `role-banner__role ${myRole === 'IMPOSTER' ? 'role-banner__role--imposter' : 'role-banner__role--crew'}`;

    const teammatesEl = UI.$('roleBannerTeammates');
    if (myRole === 'IMPOSTER' && teammates.length > 0) {
      teammatesEl.textContent = `Đồng bọn của bạn: ${teammates.map((t) => t.name).join(', ')}`;
    } else if (myRole === 'IMPOSTER') {
      teammatesEl.textContent = 'Bạn hành động một mình.';
    } else {
      teammatesEl.textContent = 'Hãy quan sát kỹ và tìm ra kẻ giả mạo.';
    }
  }

  function renderNightPanel() {
    if (myRole !== 'IMPOSTER' || !amIAlive()) {
      pushNotice(amIAlive() ? 'Đêm xuống. Kẻ giả mạo đang hành động, hãy chờ...' : 'Bạn đã bị loại. Đang xem với tư cách khán giả.');
      return;
    }
    const panel = UI.$('actionPanel');
    panel.hidden = false;
    UI.$('actionPanelLabel').textContent = 'Chọn mục tiêu để loại bỏ:';
    const targets = players.filter((p) => p.alive && p.id !== myId() && !teammates.some((t) => t.id === p.id));
    renderTargets(targets, (targetId) => submitAction('game:night-kill', targetId, 'Đã chọn mục tiêu.'));
  }

  function renderVotePanel() {
    if (!amIAlive()) {
      pushNotice('Bạn đã bị loại và không thể vote.');
      UI.$('voteProgress').hidden = false;
      return;
    }
    const panel = UI.$('actionPanel');
    panel.hidden = false;
    UI.$('actionPanelLabel').textContent = 'Bỏ phiếu loại ai đó:';
    const targets = players.filter((p) => p.alive && p.id !== myId());
    renderTargets(targets, (targetId) => submitAction('game:vote', targetId, 'Đã ghi nhận phiếu bầu.'));

    const skipBtn = UI.$('btnSkipVote');
    skipBtn.hidden = false;
    skipBtn.onclick = () => submitAction('game:vote', 'SKIP', 'Đã chọn bỏ qua.');

    UI.$('voteProgress').hidden = false;
  }

  function renderTargets(targets, onPick) {
    const container = UI.$('actionTargets');
    container.innerHTML = '';
    targets.forEach((p) => {
      const btn = document.createElement('button');
      btn.className = 'target-btn';
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        container.querySelectorAll('.target-btn').forEach((b) => b.classList.remove('target-btn--selected'));
        btn.classList.add('target-btn--selected');
        onPick(p.id);
      });
      container.appendChild(btn);
    });
  }

  let actionInFlight = false;
  async function submitAction(event, targetId, successText) {
    if (actionInFlight) return; // don't let spam-clicking flood the server
    actionInFlight = true;
    UI.$('actionFeedback').textContent = 'Đang gửi...';
    const res = await emitAck(event, { targetId });
    actionInFlight = false;
    UI.$('actionFeedback').textContent = (res && res.ok) ? successText : ((res && res.error) || 'Hành động thất bại.');
  }

  function renderResultCard(elimination) {
    const card = UI.$('resultCard');
    card.hidden = false;
    if (!elimination) {
      card.innerHTML = `<div class="result-card__text">Không ai bị loại vòng này.</div>`;
      return;
    }
    const roleLabel = ROLE_LABEL[elimination.role] || elimination.role;
    card.innerHTML = `
      <div class="result-card__text">
        <b>${escapeHtml(elimination.name)}</b> đã bị loại.<br/>
        Họ là <span class="result-card__role">${roleLabel}</span>.
      </div>
    `;
  }

  // ---------------- notices ----------------

  socket.on('game:notice', ({ text }) => pushNotice(text));

  function pushNotice(text) {
    const el = UI.$('gameNotice');
    el.textContent = text;
    el.hidden = false;
    if (noticeTimeout) clearTimeout(noticeTimeout);
    noticeTimeout = setTimeout(() => { el.hidden = true; }, 6000);
  }

  // ---------------- vote progress ----------------

  socket.on('game:vote-progress', ({ voted, total }) => {
    const el = UI.$('voteProgress');
    el.hidden = false;
    el.textContent = `${voted} / ${total} người đã bỏ phiếu`;
  });

  // ---------------- chat ----------------

  const chatLog = UI.$('chatLog');
  const chatForm = UI.$('chatForm');
  const chatInput = UI.$('chatInput');

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatInput.disabled) return;
    const text = chatInput.value.trim();
    if (!text) return;
    const channel = (phase === 'NIGHT' && myRole === 'IMPOSTER') ? 'game:imposter-chat' : 'game:chat';
    socket.emit(channel, { text });
    chatInput.value = '';
  });

  socket.on('game:chat', (msg) => appendChat(msg, msg.alive === false ? 'chat-msg--dead' : ''));
  socket.on('game:imposter-chat', (msg) => appendChat(msg, 'chat-msg--imposter'));

  function appendChat(msg, extraClass) {
    const div = document.createElement('div');
    div.className = `chat-msg ${extraClass || ''}`;
    div.innerHTML = `<span class="chat-msg__name">${escapeHtml(msg.name)}:</span> ${escapeHtml(msg.text)}`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // ---------------- game over / rematch ----------------

  socket.on('game:over', (payload) => {
    if (countdownHandle) clearInterval(countdownHandle);
    renderGameOver(payload);
  });

  function renderGameOver(payload) {
    const overlay = UI.$('gameOverOverlay');
    overlay.hidden = false;
    UI.$('gameOverWinner').textContent = payload.winner === 'IMPOSTER' ? 'KẺ GIẢ MẠO CHIẾN THẮNG' : 'PHI HÀNH ĐOÀN CHIẾN THẮNG';

    const list = UI.$('gameOverResults');
    list.innerHTML = '';
    payload.results.forEach((r) => {
      const li = document.createElement('li');
      li.className = `gameover-results__item ${r.won ? 'gameover-results__item--won' : ''}`;
      li.innerHTML = `
        <span>${escapeHtml(r.name)}${r.id === myId() ? ' (Bạn)' : ''}</span>
        <span class="gameover-results__role">${ROLE_LABEL[r.role] || r.role}</span>
        <span class="gameover-results__outcome">${r.won ? 'THẮNG' : 'THUA'}</span>
      `;
      list.appendChild(li);
    });

    const rematchBtn = UI.$('btnRematch');
    const iAmHost = players.some((p) => p.id === myId() && p.isHost);
    rematchBtn.hidden = !iAmHost;
    rematchBtn.onclick = async () => {
      const res = await emitAck('room:rematch', {});
      if (!res || !res.ok) alert((res && res.error) || 'Không thể bắt đầu lại.');
    };
  }

  socket.on('game:reset', () => {
    UI.$('gameOverOverlay').hidden = true;
    myRole = null;
    teammates = [];
    phase = null;
    if (countdownHandle) clearInterval(countdownHandle);
    UI.showScreen('screen-lobby');
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
})();

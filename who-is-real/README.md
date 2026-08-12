# WHO IS REAL?

Game multiplayer social deduction: **CREW vs IMPOSTER**. Server-authoritative
hoàn toàn - client không quyết định vai trò, timer, kết quả vote, hay người thắng.

## Trạng thái: Lobby + Gameplay đầy đủ đã hoàn thành

Vòng đời trận đấu chạy trọn vẹn: **Lobby → đủ người → Start → phân vai trò →
NIGHT → DISCUSSION → VOTING → RESULT → (lặp lại hoặc GAME_OVER) → Play Again**.

## Chạy local

```
npm install
npm start
```

Mở `http://localhost:3000` ở nhiều tab (hoặc nhiều máy cùng mạng) để giả lập
nhiều người chơi.

**MIN_PLAYERS hiện tại = 4** (đã hạ từ 6 xuống 4 theo yêu cầu). Có thể chỉnh:

```
MIN_PLAYERS=4 npm start   # mặc định, không cần set
MIN_PLAYERS=1 npm start   # test một mình, mở thêm tab để giả lập người khác
MIN_PLAYERS=8 npm start   # ép yêu cầu đông người hơn nếu muốn
```

## 1. Những file đã thay đổi

**Server:**
- `server/game/GameState.js` — viết lại state machine: `LOBBY → STARTING →
  NIGHT → DISCUSSION → VOTING → RESULT → (NIGHT | GAME_OVER)`, và
  `GAME_OVER → LOBBY` cho rematch. Các state cũ (`COUNTDOWN`, `PLAYING`,
  `EVENT`, `BODY_FOUND`, `MEETING`) chưa từng có gameplay thật đằng sau nên
  được thay bằng vòng lặp round thật.
- `server/game/RoleSystem.js` **(mới)** — server tự quyết định vai trò
  (`assignRoles`), tỉ lệ ~1 imposter / 4 người chơi (tối thiểu 1, luôn ít hơn
  crew để phiếu bầu có ý nghĩa).
- `server/game/GameEngine.js` **(mới)** — bộ máy vòng chơi cho một room:
  quản lý phase, timer (server-side, gửi `endsAt` tuyệt đối), night-kill,
  vote, tie-break, và điều kiện thắng/thua.
- `server/game/Player.js` — thêm `reconnectToken` (bí mật, chỉ gửi cho chính
  chủ) và `disconnectedAt` để hỗ trợ reconnect.
- `server/game/Room.js` — `MIN_PLAYERS` mặc định đổi thành 4; thêm
  `activePlayers()` (còn sống + còn kết nối), `resetForRematch()`, và host
  promotion ưu tiên người còn kết nối.
- `server/server.js` — nối toàn bộ hệ thống lại: role assignment khi start,
  action `game:night-kill` / `game:vote`, chat `game:chat` /
  `game:imposter-chat`, `room:rematch`, `player:reconnect`, xử lý disconnect
  có grace period, và bind `0.0.0.0` + `process.env.PORT` cho Render.

**Client:**
- `client/index.html` — thay màn hình game placeholder bằng HUD thật (phase,
  timer, số người sống), action panel (chọn mục tiêu night-kill/vote), bảng
  kết quả, danh sách người chơi, khung chat, và overlay Game Over.
- `client/js/main.js` — thêm session persistence (`sessionStorage`) và
  auto-reconnect khi tải lại trang; bỏ toàn bộ logic đếm ngược giả cũ.
- `client/js/game.js` **(mới)** — toàn bộ logic màn chơi: role reveal, panel
  hành động theo phase, chat, thông báo, tổng kết Game Over, nút Play Again.
- `client/style.css` — thêm style cho HUD, action panel, chat, Game Over; và
  sửa lỗi CSS cũ khiến overlay luôn hiển thị bất kể `hidden` (đã báo trước đó).

## 2. Chức năng gameplay đã hoàn thành

- **Lobby**: danh sách người chơi realtime, đếm `x / y`, thông báo rõ khi
  chưa đủ 4 người, host có quyền start, chuyển host tự động khi host rời.
- **Role**: server phân vai trò (`CREW` / `IMPOSTER`), client không thể tự
  gán hay sửa vai trò của mình; imposter thấy đồng bọn, crew thì không.
- **Game state**: state machine tường minh, không có transition nào ngoài
  danh sách cho phép (mọi transition trái phép bị `throw`).
- **NIGHT**: imposter (chỉ imposter, chỉ khi còn sống) chọn mục tiêu; không
  thể chọn chính mình hay đồng bọn; nhiều imposter → lấy lựa chọn đa số,
  hòa thì không giết ai.
- **DISCUSSION**: chat công khai cho người còn sống; người đã chết chỉ
  chat được với người chết khác (không ảnh hưởng người sống).
- **VOTING**: mỗi người còn sống vote 1 lần (vote sau ghi đè vote trước),
  có nút SKIP, tự động kết thúc sớm khi tất cả đã vote, hiển thị số người
  đã vote (không lộ ai vote ai), xử lý hòa phiếu rõ ràng (không loại ai).
- **Timer**: server tính `endsAt` tuyệt đối cho mọi phase, client chỉ render
  đếm ngược từ đó - không client nào thấy số giây khác nhau.
- **Reconnect**: mỗi người chơi có `reconnectToken` bí mật; disconnect giữa
  trận có 60 giây grace period trước khi bị coi là rời hẳn; tải lại trang tự
  động cố gắng lấy lại chỗ ngồi qua `sessionStorage`.
- **Win/Lose**: CREW thắng khi hết imposter; IMPOSTER thắng khi số imposter
  còn sống ≥ số crew còn sống. Game dừng ngay khi có kết quả - không nhận
  action mới, dừng timer, gửi `game:over` cho mọi người kèm role thật của
  tất cả người chơi.
- **Game Over**: hiển thị người thắng, kết quả từng người (thắng/thua, vai
  trò thật), nút **CHƠI LẠI** (chỉ host) và **VỀ SẢNH CHỜ**.
- **Play Again**: `resetForRematch()` đưa room về `LOBBY`, xóa role/trạng
  thái sống-chết/vote của trận cũ, giữ nguyên người chơi - không cần tải lại
  trang, không tạo listener trùng lặp.
- **Security**: mọi action (night-kill, vote, start, rematch) được server
  validate theo phase hiện tại + trạng thái sống-chết + quyền hạn vai trò;
  client gửi action sai sẽ bị từ chối kèm lý do cụ thể (đã test - xem mục 5).

## 3. Minimum players hiện tại = **4**

Đã tìm và cập nhật thống nhất ở: `Room.js` (`MIN_PLAYERS` default),
`canStart()`, lobby UI (`renderLobby` trong `main.js`), và thông báo hiển
thị khi chưa đủ người.

## 4. Game flow hoàn chỉnh

```
LOBBY (đủ 4 người, host bấm Start)
  → STARTING (phân vai trò, 5s)
  → NIGHT (20s, imposter chọn mục tiêu)
  → DISCUSSION (45s, thảo luận + xem ai vừa bị giết)
  → VOTING (30s, bỏ phiếu, tự kết thúc sớm nếu đủ vote)
  → RESULT (8s, công bố kết quả + role người bị loại)
  → NIGHT vòng tiếp theo (nếu chưa ai thắng)
  → GAME_OVER (công bố người thắng + role tất cả)
  → Play Again → LOBBY → lặp lại
```

## 5. Lỗi đã phát hiện và sửa trong lần này

- State machine cũ (`COUNTDOWN → PLAYING`) không có bất kỳ gameplay thật nào
  phía sau - đã thay bằng vòng round đầy đủ.
- Không có `RoleSystem` nào tồn tại trước đó dù kiến trúc gốc có nhắc tới -
  đã tạo mới, server-authoritative hoàn toàn.
- Chưa từng có timer server-side thật (chỉ có đếm ngược 5s giả cho lobby) -
  đã thay bằng `endsAt` tuyệt đối cho mọi phase.
- Chưa có xử lý disconnect/reconnect mid-game - đã thêm grace period +
  reconnect token + session persistence.
- Chat công khai ban đầu không giới hạn theo phase (có thể chat cả lúc
  NIGHT) - đã giới hạn: public chat chỉ ở DISCUSSION/VOTING, imposter chat
  riêng chỉ ở NIGHT.
- (Từ trước) lỗi CSS khiến overlay luôn hiển thị bất kể thuộc tính `hidden`
  - đã sửa và áp dụng nhất quán cho overlay Game Over mới.

## 6. Cách chạy/test local

```
npm install
npm start
```

Mở ít nhất 4 tab trình duyệt tới `http://localhost:3000`, mỗi tab một tên
khác nhau: 1 tab **CREATE ROOM** (host), 3 tab còn lại **JOIN ROOM** bằng mã
phòng. Khi đủ 4 người, host bấm **START GAME** và chơi hết một trận. Test
thêm: đóng 1 tab giữa trận (xem grace period + thông báo mất kết nối), tải
lại 1 tab (xem có lấy lại được chỗ ngồi không), bỏ phiếu hòa (xem có loại
nhầm ai không), chơi tới khi có người thắng, bấm **CHƠI LẠI**.

## 7. Cần kiểm tra sau khi deploy Render

- Đảm bảo Start Command trên Render là `npm start` (đã set `engines.node`
  trong `package.json` để Render chọn đúng phiên bản Node).
- Server đã bind `0.0.0.0` và dùng `process.env.PORT` - không cần chỉnh gì
  thêm, nhưng nên xác nhận biến `PORT` Render tự cấp không bị override bởi
  biến môi trường nào khác bạn đã set thủ công.
- Nếu muốn hạ `MIN_PLAYERS` để demo nhanh trên bản deploy, set biến môi
  trường `MIN_PLAYERS` trong phần Environment của Render, không sửa code.
- Vì `RoomManager`/`Room`/`GameEngine` lưu toàn bộ state trong RAM của tiến
  trình Node, **Render free tier có thể sleep/restart instance sau một thời
  gian không có traffic** - khi đó mọi room đang mở sẽ mất. Đây là giới hạn
  của kiến trúc lưu-trong-bộ-nhớ, không phải lỗi code; nếu cần trận đấu tồn
  tại qua nhiều giờ không hoạt động thì cần thêm một lớp lưu trữ ngoài
  (Redis/DB), hiện chưa nằm trong phạm vi bản này.
- Sau khi deploy, thử đúng flow: tạo phòng → chia sẻ link Render (không phải
  `localhost`) → người khác join bằng mã phòng → chơi hết một trận.

## 8. Giới hạn đã biết (không giấu, nói rõ để tránh hiểu nhầm là bug)

- Lịch sử chat không được khôi phục khi reconnect (chỉ state/role/phase
  được đồng bộ lại) - tin nhắn cũ trong phiên đó sẽ không hiện lại.
- Chỉ có 2 phe (CREW/IMPOSTER) - các vai trò DETECTIVE/MIMIC/EXPERIMENT và
  hệ thống ký ức (memory corruption)/trust từ bản thiết kế gốc ban đầu
  **chưa được xây** trong lần hoàn thiện gameplay này; đây là bản social
  deduction đầy đủ nhưng ở dạng đơn giản hơn thiết kế gốc, có thể mở rộng
  thêm sau nếu cần.
- Chưa có bản đồ/di chuyển (Phase 3 trong roadmap ban đầu) - gameplay hiện
  tại chạy hoàn toàn theo phase/vote, không cần di chuyển trên map.

## Cấu trúc thư mục

```
who-is-real/
├── client/
│   ├── index.html
│   ├── style.css
│   └── js/
│       ├── main.js
│       ├── game.js
│       ├── socket.js
│       └── ui.js
├── server/
│   ├── server.js
│   └── game/
│       ├── GameState.js
│       ├── GameEngine.js
│       ├── RoleSystem.js
│       ├── Player.js
│       ├── Room.js
│       └── RoomManager.js
├── package.json
└── README.md
```

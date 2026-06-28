# Show HN / r/nextjs / r/webdev 초안 (영문)

> 채널: Show HN(news.ycombinator.com), 교차 게시: r/nextjs, r/webdev.
> 앵글: 서버 권위 + 결정론적 리플레이 동기화. 동시 유입 가능 → §4-A(상시 오픈) 권장.
> 게시 전: 머신 깨움 확인, 데모 GIF 최신 UI 일치 확인.

---

## Show HN 제목

`Show HN: A no-install party game where the server is the only source of truth`

## 본문 (HN)

I built a browser party game for deciding "who gets the penalty" at gatherings — no app install, just phones.

The host opens a room on the web, a QR code appears, and players scan to join (2–30 of them). One mini-game decides who loses, and **every phone replays the exact same animation at the same wall-clock time.**

Six games so far: a marble race, a "cheer-to-charge" marble race, a tilt/gyro marble, a tap-reaction race, and two quiz modes.

What was interesting to build:

- **The server is the only authority on the result.** Client input is never trusted as truth. The server computes the outcome from a seed up front, then broadcasts it once as a "replay track." Every client plays that same track on a shared wall-clock, so screens never diverge. Because it's not real-time frame streaming, bandwidth stays flat at input size even with 30 players.
- **Deterministic marble physics.** box2d-wasm + a seeded RNG: same seed → same result, every time. The server runs the sim once to lock the winner; clients just render it. (There's a fairness-check script in the repo.)
- **No database.** All room/player state lives in the server process memory (a `Map`). A restart wiping everything is the intended behavior — it's a one-shot party game, so persistence would only add cross-group isolation problems.
- **Single-instance hardening.** It runs on one small Fly VM (shared-cpu-1x / 512MB), so there's a global cap on concurrent rooms, a per-IP room-creation rate limit, and socket flood guards. Over the limit it degrades to 503/429 instead of OOMing.

Stack: Next.js 16 (App Router) + a custom Node server + Socket.IO on the same port, TypeScript. MIT licensed. The UI is Korean (it's a Korean drinking-game staple), but the mechanics are universal — try it on a phone.

- Live (phone recommended): https://bokbulbok-party.fly.dev
- Source: https://github.com/Mizeloble/bokbulbok-party

Happy to discuss the "server-authoritative + deterministic replay" approach to multiplayer sync.

---

## r/nextjs / r/webdev 변형 (제목 + 짧은 인트로)

**제목:** `Built a real-time multiplayer party game on Next.js 16 with a custom Node + Socket.IO server (no DB)`

**인트로:** Next.js 16 App Router with a custom `server.ts` that runs both the Next handler and Socket.IO on one port. Rooms live in process memory — no DB. The trick for sync: the server decides the result from a seed and broadcasts a replay track, so all clients render the same animation on a shared wall-clock instead of streaming frames. Source + live demo below. (이하 HN 본문 불릿 재사용.)

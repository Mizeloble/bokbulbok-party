# games/

게임은 플러그인. 기본형은 `<id>/server.ts`(서버 결과 결정) + `<id>/Renderer.tsx`(클라 재생) 한 쌍이지만, `GAME_META`의 `category`에 따라 붙는 게 다르다:

| category | 예시 | 추가로 필요한 것 |
| --- | --- | --- |
| `marble` (precompute) | marble, marble-cheer | server.ts + Renderer.tsx 한 쌍이면 끝 (정확히 위 패턴) |
| `live-marble` | marble-tilt | `computeResult` 대신 전용 실시간 러너 + `socket.ts` 라이브 분기 + 전용 Renderer |
| `reaction` | reaction | 진행 중 입력 수집 → 전용 round 모듈(`src/server/rounds/`) + `socket.ts` start 분기 |
| `quiz` | trivia, nonsense | **엔진은 trivia 한 벌 공유.** 신규 quiz 게임은 `questions.ts`(문제 풀) + `server.ts`(풀만 `computeQuizResult`에 주입)만 — Renderer·스코어·round 모듈 전부 재사용 |

`category` 헬퍼(`gameCategory`/`isQuizGame`/`isLiveGame`/`skipsResultGate`/`exposesReplayData`)가 위 분기들을 구동한다 — raw `gameId === '...'` 비교 금지.

## 새 게임 추가 순서
1. `types.ts`의 `GAME_META`에 메타데이터 등록 (`enabled: false`로 시작) + `i18n.ts`의 `games`에 라벨·estimate
2. `<id>/server.ts`에 `GameServerModule` 구현 — `computeResult`는 **순수 함수** (같은 입력 → 같은 출력). quiz 게임이면 trivia의 `computeQuizResult(input, pool)`에 자기 풀만 넘김
3. `src/server/game-runner.ts`의 `REGISTRY`에 매핑 추가
4. (기본형·live형만) `<id>/Renderer.tsx`에 React 컴포넌트 — props로 받은 `replay`만 보고 렌더 (네트워크 호출 X). quiz 게임은 TriviaRenderer 재사용
5. `RoomClient.tsx`에서 `gameId`/category별 분기에 추가. reaction·quiz·live는 `socket.ts` start 분기도 (quiz는 `QUIZ_POOLS`에 풀 등록)
6. 검증 끝나면 `enabled: true`

## 메타 플래그
- `needsClientInput: true` — 게임 *진행 중* 입력을 모음 (예: reaction의 `tapOffsets`).
- `needsPreCharge: true` — 게임 *시작 직전* 5초 탭 충전 페이즈 끼움 (예: marble-cheer). 입력은 `chargeRatios`로 `computeResult`에 전달됨. 페이즈 자체는 `src/server/socket.ts`가 자동 처리하므로 게임 모듈은 비율을 *해석*만 하면 됨.

## 금기
- `Renderer`에서 결과를 다시 계산하지 않기 — 서버 ranking이 진실.
- `computeResult` 안에서 `Date.now()`/전역 RNG 사용 금지. 전부 `seed` 인자로.

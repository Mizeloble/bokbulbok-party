# games/marble/

## 물리
[lazygyu/roulette](https://github.com/lazygyu/roulette) (MIT)의 box2d-wasm 기반.
원본은 `lazygyu/`(NOTICE 명시), 이 위에 결정성 RNG 주입.

## 진실의 원천
- 시뮬은 **서버에서만** (`sim.ts` → `server.ts`).
- 클라(`Renderer.tsx`)는 받은 리플레이 프레임 재생만. 자체 시뮬 X.
- 같은 `seed` + 같은 `players` (+ 선택적 `chargeRatios`) → 같은 `frames`.

## 공유
- `sim.ts`/`Renderer.tsx`는 `marble-cheer`도 그대로 재사용. `simulateRace(seed, players, chargeRatios?)`의 마지막 인자만 marble-cheer가 채움.
- `physics.createMarble(id, x, y, chargeRatio = 0)` 기본값 0이 marble의 기존 동작을 유지.

## 맵 (3종 공용)
- 맵은 `stages.ts`의 `STAGE_POOL`에서 라운드 seed로 선택(`pickStage`) — marble/marble-cheer/marble-tilt 셋 다 이 풀을 쓴다. 선택 RNG는 seed 파생 별도 스트림이라 본 시뮬의 rng 호출 순서(=seed 재현성)에 영향 없음.
- 새 맵 추가 시: 스폰 밴드(x 10.25~15.65, 응원 헤드스타트 포함 y ≤ ~8)를 벽으로 감싸고 장애물은 그 아래에서 시작. `stages.test.ts`의 완주 시뮬 테스트를 통과시킨 뒤 풀에 등록.
- `life > 0`(터지는 버블) 엔티티 금지 — 서버 물리에서만 파괴되고 클라는 시작 스냅샷을 계속 그려서 desync 난다.

## 데이터
- 120 FPS 시뮬, 미터 좌표
- 프레임당 마블 위치 배열 + 정적 엔티티 한 번만 전송
- socket.io 기본 압축

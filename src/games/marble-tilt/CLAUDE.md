# games/marble-tilt/

폰을 좌우로 기울여 자기 마블에 X축 힘을 가하는 **실시간 인터랙티브** 마블 레이스.
같은 트랙(`../marble/lazygyu/maps.ts`)·물리(`Box2dPhysics`)·렌더 헬퍼(`../marble/render/*`)를 재사용하되, 시뮬레이션 모델만 다르다.

## 결정론 예외

`src/games/CLAUDE.md`와 `src/server/CLAUDE.md`의 "결과는 한 번에 브로드캐스트, 실시간 스트리밍 X" 규칙의 **유일한 예외**다. 이 게임은:

- `computeResult`를 사용하지 않는다 (`server.ts`의 stub은 호출 시 throw).
- `src/server/rounds/marble-tilt.ts`의 `runMarbleTiltRound`(socket.ts `start` 핸들러가 호출)가 `MarbleTiltLiveSim`을 직접 인스턴스화해서 30 Hz로 위치 틱을 스트리밍한다.
- "같은 seed → 같은 결과"가 성립하지 않는다. 플레이어 입력이 결과를 좌우한다.
- 다시 보기 버튼은 비활성 (재생할 frames가 없음).

`marble`/`marble-cheer`는 결정론 경로 그대로 — 이 디렉토리는 그쪽을 절대 건드리지 않는다.

## 구성

- `liveSim.ts` — 60 Hz Box2D 스텝, 30 Hz 외부 emit, 플레이어별 tilt 힘 적용
- `Renderer.tsx` — `'marble:tick'` 구독, prev/latest 보간 후 `drawScene` 재사용
- `useGyro.ts` — DeviceOrientation 권한 + tare + throttle
- `TiltPermissionGate.tsx` — lobby에서 iOS 권한 제스처 받는 버튼
- `server.ts` — registry stub (실제 미사용)

## 입력

- 클라: `socket.emit('marble:tilt', { x })` — 정규화된 -1..1 범위, 50 ms 쓰로틀(20 Hz)
- 서버: `room.marbleTilt.sim.setTilt(playerToken, x)` — 250 ms stale 후 0으로 감쇠

## 튜닝

`liveSim.ts` 상단 const 블록에 모음 (TILT_FX, TILT_STALE_MS, INTERNAL_HZ, TICK_HZ 등).
실기 테스트 후 조정.

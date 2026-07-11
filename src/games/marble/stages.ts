// 공용 스테이지 풀 — marble / marble-cheer / marble-tilt 3종이 같은 풀에서 맵을 뽑는다.
//
// 선택은 seed에서 파생된 *별도* RNG 스트림(pickStage)으로만 한다. 본 시뮬의 rng
// 호출 순서/횟수를 건드리지 않아야 seed 재현성 계약(같은 seed + 같은 players →
// 같은 frames, sim.ts의 spawnMarbles 주석 참고)이 그대로 성립한다.
//
// lazygyu 포팅 맵(maps.ts)은 stages[0]만 스폰 밴드(x 10.25~15.65, y ≤ ~8)와
// 검증이 맞춰져 있어 풀에는 그것만 넣는다. 나머지 포팅 맵을 풀에 추가하려면
// stages.test.ts의 완주 시뮬 테스트를 그 맵으로도 통과시킨 뒤에 넣을 것.
import { mulberry32 } from '../../lib/rng';
import { stages } from './lazygyu/maps';
import type { StageDef } from './lazygyu/maps';
import type { MapEntity } from './lazygyu/MapEntity';

const wall = (points: [number, number][]): MapEntity => ({
  type: 'static',
  position: { x: 0, y: 0 },
  props: { density: 1, angularVelocity: 0, restitution: 0 },
  shape: { type: 'polyline', rotation: 0, points },
});

// 45° 다이아몬드 페그. width/height는 box2d SetAsBox의 half-extent (렌더러도 *2로 그림).
const peg = (x: number, y: number, half = 0.15): MapEntity => ({
  type: 'static',
  position: { x, y },
  props: { density: 1, angularVelocity: 0, restitution: 0 },
  shape: { type: 'box', width: half, height: half, rotation: Math.PI / 4 },
});

const spinner = (x: number, y: number, half: number, angularVelocity: number): MapEntity => ({
  type: 'kinematic',
  position: { x, y },
  props: { density: 1, angularVelocity, restitution: 0 },
  shape: { type: 'box', width: half, height: 0.1, rotation: 0 },
});

// 영구 바운스 범퍼. 주의: life>0(터지는 버블)는 서버 물리에서만 파괴되고 클라는
// 라운드 시작 스냅샷을 계속 그리므로(entities는 한 번만 전송) 시각 desync가 난다 —
// 리플레이 포맷에 pop 이벤트를 싣기 전까지 공용 맵에서 life 사용 금지.
const bumper = (x: number, y: number, radius = 0.5): MapEntity => ({
  type: 'static',
  position: { x, y },
  props: { density: 1, angularVelocity: 0, restitution: 1.5 },
  shape: { type: 'circle', radius },
});

// 지그재그 선반 → 페그 필드 → 스피너 줄 → 스플리터+범퍼 → 3레인 → 최종 게이트.
// 중앙선 x=12.875 기준 좌우 대칭 골격. 상단 벽(x 9.25/16.5)은 스폰 밴드
// (x 10.25~15.65, 응원 헤드스타트 포함 y ≤ ~8)를 감싸고, 장애물은 y ≥ 11부터 시작.
// 중간 페그 필드 구간(x 6~19.75)을 넓게 잡아 marble-tilt의 좌우 조향이 유효하게 했다.
const zigzagFalls: StageDef = {
  title: 'Zigzag Falls',
  goalY: 108,
  zoomY: 104,
  entities: [
    // 좌우 외벽 (스폰 상공 → 확장 → 수렴 → 골 채널)
    wall([
      [9.25, -300],
      [9.25, 30],
      [6, 36],
      [6, 58],
      [10, 68],
      [10, 95],
      [11.5, 103],
      [11.5, 112],
    ]),
    wall([
      [16.5, -300],
      [16.5, 30],
      [19.75, 36],
      [19.75, 58],
      [15.75, 68],
      [15.75, 95],
      [14.25, 103],
      [14.25, 112],
    ]),

    // 1) 지그재그 선반 — 좌→우→좌 폭포. 반대쪽 벽과 2m 이상 틈.
    wall([
      [9.25, 11],
      [14.3, 14.5],
    ]),
    wall([
      [16.5, 18],
      [11.7, 21.5],
    ]),
    wall([
      [9.25, 25],
      [14.3, 28.5],
    ]),

    // 2) 페그 필드 (확장 구간, 행마다 반 칸 오프셋)
    ...[38, 41, 44, 47, 50].flatMap((y, row) =>
      (row % 2 === 0
        ? [7.5, 9.5, 11.5, 13.5, 15.5, 17.5]
        : [8.5, 10.5, 12.5, 14.5, 16.5, 18.5]
      ).map((x) => peg(x, y)),
    ),

    // 3) 스피너 줄
    spinner(8.6, 54, 1.5, 3),
    spinner(12.875, 54, 1.5, -3),
    spinner(17.15, 54, 1.5, 3),

    // 4) 중앙 스플리터 + 좌우 바운스 범퍼
    peg(12.875, 63, 1.2),
    bumper(10.6, 66),
    bumper(15.15, 66),

    // 5) 3레인 — 입구 게이트 스피너 + 세로 분리대(윗단에 다이아 캡) + 레인별 페그
    spinner(10.95, 71.5, 0.5, 6),
    spinner(12.875, 71.5, 0.5, -6),
    spinner(14.8, 71.5, 0.5, 6),
    wall([
      [11.9, 74],
      [11.9, 84],
    ]),
    wall([
      [13.85, 74],
      [13.85, 84],
    ]),
    peg(11.9, 74, 0.2),
    peg(13.85, 74, 0.2),
    peg(10.95, 79),
    peg(12.875, 81),
    peg(14.8, 77),

    // 6) 골 앞 페그 3열
    ...[88, 91, 94].flatMap((y, row) =>
      (row % 2 === 0 ? [10.9, 12.5, 14.1] : [11.7, 13.3, 14.9]).map((x) => peg(x, y)),
    ),

    // 7) 최종 게이트 — 골 채널을 거의 가로막는 저속 스피너 (Wheel of fortune 결말부 패턴)
    spinner(12.875, 105.5, 0.8, -1.5),
  ],
};

export const STAGE_POOL: StageDef[] = [stages[0], zigzagFalls];

/** seed → 스테이지. 같은 seed는 항상 같은 스테이지 (marble/marble-cheer 결정론 유지). */
export function pickStage(seed: number): StageDef {
  const rng = mulberry32((seed ^ 0x51ab3c7d) >>> 0);
  return STAGE_POOL[Math.floor(rng() * STAGE_POOL.length)];
}

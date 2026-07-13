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

// V-퍼널 압축 → 스플리터 → 범퍼 핀볼 필드 → 대형 풍차 2기 S-위빙 → 다이아 계단
// (좌우 교대 강제 위빙) → 파친코 3핀 → 피날레 범퍼. 중앙선 x=12.875 기준.
// 상단 벽(x 9.25/16.5)은 스폰 밴드(x 10.25~15.65, 응원 헤드스타트 포함 y ≤ ~8)를
// 감싸고 장애물은 y ≥ 12부터. 넓은 범퍼 필드(x 6.5~19.75)와 풍차 좌우 우회로가
// marble-tilt 조향 구간이다.
//
// 벽 옆 장애물 원칙: 0 < 틈 < 마블 지름인 "막힘 슬롯" 금지 — 테이퍼 슬롯은 응원
// 마블(충전 시 지름 0.5→0.41)이 안착하는 쐐기 함정이 된다(anti-stuck 쉐이크로도
// 못 빠져나옴, 적대 검증에서 10 seed 중 9개 재현). 막을 거면 벽에 겹쳐 심어 틈을
// 0으로, 열 거면 ≥0.7m로.
const bumperCanyon: StageDef = {
  title: 'Bumper Canyon',
  goalY: 108,
  zoomY: 104,
  entities: [
    // 좌우 외벽 (스폰 상공 → 확장 → 수렴 → 골 채널)
    wall([
      [9.25, -300],
      [9.25, 12],
      [6.5, 22],
      [6.5, 52],
      [10, 66],
      [10, 90],
      [11.5, 97],
      [11.5, 112],
    ]),
    wall([
      [16.5, -300],
      [16.5, 12],
      [19.75, 22],
      [19.75, 52],
      [15.75, 66],
      [15.75, 90],
      [14.25, 97],
      [14.25, 112],
    ]),

    // 1) V-퍼널 — 전원을 중앙 1.3m 틈으로 압축한 뒤 스플리터로 좌우 분산
    wall([
      [9.25, 12],
      [12.225, 17],
    ]),
    wall([
      [16.5, 12],
      [13.525, 17],
    ]),
    peg(12.875, 20.5, 1.0),

    // 1.5) 전폭 2차 V-퍼널 — 스플리터로 흩어진 전원을 완만한 경사(41°)로 굴려
    // 재압축. 긴 롤링 + 재대기열이 이 맵의 주 감속 관문 (벽 부착, 틈 0).
    wall([
      [6.5, 22],
      [12.225, 27],
    ]),
    wall([
      [19.75, 22],
      [13.525, 27],
    ]),

    // 2) 범퍼 핀볼 필드 (확장 구간, 행마다 오프셋 — 세로 7m 간격으로 에너지 회복 여유)
    bumper(9, 32, 0.55),
    bumper(12.875, 32, 0.55),
    bumper(16.75, 32, 0.55),
    bumper(10.9, 39, 0.55),
    bumper(14.85, 39, 0.55),
    bumper(8.5, 46, 0.55),
    bumper(12.875, 46, 0.55),
    bumper(17.25, 46, 0.55),

    // 2.5) 범퍼 필드 하단 브레이크 페그 1열 (풍차 진입 전 감속)
    ...[9.9, 12.875, 15.85].map((x) => peg(x, 51)),

    // 3) 대형 풍차 3기 — 우→좌→우 교대 배치, 8m 구간 3단 S-위빙 (수렴 구간)
    spinner(14.3, 54, 1.6, -1.2),
    spinner(10.5, 58, 1.6, 1.2),
    spinner(14.3, 62, 1.6, -1.2),

    // 3.5) 2차 V-퍼널 — 풍차에서 흩어진 팩을 중앙 1.3m 틈으로 재압축 (메터링 관문).
    // 벽 부착(틈 0)이라 쐐기 슬롯 없음.
    wall([
      [10, 67],
      [12.225, 69.6],
    ]),
    wall([
      [15.75, 67],
      [13.525, 69.6],
    ]),

    // 4) 다이아 계단 — 좌우 교대로 채널을 막아 위빙 강제. 다이아를 벽에 겹쳐
    // 심어(대각 0.99 중 0.89 매립) 벽쪽 틈을 0으로 — 쐐기 함정 원칙 참고.
    peg(10.1, 71.5, 0.7),
    peg(15.65, 75, 0.7),
    peg(10.1, 78.5, 0.7),
    peg(15.65, 82, 0.7),

    // 5) 파친코 3열 — 계단 아래 자유낙하 구간을 채워 감속.
    // 벽쪽 포함 모든 틈 ≥ 0.7m (경사벽 최근접 거리 기준 0.68m)
    peg(10.95, 86),
    peg(12.875, 86),
    peg(14.8, 86),
    peg(11.9, 89.5),
    peg(13.85, 89.5),
    peg(11.55, 93),
    peg(12.875, 93),
    peg(14.2, 93),

    // 5.5) 골 채널 1차 게이트 — 최종 게이트와 반대 회전, 이중 메터링
    spinner(12.875, 99, 0.8, 1.5),

    // 6) 피날레 범퍼 — 골 직전 마지막 튕김 (좌우 틈 0.775m로 통과 여유)
    bumper(12.875, 103, 0.6),

    // 7) 최종 게이트 — 골 채널을 거의 가로막는 저속 스피너 (좌우 틈 0.575m,
    // Wheel of fortune·Zigzag Falls와 같은 결말 메터링 패턴)
    spinner(12.875, 106, 0.8, -1.5),
  ],
};

export const STAGE_POOL: StageDef[] = [stages[0], zigzagFalls, bumperCanyon];

/** seed → 스테이지. 같은 seed는 항상 같은 스테이지 (marble/marble-cheer 결정론 유지). */
export function pickStage(seed: number): StageDef {
  const rng = mulberry32((seed ^ 0x51ab3c7d) >>> 0);
  return STAGE_POOL[Math.floor(rng() * STAGE_POOL.length)];
}

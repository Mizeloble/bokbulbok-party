import { describe, it, expect } from 'vitest';
import { STAGE_POOL, pickStage } from './stages';
import { marbleServer } from './server';
import type { GameInputPlayer } from '../types';
import type { MarbleReplayData } from './server';

function players(...tokens: string[]): GameInputPlayer[] {
  return tokens.map((t) => ({ playerToken: t, nickname: t, color: '#fff' }));
}

// box2d-wasm 로드 + 실제 레이스 시뮬이 도는 테스트 — 기본 5초 타임아웃으로는 부족.
const SIM_TIMEOUT = 60_000;

/** 풀에서 원하는 스테이지를 뽑는 seed를 결정론적으로 찾는다 (pickStage는 순수함수). */
function seedForStage(stageIndex: number, from = 1): number {
  for (let seed = from; seed < from + 10_000; seed++) {
    if (pickStage(seed) === STAGE_POOL[stageIndex]) return seed;
  }
  throw new Error(`no seed found for stage ${stageIndex}`);
}

describe('pickStage', () => {
  it('is deterministic per seed', () => {
    for (const seed of [0, 1, 7, 42, 123456]) {
      expect(pickStage(seed)).toBe(pickStage(seed));
    }
  });

  it('reaches every stage in the pool across seeds', () => {
    const picked = new Set<string>();
    for (let seed = 0; seed < 200; seed++) picked.add(pickStage(seed).title);
    expect(picked.size).toBe(STAGE_POOL.length);
  });
});

// 신규 공용 스테이지 완주 검증 — 풀에 맵을 추가하면 여기 목록에도 title을 추가한다.
describe.each(['Zigzag Falls', 'Bumper Canyon'])('%s (new shared stage)', (title) => {
  const STAGE_INDEX = STAGE_POOL.findIndex((s) => s.title === title);

  it('is registered in the shared pool', () => {
    expect(STAGE_INDEX).toBeGreaterThanOrEqual(0);
  });

  it(
    'completes a 4-player race with a full ranking',
    async () => {
      const seed = seedForStage(STAGE_INDEX);
      const res = await marbleServer.computeResult({ seed, players: players('a', 'b', 'c', 'd'), loserCount: 1 });
      expect([...res.ranking].sort()).toEqual(['a', 'b', 'c', 'd']);
      expect(res.losers).toEqual(res.ranking.slice(-1));
      // 60초 타임아웃 컷(MAX_SECONDS)에 걸리지 않고 실제 완주로 끝나야 한다.
      expect(res.durationMs).toBeLessThan(60_000);
      const data = res.data as MarbleReplayData;
      // 새 맵의 goalY가 리플레이에 실려 나가는지 (클라 카메라/골 라인 기준값)
      expect(data.goalY).toBe(STAGE_POOL[STAGE_INDEX].goalY);
    },
    SIM_TIMEOUT,
  );

  it(
    'completes a 12-player race (party-size load) on a different seed',
    async () => {
      const seed = seedForStage(STAGE_INDEX, seedForStage(STAGE_INDEX) + 1);
      const tokens = Array.from({ length: 12 }, (_, i) => `p${i}`);
      const res = await marbleServer.computeResult({ seed, players: players(...tokens), loserCount: 1 });
      expect([...res.ranking].sort()).toEqual([...tokens].sort());
      expect(res.durationMs).toBeLessThan(60_000);
    },
    SIM_TIMEOUT,
  );
});

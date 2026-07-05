import { describe, it, expect } from 'vitest';
import { marbleServer } from './server';
import { marbleCheerServer } from '../marble-cheer/server';
import type { GameInputPlayer } from '../types';
import type { MarbleReplayData } from './server';

function players(...tokens: string[]): GameInputPlayer[] {
  return tokens.map((t) => ({ playerToken: t, nickname: t, color: '#fff' }));
}

const FOUR = players('a', 'b', 'c', 'd');
// box2d-wasm 로드 + 실제 레이스 시뮬이 도는 테스트 — 기본 5초 타임아웃으로는 부족.
const SIM_TIMEOUT = 60_000;

describe('marbleServer.computeResult', () => {
  it(
    'is deterministic: same seed + players → identical finishOrder and duration',
    async () => {
      const run1 = await marbleServer.computeResult({ seed: 42, players: FOUR, loserCount: 1 });
      const run2 = await marbleServer.computeResult({ seed: 42, players: FOUR, loserCount: 1 });
      expect(run1.ranking).toEqual(run2.ranking);
      expect(run1.durationMs).toBe(run2.durationMs);
      expect((run1.data as MarbleReplayData).frames).toEqual(
        (run2.data as MarbleReplayData).frames,
      );
    },
    SIM_TIMEOUT,
  );

  it(
    'ranks every player exactly once and losers are the tail of the ranking',
    async () => {
      const res = await marbleServer.computeResult({ seed: 7, players: FOUR, loserCount: 1 });
      expect([...res.ranking].sort()).toEqual(['a', 'b', 'c', 'd']);
      expect(res.losers).toEqual(res.ranking.slice(-1));
    },
    SIM_TIMEOUT,
  );

  it(
    'respects the loserCount boundary (n-1 losers = everyone but the winner)',
    async () => {
      const res = await marbleServer.computeResult({ seed: 7, players: FOUR, loserCount: 3 });
      expect(res.losers).toHaveLength(3);
      expect(res.losers).toEqual(res.ranking.slice(-3));
      expect(res.losers).not.toContain(res.ranking[0]);
    },
    SIM_TIMEOUT,
  );
});

describe('marbleCheerServer.computeResult', () => {
  it(
    'exposes chargeRatios aligned to playerOrder and stays deterministic',
    async () => {
      const chargeRatios = { a: 1, b: 0.5, c: 0, d: 0.25 };
      const input = { seed: 42, players: FOUR, loserCount: 1, chargeRatios };
      const run1 = await marbleCheerServer.computeResult(input);
      const run2 = await marbleCheerServer.computeResult(input);
      expect(run1.ranking).toEqual(run2.ranking);

      const data = run1.data as MarbleReplayData;
      expect(data.chargeRatios).toBeDefined();
      expect(data.chargeRatios).toHaveLength(FOUR.length);
      data.playerOrder.forEach((token, i) => {
        expect(data.chargeRatios![i]).toBe(chargeRatios[token as keyof typeof chargeRatios]);
      });
    },
    SIM_TIMEOUT,
  );
});

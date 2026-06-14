import { describe, it, expect } from 'vitest';
import { reactionServer } from './server';
import { GAME } from '../../lib/constants';
import type { GameInputPlayer } from '../types';

function players(...tokens: string[]): GameInputPlayer[] {
  return tokens.map((t) => ({ playerToken: t, nickname: t, color: '#fff' }));
}

// `GameServerModule.computeResult` is typed `ReplayPayload | Promise<ReplayPayload>`
// (marble's is async). Reaction's is synchronous, but we `await` so the type narrows.
describe('reactionServer.computeResult', () => {
  it('ranks taps fastest-first, then false starts, then no-taps', async () => {
    const res = await reactionServer.computeResult({
      seed: 1,
      players: players('a', 'b', 'c', 'd'),
      loserCount: 1,
      tapOffsets: {
        a: 120, // valid tap
        b: 300, // valid tap (slower)
        c: -50, // false start (before goAt)
        d: null, // no tap
      },
    });
    expect(res.ranking).toEqual(['a', 'b', 'c', 'd']);
    expect(res.losers).toEqual(['d']);
  });

  it('treats a sub-human-RT positive offset as a false start', async () => {
    const res = await reactionServer.computeResult({
      seed: 1,
      players: players('fast', 'slow'),
      loserCount: 1,
      tapOffsets: {
        fast: GAME.REACTION_MIN_HUMAN_RT_MS - 1, // flinch → false start
        slow: GAME.REACTION_MIN_HUMAN_RT_MS + 100, // legit tap → wins
      },
    });
    expect(res.ranking).toEqual(['slow', 'fast']);
  });

  it('ranks the earliest false-starter worst', async () => {
    const res = await reactionServer.computeResult({
      seed: 1,
      players: players('early', 'late'),
      loserCount: 1,
      tapOffsets: { early: -200, late: -10 },
    });
    // late (-10) flinched less → better; early (-200) is the worst.
    expect(res.ranking).toEqual(['late', 'early']);
    expect(res.losers).toEqual(['early']);
  });

  it('breaks no-tap ties by playerToken alphabetically (deterministic)', async () => {
    const res = await reactionServer.computeResult({
      seed: 1,
      players: players('zoe', 'amy'),
      loserCount: 1,
      tapOffsets: { zoe: null, amy: null },
    });
    expect(res.ranking).toEqual(['amy', 'zoe']);
  });

  it('is deterministic for the same seed (intro timing)', async () => {
    const input = { seed: 42, players: players('a', 'b'), loserCount: 1, tapOffsets: {} };
    const a = await reactionServer.computeResult(input);
    const b = await reactionServer.computeResult(input);
    expect(a.durationMs).toBe(b.durationMs);
    expect((a.data as { goAt: number }).goAt).toBe((b.data as { goAt: number }).goAt);
  });
});

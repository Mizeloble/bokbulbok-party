import type { ReplayPayload } from '../../server/rooms';
import type { ComputeResultInput, GameServerModule } from '../types';
import { simulateRace } from '../marble/sim';

/**
 * Same physics simulation as `marble`, but each marble's radius/density is nudged
 * by the player's charge ratio (0..1) collected during the pre-charge phase.
 * Determinism is preserved: identical seed + identical chargeRatios → identical frames.
 */
export const marbleCheerServer: GameServerModule = {
  async computeResult(input: ComputeResultInput): Promise<ReplayPayload> {
    const sim = await simulateRace(input.seed, input.players, input.chargeRatios);
    const losers = sim.finishOrder.slice(-input.loserCount);
    return {
      durationMs: sim.durationMs,
      ranking: sim.finishOrder,
      losers,
      data: sim,
    };
  },
};

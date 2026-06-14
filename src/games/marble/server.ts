import type { ReplayPayload } from '../../server/rooms';
import type { ComputeResultInput, GameServerModule } from '../types';
import { simulateRace, type SimulationResult } from './sim';

export type MarbleReplayData = SimulationResult;

export const marbleServer: GameServerModule = {
  // Simulation is async (box2d-wasm load) → returns a Promise. `computeResult`'s
  // declared return type allows `Promise<ReplayPayload>`, and game-runner awaits it.
  async computeResult(input: ComputeResultInput): Promise<ReplayPayload> {
    const sim = await simulateRace(input.seed, input.players);
    const losers = sim.finishOrder.slice(-input.loserCount);
    return {
      durationMs: sim.durationMs,
      ranking: sim.finishOrder,
      losers,
      data: sim,
    };
  },
};

// marble-tilt is a *live* game: results are produced by `MarbleTiltLiveSim`
// (see `./liveSim.ts`), not by a synchronous `computeResult` function. The
// runner is invoked directly from `src/server/socket.ts` (see `runMarbleTiltRound`)
// and the registry entry below exists only to satisfy `GameServerModule`'s shape.
// Do not call `computeResult` for this game — it will throw.

import type { GameServerModule } from '../types';

export const marbleTiltServer: GameServerModule = {
  computeResult() {
    throw new Error(
      'marble-tilt uses a live tick-driven runner (see src/games/marble-tilt/liveSim.ts), ' +
        'not the standard computeResult flow. Reached this path means socket.ts forgot to branch.',
    );
  },
};

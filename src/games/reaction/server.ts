import type { ReplayPayload } from '../../server/rooms';
import type { ComputeResultInput, GameIntroTimings, GameServerModule } from '../types';
import { GAME } from '../../lib/constants';
import { mulberry32 } from '../../lib/rng';

/**
 * Intro data baked into `replay.data` so clients (incl. mid-play reconnects)
 * know exactly when "지금!" lights up and when the tap window closes.
 *
 * `offsets` is empty during the intro broadcast and populated in the final
 * result broadcast so the result screen can display each player's reaction time.
 *   - positive number = ms after goAt (valid tap)
 *   - negative number = ms before goAt (false start)
 *   - null = no tap recorded (manual / disconnected mid-round)
 */
export type ReactionReplayData = {
  goAt: number;
  deadlineAt: number;
  offsets: Record<string, number | null>;
};

function pickGoAtOffset(seed: number): number {
  const rng = mulberry32(seed);
  const span = GAME.REACTION_PRE_GO_MAX_MS - GAME.REACTION_PRE_GO_MIN_MS;
  return GAME.REACTION_PRE_GO_MIN_MS + Math.floor(rng() * (span + 1));
}

export function prepareReactionIntro(seed: number): GameIntroTimings {
  const goAtOffsetMs = pickGoAtOffset(seed);
  const deadlineOffsetMs = goAtOffsetMs + GAME.REACTION_DEADLINE_MS;
  const durationMs = deadlineOffsetMs + GAME.REACTION_TAIL_MS;
  return { goAtOffsetMs, deadlineOffsetMs, durationMs };
}

type Bucket = 'tap' | 'falseStart' | 'noTap';

type Entry = {
  token: string;
  bucket: Bucket;
  // Within bucket, smaller sortKey = better rank.
  sortKey: number;
};

/**
 * Bucket order (best → worst): tap → falseStart → noTap.
 * Within `tap`: ascending offset (faster = better).
 * Within `falseStart`: descending negative-ness — i.e. the *earliest* false-starter
 *   is the worst. This makes early flinches the worst possible outcome.
 * Within `noTap` (incl. manual): playerToken alphabetical for deterministic tiebreak.
 */
function classify(token: string, offset: number | null | undefined): Entry {
  if (offset == null) {
    return { token, bucket: 'noTap', sortKey: 0 };
  }
  if (offset < GAME.REACTION_MIN_HUMAN_RT_MS) {
    // earlier (more negative or smaller) → worse → larger sortKey within bucket
    return { token, bucket: 'falseStart', sortKey: -offset };
  }
  return { token, bucket: 'tap', sortKey: offset };
}

const BUCKET_RANK: Record<Bucket, number> = { tap: 0, falseStart: 1, noTap: 2 };

export const reactionServer: GameServerModule = {
  computeResult(input: ComputeResultInput): ReplayPayload {
    const { seed, players, loserCount, tapOffsets } = input;

    const entries: Entry[] = players.map((p) => {
      const offset = tapOffsets ? tapOffsets[p.playerToken] : null;
      return classify(p.playerToken, offset);
    });

    entries.sort((a, b) => {
      const ba = BUCKET_RANK[a.bucket];
      const bb = BUCKET_RANK[b.bucket];
      if (ba !== bb) return ba - bb;
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return a.token < b.token ? -1 : a.token > b.token ? 1 : 0;
    });

    const ranking = entries.map((e) => e.token);
    const losers = ranking.slice(-loserCount);

    const intro = prepareReactionIntro(seed);
    const data: ReactionReplayData = {
      // socket.ts overwrites goAt/deadlineAt with absolute wall-clock values before
      // broadcast. Stored as offsets here so computeResult is fully self-describing
      // for tests. `offsets` flows straight through and is what the result screen reads.
      goAt: intro.goAtOffsetMs,
      deadlineAt: intro.deadlineOffsetMs,
      offsets: tapOffsets ?? {},
    };

    return {
      durationMs: intro.durationMs,
      ranking,
      losers,
      data,
    };
  },
  prepareIntro({ seed }) {
    return prepareReactionIntro(seed);
  },
};

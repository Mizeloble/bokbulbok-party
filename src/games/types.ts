import type { ReplayPayload } from '../server/rooms';

export type GameInputPlayer = {
  playerToken: string;
  nickname: string;
  color: string;
};

// Per-question answer captured by the server. Index = question position in schedule.
export type TriviaPerPlayerAnswers = Array<{ choice: 0 | 1 | 2 | 3; atOffsetMs: number } | null>;

export type ComputeResultInput = {
  seed: number;
  players: GameInputPlayer[];
  loserCount: number;
  // For client-input games (reaction): map of playerToken -> tap offset ms (from startAt)
  tapOffsets?: Record<string, number | null>;
  // For pre-charge games (marble-cheer): playerToken -> [0,1] charge ratio (tap count / cap)
  chargeRatios?: Record<string, number>;
  // For multi-question games (trivia): playerToken -> per-question answer array.
  triviaAnswers?: Record<string, TriviaPerPlayerAnswers>;
};

/**
 * Pre-play timing data for `needsClientInput` games. Returned by
 * `GameServerModule.prepareIntro` so socket.ts can broadcast `goAt`/`deadlineAt`
 * before tap collection begins. Offsets are relative to wall-clock `startAt`.
 */
export type GameIntroTimings = {
  goAtOffsetMs: number;
  deadlineOffsetMs: number;
  durationMs: number;
};

export type GameServerModule = {
  /** Deterministic given the same input. May be async (e.g. needs to load WASM). */
  computeResult(input: ComputeResultInput): ReplayPayload | Promise<ReplayPayload>;
  /**
   * Optional. For `needsClientInput` games (reaction), produces the deterministic
   * intro timings from a seed. Pure function — no Date.now()/global RNG.
   */
  prepareIntro?(args: { seed: number }): GameIntroTimings;
};

/**
 * Game category — the single source of truth for category-based behavior, so the
 * same `gameId === '...'` checks aren't re-spelled across the server, room client,
 * and result screen. Derive behavior from these via the helpers below, not from
 * raw id comparisons.
 *   - 'marble'      precomputed deterministic race (marble, marble-cheer) → MarbleRenderer
 *   - 'live-marble' real-time tilt-streamed race (marble-tilt)            → MarbleTiltRenderer
 *   - 'reaction'    single-tap reflex                                     → ReactionRenderer
 *   - 'quiz'        4-choice quiz engine (trivia, nonsense)               → TriviaRenderer
 */
export type GameCategory = 'marble' | 'live-marble' | 'reaction' | 'quiz';

// Technical metadata only. Display label lives in `ko.games[id]` (i18n).
// `needsPreCharge: true` makes the server insert a 5s tap-charging phase before sim runs.
// `needsClientInput: true` is reserved for games that collect input *during* play (reaction).
// Disabled (enabled:false) games carry a placeholder `category` — it's never read
// since they can't be selected or run.
export const GAME_META = {
  marble: {
    emoji: '🏁',
    estimatedSeconds: 35,
    category: 'marble',
    needsClientInput: false,
    needsPreCharge: false,
    enabled: true,
  },
  'marble-cheer': {
    emoji: '📣',
    estimatedSeconds: 40,
    category: 'marble',
    needsClientInput: false,
    needsPreCharge: true,
    enabled: true,
  },
  'marble-tilt': {
    emoji: '📱',
    estimatedSeconds: 35,
    category: 'live-marble',
    // Live device-orientation input streamed during play. The runner is bespoke
    // (lives in src/games/marble-tilt/liveSim.ts and is invoked directly from
    // socket.ts), not the standard `computeResult`-based reaction/trivia flow,
    // so this flag is informational rather than routed through prepareIntro.
    needsClientInput: true,
    needsPreCharge: false,
    enabled: true,
  },
  slot: {
    emoji: '🎰',
    estimatedSeconds: 8,
    category: 'marble',
    needsClientInput: false,
    needsPreCharge: false,
    enabled: false,
  },
  elimination: {
    emoji: '🎯',
    estimatedSeconds: 20,
    category: 'marble',
    needsClientInput: false,
    needsPreCharge: false,
    enabled: false,
  },
  reaction: {
    emoji: '⚡',
    estimatedSeconds: 6,
    category: 'reaction',
    needsClientInput: true,
    needsPreCharge: false,
    enabled: true,
  },
  trivia: {
    emoji: '🧠',
    estimatedSeconds: 30,
    category: 'quiz',
    needsClientInput: true,
    needsPreCharge: false,
    enabled: true,
  },
  // Same engine as trivia (4-choice quiz, speed+combo scoring, live standings) —
  // only the question pool & tone differ. Reuses trivia's plan/score/Renderer.
  nonsense: {
    emoji: '🤪',
    estimatedSeconds: 30,
    category: 'quiz',
    needsClientInput: true,
    needsPreCharge: false,
    enabled: true,
  },
} as const;

export type GameId = keyof typeof GAME_META;

/** The category discriminant for a game — drives renderer choice and round behavior. */
export function gameCategory(gameId: GameId): GameCategory {
  return GAME_META[gameId].category;
}

// Quiz-family games share the trivia engine end to end (4-choice quiz,
// speed+combo scoring, TriviaReplayData replay shape) — only the question pool
// differs. Server pool selection lives in socket.ts (QUIZ_POOLS).
export function isQuizGame(gameId: GameId): boolean {
  return gameCategory(gameId) === 'quiz';
}

// Live games stream positions in real time from a bespoke runner (marble-tilt's
// MarbleTiltLiveSim) instead of the standard precomputed `computeResult` replay.
// They have no replayable frames, so result screens hide the "다시 보기" action
// and reconnects rely on the live `marble:tick` stream.
export function isLiveGame(gameId: GameId): boolean {
  return gameCategory(gameId) === 'live-marble';
}

// reaction + quiz: the round has nothing to "watch" once it ends, so the client
// flips straight to the result screen instead of holding behind a tap-to-continue
// gate (marble/marble-tilt keep the gate so the loser-reveal fanfare can land).
export function skipsResultGate(gameId: GameId): boolean {
  const c = gameCategory(gameId);
  return c === 'reaction' || c === 'quiz';
}

// reaction + quiz: their `replay.data` is small intro/schedule metadata, safe to
// embed in `state` broadcasts for mid-play reconnects. Marble's frame data is
// large and stays out of state (shipped once via `game:start`).
export function exposesReplayData(gameId: GameId): boolean {
  const c = gameCategory(gameId);
  return c === 'reaction' || c === 'quiz';
}

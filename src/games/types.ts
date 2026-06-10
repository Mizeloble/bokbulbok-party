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

// Technical metadata only. Display label lives in `ko.games[id]` (i18n).
// `needsPreCharge: true` makes the server insert a 5s tap-charging phase before sim runs.
// `needsClientInput: true` is reserved for games that collect input *during* play (reaction).
export const GAME_META = {
  marble: {
    emoji: '🏁',
    estimatedSeconds: 35,
    needsClientInput: false,
    needsPreCharge: false,
    enabled: true,
  },
  'marble-cheer': {
    emoji: '📣',
    estimatedSeconds: 40,
    needsClientInput: false,
    needsPreCharge: true,
    enabled: true,
  },
  'marble-tilt': {
    emoji: '📱',
    estimatedSeconds: 35,
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
    needsClientInput: false,
    needsPreCharge: false,
    enabled: false,
  },
  elimination: {
    emoji: '🎯',
    estimatedSeconds: 20,
    needsClientInput: false,
    needsPreCharge: false,
    enabled: false,
  },
  reaction: {
    emoji: '⚡',
    estimatedSeconds: 6,
    needsClientInput: true,
    needsPreCharge: false,
    enabled: true,
  },
  trivia: {
    emoji: '🧠',
    estimatedSeconds: 30,
    needsClientInput: true,
    needsPreCharge: false,
    enabled: true,
  },
  // Same engine as trivia (4-choice quiz, speed+combo scoring, live standings) —
  // only the question pool & tone differ. Reuses trivia's plan/score/Renderer.
  nonsense: {
    emoji: '🤪',
    estimatedSeconds: 30,
    needsClientInput: true,
    needsPreCharge: false,
    enabled: true,
  },
} as const;

export type GameId = keyof typeof GAME_META;

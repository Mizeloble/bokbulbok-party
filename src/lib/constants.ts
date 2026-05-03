// Single source of truth for time/length thresholds shared between server, store, and components.
// Group by domain. Always include the unit in the name (`_MS`, `_COUNT`).

export const ROOM = {
  /** Drop a room after this much idle time. */
  IDLE_MS: 10 * 60_000,
  /** Hold a disconnected player's slot before evicting (handles tab backgrounding / reconnect). */
  RECONNECT_GRACE_MS: 10_000,
  /** Auto-redirect a stuck `result`-screen tab back to landing after this idle window. */
  IDLE_REDIRECT_MS: 3 * 60_000,
} as const;

export const GAME = {
  COUNTDOWN_MS: 3000,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 30,
  /** Inclusive bounds for the host's loser-count selector. */
  LOSER_COUNT_MIN: 1,
  LOSER_COUNT_MAX: 3,
  /** Pre-charge phase length for games with `needsPreCharge` (e.g. marble-cheer). */
  CHARGE_MS: 5000,
  /** Server-side broadcast cadence of aggregate charge totals during charging. */
  CHARGE_TICK_MS: 250,
  /** Per-player tap cap during the charge phase. Anti-macro. */
  CHARGE_TAP_CAP: 50,
  /** Default charge ratio for manual (no-phone) players. */
  CHARGE_MANUAL_DEFAULT: 0.5,
  /** Reaction game: minimum offset before "GO!" before the goAt mark. */
  REACTION_PRE_GO_MIN_MS: 1500,
  /** Reaction game: maximum offset before "GO!". seed picks deterministically in [MIN, MAX]. */
  REACTION_PRE_GO_MAX_MS: 3500,
  /** Reaction game: window after goAt to accept taps. */
  REACTION_DEADLINE_MS: 1500,
  /** Reaction game: anything below this is treated as a false start (catches reflex 0..50ms guesses). */
  REACTION_MIN_HUMAN_RT_MS: 80,
  /** Reaction game: post-deadline buffer before broadcasting result, lets last in-flight tap arrive. */
  REACTION_TAIL_MS: 600,
  /** Trivia game: number of questions per round. */
  TRIVIA_QUESTION_COUNT: 5,
  /** Trivia game: maximum time window per question (read + answer). When all
   * connected non-manual players answer earlier, the server short-circuits and
   * advances immediately, so this is the upper bound — typical play is faster. */
  TRIVIA_QUESTION_MS: 6000,
  /** Trivia game: post-question reveal phase showing the correct answer + the
   * mid-round leaderboard inline. Length tuned so players have time to (1) see
   * if they got it right, (2) read the +N toast, (3) glance at the standings —
   * all in the same screen without a jarring context switch. */
  TRIVIA_REVEAL_MS: 2000,
  /** Trivia game: tail buffer between the end of the last reveal and the result broadcast. */
  TRIVIA_TAIL_MS: 600,
  /** Trivia scoring: minimum points for a correct answer (answered at the buzzer). */
  TRIVIA_SCORE_BASE: 500,
  /** Trivia scoring: maximum points for a correct answer (answered instantly). */
  TRIVIA_SCORE_MAX: 1000,
  /** Trivia scoring: per-step combo bonus added per consecutive correct beyond the first. */
  TRIVIA_COMBO_BONUS: 100,
  /** Trivia scoring: combo bonus caps at this many consecutive correct answers. */
  TRIVIA_COMBO_CAP: 5,
  /** Trivia scoring: multiplier applied to the LAST question's score (double-or-nothing finale). */
  TRIVIA_LAST_QUESTION_MULT: 2,
} as const;

export const NICKNAME = {
  MAX_LENGTH: 10,
} as const;

export const UI = {
  /** Countdown "시작!" badge linger time. */
  FLASH_MS: 700,
  /** Countdown number spring-in duration. */
  SPRING_MS: 220,
  /** Replay-the-same-race delay before re-mounting the renderer. */
  REPLAY_LEAD_MS: 1500,
} as const;

/** Marble color palette assigned in player join order. */
export const MARBLE_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b',
  '#10b981', '#a855f7',
] as const;

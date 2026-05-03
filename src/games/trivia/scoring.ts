// Shared scoring formula. Imported by both server.ts (authoritative) and
// Renderer.tsx (instant +N toast / mid-round leaderboard preview). Pure functions
// only — no Date.now / RNG. Server result is always the source of truth.

import { GAME } from '../../lib/constants';

export type QuestionScoreInput = {
  /** Whether the player's pick matched correctIndex. */
  isCorrect: boolean;
  /** Server-captured answer arrival ms relative to this question's openAt. Ignored if !isCorrect. */
  atOffsetMs: number;
  /** Combo length BEFORE this question (consecutive correct answers up to and excluding this one). */
  comboBefore: number;
  /** True for the round's last question — score is multiplied for the finale. */
  isLastQuestion: boolean;
};

export type QuestionScoreOutput = {
  /** Final points awarded for this question (0 on wrong/no-answer). */
  score: number;
  /** Speed-only portion before combo and finale multiplier (for UI breakdown). */
  speedScore: number;
  /** Combo bonus portion before finale multiplier (for UI breakdown). */
  comboBonus: number;
  /** Combo length AFTER this question (0 if wrong, comboBefore+1 if correct). */
  comboAfter: number;
};

/**
 * Per-question score. Wrong or no answer = 0 and combo resets.
 *
 * Formula:
 *   speedScore = BASE + (MAX - BASE) × (timeRemaining / questionWindow)
 *   comboBonus = min(comboBefore, COMBO_CAP - 1) × COMBO_BONUS
 *   raw = speedScore + comboBonus
 *   final = isLastQuestion ? raw × LAST_QUESTION_MULT : raw
 *
 * Examples (BASE=500, MAX=1000, BONUS=100, CAP=5, MULT=2x, window=8000ms):
 *   - Instant correct, no combo: 1000 + 0 = 1000
 *   - Buzzer-beater correct, no combo: 500 + 0 = 500
 *   - Mid-time correct after 2 in a row: ~750 + 200 = 950
 *   - Last-question instant correct after 4 in a row: (1000 + 400) × 2 = 2800
 */
export function scoreQuestion(input: QuestionScoreInput): QuestionScoreOutput {
  if (!input.isCorrect) {
    return { score: 0, speedScore: 0, comboBonus: 0, comboAfter: 0 };
  }

  const window = GAME.TRIVIA_QUESTION_MS;
  const remaining = Math.max(0, Math.min(window, window - input.atOffsetMs));
  const speedScore =
    GAME.TRIVIA_SCORE_BASE +
    Math.round((GAME.TRIVIA_SCORE_MAX - GAME.TRIVIA_SCORE_BASE) * (remaining / window));

  const cappedCombo = Math.min(input.comboBefore, GAME.TRIVIA_COMBO_CAP - 1);
  const comboBonus = cappedCombo * GAME.TRIVIA_COMBO_BONUS;

  const raw = speedScore + comboBonus;
  const score = input.isLastQuestion ? raw * GAME.TRIVIA_LAST_QUESTION_MULT : raw;

  return {
    score,
    speedScore,
    comboBonus,
    comboAfter: input.comboBefore + 1,
  };
}

/**
 * Walk a player's full answer log through the scoring formula. Returns per-question
 * cumulative totals (length === questions.length) plus the running combo state.
 * Used by the server to produce mid-round leaderboard snapshots and by the client
 * to sanity-check its instant toast against eventual server truth.
 */
export function computeRunningScores(
  answers: ReadonlyArray<{ choice: 0 | 1 | 2 | 3; atOffsetMs: number } | null>,
  correctIndices: ReadonlyArray<0 | 1 | 2 | 3>,
): { perQuestion: QuestionScoreOutput[]; cumulative: number[]; total: number } {
  const perQuestion: QuestionScoreOutput[] = [];
  const cumulative: number[] = [];
  let combo = 0;
  let total = 0;

  for (let i = 0; i < correctIndices.length; i++) {
    const ans = answers[i];
    const isCorrect = ans != null && ans.choice === correctIndices[i];
    const result = scoreQuestion({
      isCorrect,
      atOffsetMs: ans?.atOffsetMs ?? 0,
      comboBefore: combo,
      isLastQuestion: i === correctIndices.length - 1,
    });
    combo = result.comboAfter;
    total += result.score;
    perQuestion.push(result);
    cumulative.push(total);
  }

  return { perQuestion, cumulative, total };
}

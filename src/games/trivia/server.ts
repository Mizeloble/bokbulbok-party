import type { ReplayPayload } from '../../server/rooms';
import type { ComputeResultInput, GameServerModule } from '../types';
import { GAME } from '../../lib/constants';
import { mulberry32 } from '../../lib/rng';
import { TRIVIA_POOL_SORTED } from './questions';
import { computeRunningScores } from './scoring';

/**
 * Structural shape every quiz question must satisfy. Both trivia and nonsense
 * pools are assignable to this (their narrower `category` unions widen to string),
 * so the plan/score engine below stays content-agnostic and is shared by both games.
 */
export type QuizQuestion = {
  id: string;
  category: string;
  question: string;
  choices: readonly [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  note?: string;
};

/**
 * Replay payload broadcast on game:start. Carries everything the client needs to
 * render every question + reveal phase deterministically off wall-clock.
 *
 * `correctIndex` is the *post-shuffle* position. Choices are also already shuffled.
 * Both are server-authoritative; client never recomputes.
 *
 * `cumulativeScores` is filled in at result time (computeResult) and is empty in
 * the broadcast at game:start — the client doesn't need it during the answer phase
 * and exposing per-player ranking mid-round would leak who's ahead before reveal.
 * Mid-round leaderboard rendering uses the client's local prediction (which mirrors
 * the same `scoring.ts` formula), and the result screen uses the authoritative
 * snapshot here.
 */
export type TriviaReplayData = {
  schedule: {
    /** ms offsets from startAt — when each question becomes interactive. */
    openAtOffsets: number[];
    /** ms offsets from startAt — when the answer window closes / reveal begins. */
    closeAtOffsets: number[];
  };
  questions: Array<{
    id: string;
    category: string;
    question: string;
    choices: [string, string, string, string];
    correctIndex: 0 | 1 | 2 | 3;
    /** Optional "did you know?" line for the result-screen detail view. */
    note?: string;
  }>;
  /**
   * Per-player cumulative score timeline: scores[playerToken][qIndex] = total
   * points after question qIndex (inclusive). Empty {} during the in-game broadcast,
   * populated only in the result. Used by ResultScreen to display final scores.
   */
  scores: Record<string, number[]>;
  /**
   * Per-player per-question picks (post-shuffle choice index, or null = no answer).
   * Empty {} during the in-game broadcast — exposing this mid-round would spoil
   * everyone's answers. Populated only in the result, where it powers the
   * "특이점" detail panel ("everyone got it right except…", or vice versa).
   */
  picks: Record<string, Array<0 | 1 | 2 | 3 | null>>;
};

/**
 * Draw `count` questions without replacement, spreading across categories so a
 * single round doesn't land 4-5 questions of the same flavor. A category may fill
 * at most ~60% of the round (3 of 5); if the pool is too small or too skewed to
 * honor that, a second pass fills the remaining slots ignoring the cap, so the
 * round is always `min(count, pool.length)` questions.
 */
function pickQuestions(
  rng: () => number,
  count: number,
  sortedPool: readonly QuizQuestion[],
): QuizQuestion[] {
  const pool = [...sortedPool];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const n = Math.min(count, pool.length);
  const cap = Math.max(1, Math.ceil(n * 0.6));
  const picked: QuizQuestion[] = [];
  const pickedIds = new Set<string>();
  const perCategory = new Map<string, number>();
  for (const q of pool) {
    if (picked.length >= n) break;
    const used = perCategory.get(q.category) ?? 0;
    if (used >= cap) continue;
    picked.push(q);
    pickedIds.add(q.id);
    perCategory.set(q.category, used + 1);
  }
  for (const q of pool) {
    if (picked.length >= n) break;
    if (!pickedIds.has(q.id)) picked.push(q);
  }
  return picked;
}

function shuffleChoices(
  rng: () => number,
  question: QuizQuestion,
): { choices: [string, string, string, string]; correctIndex: 0 | 1 | 2 | 3 } {
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  const choices = order.map((idx) => question.choices[idx]) as [string, string, string, string];
  const correctIndex = order.indexOf(question.correctIndex) as 0 | 1 | 2 | 3;
  return { choices, correctIndex };
}

/**
 * Build the complete intro/replay schedule from a seed. Pure — no Date.now / global RNG.
 * The quiz round (`rounds/quiz.ts`) calls this directly to ship the schedule in the
 * `game:start` replay; `computeResult` rebuilds the same payload at result time so no
 * state leaks through.
 *
 * Determinism: a single rng stream consumed in fixed order — pickQuestions first,
 * then per-question shuffleChoices. Add new rng consumers only at the end to keep
 * existing seed→output mappings stable.
 */
export function buildQuizPlan(
  seed: number,
  sortedPool: readonly QuizQuestion[],
): {
  questions: Omit<TriviaReplayData, 'scores'>['questions'];
  schedule: TriviaReplayData['schedule'];
  durationMs: number;
} {
  const rng = mulberry32(seed);
  const picks = pickQuestions(rng, GAME.TRIVIA_QUESTION_COUNT, sortedPool);

  const questions = picks.map((q) => {
    const { choices, correctIndex } = shuffleChoices(rng, q);
    return {
      id: q.id,
      category: q.category,
      question: q.question,
      choices,
      correctIndex,
      ...(q.note ? { note: q.note } : {}),
    };
  });

  const openAtOffsets: number[] = [];
  const closeAtOffsets: number[] = [];
  let cursor = 0;
  for (let i = 0; i < questions.length; i++) {
    openAtOffsets.push(cursor);
    cursor += GAME.TRIVIA_QUESTION_MS;
    closeAtOffsets.push(cursor);
    cursor += GAME.TRIVIA_REVEAL_MS;
  }
  const durationMs = cursor + GAME.TRIVIA_TAIL_MS;

  return {
    questions,
    schedule: { openAtOffsets, closeAtOffsets },
    durationMs,
  };
}

type Entry = {
  token: string;
  total: number;
  cumulative: number[];
  // Sum of atOffsetMs for *correct* answers only. Defensive tie-break for
  // sub-ms-equal scores; primary ranking is by total points.
  speedSum: number;
};

/**
 * Pool-agnostic result computation shared by trivia and nonsense. Same input
 * shape; the only difference between the two games is which `sortedPool` is passed.
 */
export function computeQuizResult(
  input: ComputeResultInput,
  sortedPool: readonly QuizQuestion[],
): ReplayPayload {
  const { seed, players, loserCount, triviaAnswers } = input;
  const plan = buildQuizPlan(seed, sortedPool);
  const correctIndices = plan.questions.map((q) => q.correctIndex);

  const entries: Entry[] = players.map((p) => {
    const answers = triviaAnswers?.[p.playerToken] ?? [];
    const { cumulative, total } = computeRunningScores(answers, correctIndices);
    let speedSum = 0;
    for (let i = 0; i < plan.questions.length; i++) {
      const ans = answers[i];
      if (ans && ans.choice === correctIndices[i]) speedSum += ans.atOffsetMs;
    }
    return { token: p.playerToken, total, cumulative, speedSum };
  });

  entries.sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total; // higher score = better
    if (a.speedSum !== b.speedSum) return a.speedSum - b.speedSum; // faster = better
    return a.token < b.token ? -1 : a.token > b.token ? 1 : 0;
  });

  const ranking = entries.map((e) => e.token);
  const losers = ranking.slice(-loserCount);

  const scores: Record<string, number[]> = {};
  for (const e of entries) scores[e.token] = e.cumulative;

  // Pull per-player picks straight from the input answer log (already in
  // post-shuffle index space). Used by the result-screen "특이점" panel.
  const picks: Record<string, Array<0 | 1 | 2 | 3 | null>> = {};
  for (const p of players) {
    const ans = triviaAnswers?.[p.playerToken] ?? [];
    picks[p.playerToken] = plan.questions.map((_, i) => ans[i]?.choice ?? null);
  }

  const data: TriviaReplayData = {
    schedule: plan.schedule,
    questions: plan.questions,
    scores,
    picks,
  };

  return {
    durationMs: plan.durationMs,
    ranking,
    losers,
    data,
  };
}

export const triviaServer: GameServerModule = {
  computeResult(input: ComputeResultInput): ReplayPayload {
    return computeQuizResult(input, TRIVIA_POOL_SORTED);
  },
  // No prepareIntro: the quiz round bakes the schedule into the game:start replay
  // directly (see rounds/quiz.ts), so it never goes through prepareGameIntro.
};

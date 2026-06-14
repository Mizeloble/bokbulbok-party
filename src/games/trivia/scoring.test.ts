import { describe, it, expect } from 'vitest';
import { scoreQuestion, computeRunningScores } from './scoring';
import { GAME } from '../../lib/constants';

describe('scoreQuestion', () => {
  it('awards max points for an instant correct answer (no combo)', () => {
    const r = scoreQuestion({ isCorrect: true, atOffsetMs: 0, comboBefore: 0, isLastQuestion: false });
    expect(r.speedScore).toBe(GAME.TRIVIA_SCORE_MAX);
    expect(r.comboBonus).toBe(0);
    expect(r.score).toBe(GAME.TRIVIA_SCORE_MAX);
    expect(r.comboAfter).toBe(1);
  });

  it('awards base points for a buzzer-beater correct answer', () => {
    const r = scoreQuestion({
      isCorrect: true,
      atOffsetMs: GAME.TRIVIA_QUESTION_MS,
      comboBefore: 0,
      isLastQuestion: false,
    });
    expect(r.speedScore).toBe(GAME.TRIVIA_SCORE_BASE);
    expect(r.score).toBe(GAME.TRIVIA_SCORE_BASE);
  });

  it('returns zero and resets combo on a wrong answer', () => {
    const r = scoreQuestion({ isCorrect: false, atOffsetMs: 0, comboBefore: 4, isLastQuestion: false });
    expect(r.score).toBe(0);
    expect(r.comboBonus).toBe(0);
    expect(r.comboAfter).toBe(0);
  });

  it('adds combo bonus scaled by prior streak', () => {
    const r = scoreQuestion({ isCorrect: true, atOffsetMs: 0, comboBefore: 2, isLastQuestion: false });
    expect(r.comboBonus).toBe(2 * GAME.TRIVIA_COMBO_BONUS);
    expect(r.score).toBe(GAME.TRIVIA_SCORE_MAX + 2 * GAME.TRIVIA_COMBO_BONUS);
  });

  it('caps the combo bonus at COMBO_CAP - 1 steps', () => {
    const r = scoreQuestion({ isCorrect: true, atOffsetMs: 0, comboBefore: 99, isLastQuestion: false });
    expect(r.comboBonus).toBe((GAME.TRIVIA_COMBO_CAP - 1) * GAME.TRIVIA_COMBO_BONUS);
  });

  it('multiplies the final score on the last question', () => {
    const r = scoreQuestion({ isCorrect: true, atOffsetMs: 0, comboBefore: 4, isLastQuestion: true });
    const raw = GAME.TRIVIA_SCORE_MAX + Math.min(4, GAME.TRIVIA_COMBO_CAP - 1) * GAME.TRIVIA_COMBO_BONUS;
    expect(r.score).toBe(raw * GAME.TRIVIA_LAST_QUESTION_MULT);
  });

  it('never produces a negative speed score for late/overshot offsets', () => {
    const r = scoreQuestion({
      isCorrect: true,
      atOffsetMs: GAME.TRIVIA_QUESTION_MS * 5,
      comboBefore: 0,
      isLastQuestion: false,
    });
    expect(r.speedScore).toBe(GAME.TRIVIA_SCORE_BASE);
  });
});

describe('computeRunningScores', () => {
  it('tracks combo across questions and resets it on a miss', () => {
    const correct = [0, 0, 0, 0] as const;
    const answers = [
      { choice: 0 as const, atOffsetMs: 0 }, // correct
      { choice: 0 as const, atOffsetMs: 0 }, // correct (combo 1 → bonus)
      { choice: 1 as const, atOffsetMs: 0 }, // wrong → reset
      { choice: 0 as const, atOffsetMs: 0 }, // correct, last question → ×mult
    ];
    const { perQuestion, cumulative, total } = computeRunningScores(answers, correct);

    expect(perQuestion[0].comboAfter).toBe(1);
    expect(perQuestion[1].comboAfter).toBe(2);
    expect(perQuestion[1].comboBonus).toBe(1 * GAME.TRIVIA_COMBO_BONUS);
    expect(perQuestion[2].score).toBe(0);
    expect(perQuestion[2].comboAfter).toBe(0);
    // Last question: combo reset to 0, instant correct → MAX × mult.
    expect(perQuestion[3].score).toBe(GAME.TRIVIA_SCORE_MAX * GAME.TRIVIA_LAST_QUESTION_MULT);

    expect(cumulative[cumulative.length - 1]).toBe(total);
    expect(total).toBe(
      perQuestion.reduce((sum, q) => sum + q.score, 0),
    );
  });

  it('treats null (no answer) as a miss', () => {
    const correct = [0, 0] as const;
    const { total, perQuestion } = computeRunningScores([null, null], correct);
    expect(total).toBe(0);
    expect(perQuestion.every((q) => q.score === 0)).toBe(true);
  });
});

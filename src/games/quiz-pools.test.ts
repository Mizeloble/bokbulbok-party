import { describe, it, expect } from 'vitest';
import { TRIVIA_POOL } from './trivia/questions';
import { NONSENSE_POOL } from './nonsense/questions';

// 카피 규칙(questions.ts 헤더 주석: question ~40자, choices 모바일 한 줄, note ≤80자)의
// 회귀 방지용 하드 리밋. 현행 풀 최대치(question 44 / choice 14 / note 60)에
// 약간의 여유만 둔 값 — 이 한도를 넘기면 모바일에서 줄바꿈이 일어난다.
const MAX_QUESTION = 48;
const MAX_CHOICE = 16;
const MAX_NOTE = 80;

const POOLS = [
  { name: 'trivia', pool: TRIVIA_POOL },
  { name: 'nonsense', pool: NONSENSE_POOL },
] as const;

describe.each(POOLS)('$name question pool', ({ pool }) => {
  it('has unique ids', () => {
    const ids = pool.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every question has 4 distinct choices and a valid correctIndex', () => {
    for (const q of pool) {
      expect(q.choices, q.id).toHaveLength(4);
      expect(new Set(q.choices).size, q.id).toBe(4);
      expect([0, 1, 2, 3], q.id).toContain(q.correctIndex);
    }
  });

  it('fits the mobile one-line copy limits', () => {
    for (const q of pool) {
      expect(q.question.length, `${q.id} question`).toBeLessThanOrEqual(MAX_QUESTION);
      for (const c of q.choices) {
        expect(c.length, `${q.id} choice "${c}"`).toBeLessThanOrEqual(MAX_CHOICE);
      }
      if (q.note) expect(q.note.length, `${q.id} note`).toBeLessThanOrEqual(MAX_NOTE);
    }
  });
});

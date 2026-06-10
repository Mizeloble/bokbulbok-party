# games/nonsense/

넌센스 퀴즈 = trivia와 동일한 4지선다 퀴즈 게임. **메커니즘·스코어·Renderer·소켓 플로우를 전부 trivia에서 재사용**하고 이 디렉터리는 **문제 풀(`questions.ts`)만 소유**한다. (marble-cheer가 marble을 재사용하는 패턴)

## 재사용하는 trivia 엔진
- `server.ts`는 trivia의 `computeQuizResult(input, pool)` / `prepareQuizIntro(seed, pool)` 순수 함수에 `NONSENSE_POOL_SORTED`만 넘김.
- 채점·결정성(`buildQuizPlan`)·점수 공식(`scoring.ts`)·`TriviaReplayData` 타입·`Renderer.tsx` 모두 콘텐츠 무관 → 변경 없이 공유.
- 소켓 진행은 `src/server/socket.ts`의 공용 `runQuizRound`가 `room.gameId`로 풀(`QUIZ_POOLS`)을 골라 처리. `trivia:answer`/`trivia:standings`/`trivia:reschedule` 이벤트와 `room.trivia` 상태를 trivia와 공용으로 씀.

## 결정성·진실의 원천
- trivia/CLAUDE.md와 동일. 답변 도착 시각은 **서버 도착 시각만** 신뢰, 문제당 첫 답만 기록, ranking은 `computeQuizResult` 안에서만 결정.
- `Math.random()`/`Date.now()`를 `computeResult`/`prepareIntro`에서 호출 금지 — 전부 `seed`로.

## 문제 풀 추가
1. [questions.ts](questions.ts)의 `NONSENSE_POOL`에 새 항목 append. `id`는 kebab-case, 안 겹치게.
2. 톤: 말장난·언어유희 + 재치/상황추론(엉뚱한 논리). 정치·종교·민감 주제 제외.
3. `question` ~40자, `choices` 각 ~10자(모바일 한 줄). 정답 외 3개는 그럴싸한 함정.
4. 답이 한 번에 안 와닿는 문항은 `note`로 한 줄 해설(≤80자).

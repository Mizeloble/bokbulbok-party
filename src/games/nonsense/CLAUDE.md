# games/nonsense/

넌센스 퀴즈 = trivia와 동일한 4지선다 퀴즈 게임. **메커니즘·스코어·Renderer·소켓 플로우를 전부 trivia에서 재사용**하고 이 디렉터리는 **문제 풀(`questions.ts`)만 소유**한다. (marble-cheer가 marble을 재사용하는 패턴)

## 재사용하는 trivia 엔진
- `server.ts`는 trivia의 `computeQuizResult(input, pool)` 순수 함수에 `NONSENSE_POOL_SORTED`만 넘김.
- 채점·결정성(`buildQuizPlan`)·점수 공식(`scoring.ts`)·`TriviaReplayData` 타입·`Renderer.tsx` 모두 콘텐츠 무관 → 변경 없이 공유.
- 소켓 진행은 `src/server/socket.ts`의 공용 `runQuizRound`가 `room.gameId`로 풀(`QUIZ_POOLS`)을 골라 처리. `trivia:answer`/`trivia:standings`/`trivia:reschedule` 이벤트와 `room.trivia` 상태를 trivia와 공용으로 씀.

## 결정성·진실의 원천
- trivia/CLAUDE.md와 동일. 답변 도착 시각은 **서버 도착 시각만** 신뢰, 문제당 첫 답만 기록, ranking은 `computeQuizResult` 안에서만 결정.
- `Math.random()`/`Date.now()`를 `computeResult`에서 호출 금지 — 전부 `seed`로.

## 문제 풀 추가 — 입고 게이트
새 문항은 [questions.ts](questions.ts)의 `NONSENSE_POOL` 끝에 append(`id`는 kebab-case, 유일하게). 형식 규칙(`question` ~40자, `choices` 각 ~10자, `note` ≤80자)에 더해 **아래 5개 게이트를 전부 통과해야 한다** — 2026-07 큐레이션에서 풀 절반을 덜어낸 원인이 전부 이 게이트 위반이었다:

1. **정답이 실제 통용되는 말장난·단어일 것.** 이 풀을 위해 지어낸 조어(예: "개굴대학교", "아이쿠밤") 금지 — 듣고도 안 웃긴다.
2. **정답 공개 순간 note 없이도 납득될 것.** note로 정당화해야만 성립하는 문항은 탈락. 단순 사실 문답("겨울에 세상을 하얗게 하는 것 → 눈")도 넌센스가 아니므로 탈락.
3. **오답 3개가 정답과 경합하지 않을 것.** 여러 보기가 다 말이 되면(복수 정답) 뽑기 게임이 된다.
4. **답변 시간 6초(`TRIVIA_QUESTION_MS`) 안에 읽고 웃을 수 있을 것.** 다단계 논리퍼즐(물통 계량, 끈 태우기류) 금지 — 전제 뒤집기 한 방("모세의 방주"류)까지만.
5. **기존 문항과 소재·템플릿·정답이 겹치지 않을 것.** 같은 정답 재사용은 `quiz-pools.test.ts`가 잡는다(숫자형 답 제외). 같은 템플릿("X가 깜짝 놀라면?")의 남발은 리뷰로 거른다.

톤: 가볍고 누구나 웃는 파티 톤. 정치·종교·민감 주제 제외. 카테고리는 `말장난` | `재치` 둘뿐(구 `상황추론`은 6초 포맷과 안 맞아 폐지, 통과분은 `재치`로 흡수).

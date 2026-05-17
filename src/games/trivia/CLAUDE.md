# games/trivia/

## 진실의 원천
- 모든 답변 도착 시각은 **서버 도착 시각만 사용**. 클라가 보낸 timestamp 신뢰 안 함. payload는 `{ qIndex, choice }`만.
- 문제당 첫 답만 기록. 같은 `qIndex`에 두 번째 답 오면 무시.
- ranking은 `computeResult` 안에서만 결정. Renderer는 받은 `schedule`/`questions`만 보고 페이즈 분기.

## 결정성
- `buildTriviaPlan(seed)` — mulberry32 단일 스트림으로 (1) 풀에서 N문제 비복원 추출, (2) 각 문제 보기 4개 셔플. 같은 seed면 항상 같은 문제·같은 보기 순서.
- 풀(`TRIVIA_POOL`)은 `id` 사전순(`TRIVIA_POOL_SORTED`)으로 정렬한 뒤 추출. 풀 끝에 새 문제를 추가해도 기존 id의 추출 매핑은 안 깨짐.
- 동률 tie-break: 점수 DESC → 정답 응답속도 합 ASC → `playerToken` 사전순.

## 페이즈
- 문제별 `[openAt, closeAt)` 윈도우 안에서만 답 수락. 그 외 무시.
- 클라이언트 문제 노출/정답 공개는 `replay.data.schedule`(서버 권위) 기반 wall-clock으로 자동 분기.

## 금기
- `Math.random()` / `Date.now()`를 `prepareIntro`/`computeResult`/`buildTriviaPlan`에서 호출 금지.
- 클라가 보낸 timestamp를 ranking에 직접 반영 금지.
- `trivia:answer` payload에 timestamp 추가 금지 (스푸핑 방지).
- Renderer에서 정답 재계산 / 점수 재계산을 ranking에 사용 금지. 서버 ranking이 진실.

## 문제 풀 추가
1. [questions.ts](questions.ts)의 `TRIVIA_POOL`에 새 항목 append.
2. `id`는 kebab-case, 다른 항목과 안 겹치게.
3. 가볍고 무난한 톤 유지: 정치·종교·민감 주제 제외. 사내/회사·시사성 정보는 노화 위험 → 제외.
4. `question` ~40자, `choices` 각 ~20자(모바일 한 줄).

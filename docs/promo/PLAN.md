# 복불복 무료 홍보 기획서

> 위치: `docs/promo/PLAN.md` · 이 문서는 Claude Code가 읽고 실행하는 작업 명세를 겸한다.

## 0. 한 줄 결론

유료 마케팅은 하지 않는다. 무료 채널에 한 번씩 정성껏 던지고, **실사용 1회를 포트폴리오용으로 박제**한다. 단, 링크를 뿌리는 동안에는 서버가 즉시 떠 있어야 한다(§4).

## 1. 목적 / 비(非)목적

**목적**
- 개발자 대상 기술 신뢰도 노출 (GeekNews / Show HN)
- 면접(NVIDIA TPM 등)용 "설치 없이 실시간 멀티플레이" 실사용 증거 확보
- 비용 0에 가깝게 (런치 기간 상시가동 소액은 예외로 허용)

**안 하는 것 (명시적 비목적)**
- 유료 광고 (메타/구글/틱톡 DR, 애드핏 최적화)
- 도메인 구매 (선택 사항으로만, 기본은 fly.dev URL)
- 영구 상시가동 (런치 기간만 켜고 끝나면 scale-to-zero 복귀)
- DAU/리텐션 KPI 그로스 캠페인
- 에브리타임(학생 아님), 블라인드(인증·자기홍보 반감) — 제외

## 2. 성공 기준

- [ ] 면접용 실사용 증거 1건: 스크린샷 + 참가자 수 + "DB 없이 단일 인스턴스" 한 줄
- [ ] GeekNews 1건 게시 + 반응 관찰
- [ ] Show HN 또는 r/nextjs 1건 게시
- 수치 목표(DAU·재방문)는 설정하지 않는다. 같은 그룹이 두 번 켤 이유가 설계상 없으므로 리텐션은 평가 대상이 아니다.

## 3. 채널별 액션 (전부 무료)

| 채널 | 무엇을 | 산출물 | 비고 |
| --- | --- | --- | --- |
| GeekNews (news.hada.io) | 기술 스토리 글 | `drafts/geeknews.md` | 1순위. 동시 유입 가능 → §4-A 권장 |
| Show HN / r/nextjs / r/webdev | 영문 기술 글 | `drafts/show-hn.md` | 서버 권위 물리 앵글. 동시 유입 가능 |
| 디시·아카라이브·더쿠 / 본인 SNS·단톡방 | GIF + 링크 한 줄 | `drafts/communities.md` | 메이커 톤. 일회성이면 §4-B로 충분 |
| 다음 모임/술자리 | 호스트로 직접 1회 실행 | (스크린샷) | 실사용 박제 + 자연 노출 동시 |

## 4. 사전 준비 (런치 레디니스)

**원칙: 클릭하는 순간 서버가 떠 있어야 한다.** 콜드스타트로 첫 방문자가 빈 화면/지연을 먹으면 홍보가 역효과. 상시가동 방식을 먼저 정한다.

### 4-A. 상시 오픈 — 동시 유입 채널(GeekNews/HN)에 권장
- `fly.toml`: `auto_stop_machines = "off"`, `min_machines_running = 1`
- 비용: shared-cpu-1x 512MB 1대 24/7 = 소액(월 몇 달러 수준 추정, **현재 Fly 요금은 직접 확인**). 버스트 첫인상 값으로 정당화됨.
- **런치 종료 후 다시 `"stop"` 으로 되돌려** scale-to-zero 복귀 → 평소 비용 0 근접. 즉 "며칠치"만 낸다.

### 4-B. 무료 유지 — 일회성 커뮤니티 글에 충분
- `fly.toml` 그대로(`"stop"`). 글 올리기 직전 본인이 URL 한 번 열어 깨워둔다(30초).
- 단 GeekNews/HN처럼 동시 유입 가능성 있는 곳엔 비권장.
- (선택) `.github/workflows/warmup.yml` 로 런치 시간대만 핑. 공개 레포라 Actions 무료.
  주의: 핑으로 계속 깨우면 결국 상시가동과 같은 런타임 비용. "상시"가 목적이면 4-A가 정직하다. 이 워크플로는 **글 올리기 직전 수동 트리거(workflow_dispatch)** 용도로만 권장.

### 4-C. 코드·설정 점검 (전부 무료 — Claude Code 처리)

> 점검 결과 (2026-06-28, 코드/배포 확인 기준):

- [x] OG/트위터 메타가 링크 카드로 정상 렌더 (`src/app/`)
  - `layout.tsx`에 OpenGraph + `twitter:summary_large_image` 메타, `metadataBase = NEXT_PUBLIC_SITE_URL`. `opengraph-image.tsx`가 1200×630 카드 자동 생성(Pretendard 폰트 주입으로 한글 안 깨짐). repo var `SITE_URL = https://bokbulbok-party.fly.dev` 확인. → 코드상 정상. **실제 카드는 배포본 URL을 카카오/X/Slack 디버거에 한 번 넣어 눈으로 최종 확인 권장.**
- [x] `ALLOWED_ORIGIN` 시크릿이 실제 배포 URL과 일치 (`fly secrets list`)
  - `fly secrets list` → `ALLOWED_ORIGIN` `Deployed`. 배포 호스트 = `bokbulbok-party.fly.dev`. (Fly는 시크릿 값을 해시로만 노출 — 원문 비교 불가. 프로덕션 소켓이 동작 중이면 일치하는 것; 불일치면 소켓 CORS가 거부돼 게임이 안 됨.)
- [x] 스파이크 가드 켜짐: `ROOM.MAX_ROOMS` 상한 + 프로덕션 IP 레이트리밋(429)
  - `MAX_ROOMS=10` 전역 동시 방 상한(초과 `POST /api/rooms` → 503). 프로덕션 IP 레이트리밋 `ROOM_CREATE_MAX=5 / 60s` → 429. 추가로 소켓 레이트(`SOCKET_RATE`: hot/ctrl/connect), 미입장 방 빠른 GC(`UNCLAIMED_MS=90s`), 인바운드 버퍼 8KB 캡. 512MB 단일 인스턴스 OOM 방지 충분.
- [x] 헬스 체크 경로 존재(핑/상시가동 점검용)
  - **없었음 → `server.ts`에 `/healthz` 추가함** (Next 핸들러 앞에서 200 `ok` 반환, 룸 상태 미접촉). 핑/워밍업/업타임 점검용.
- [ ] 데모 GIF가 현재 UI와 일치 (`node scripts/capture-demo.mjs <marble|trivia>`)
  - `docs/demo-marble.gif`·`docs/demo-trivia.gif` 존재(2026-05-17~18 생성, 현재 앱 v2.6.0). 코드로는 UI 일치 여부 판단 불가 → **눈으로 확인 필요.** 어긋나면 `node scripts/capture-demo.mjs marble|trivia` 후 ffmpeg 재합성.
- [x] 배포 URL 확정 → 모든 draft의 `TODO(배포 URL)` 채움
  - `https://bokbulbok-party.fly.dev` 로 확정, 3개 draft 전부 반영 완료.

### 4-D. 런치 중 운영 규칙
- 홍보 글 올린 시간대엔 **배포(deploy) 금지.** 메모리 전용이라 재배포 = 진행 중 방 전멸. (단, `/healthz` 추가분은 런치 *전에* 미리 배포해 둘 것.)
- 첫 1~2시간은 머신 메모리/룸 수 한 번 눈으로 확인.

## 5. Claude Code 실행

레포 루트에서 `claude` 실행 후:
```
docs/promo/PLAN.md 읽고:
1) §4-C 코드·설정 점검 항목을 코드로 확인하고 결과를 체크박스에 반영
2) §6 미완료 산출물(draft) 초안을 실제 스택과 대조해 보강 — 내가 안 만든 기능 언급 금지, 과장 금지
3) §4-A/4-B는 내가 고를 테니, 내가 고른 쪽 fly.toml 설정값만 알려줘
```
완료 기준: draft가 (a) 실제 코드와 일치, (b) URL 채워짐, (c) 복붙 가능. §4-C 체크박스가 코드 확인 결과로 갱신됨.

## 6. 산출물 체크리스트

- [x] `drafts/geeknews.md` — 스택 검증, URL 채움
- [x] `drafts/show-hn.md` — 영문, URL 채움
- [x] `drafts/communities.md` — 채널별 한 줄, GIF 경로 확인
- [ ] `.github/workflows/warmup.yml` — (4-B 선택 시) `PROMO_URL` 레포 변수 설정
- [ ] §4-A 또는 4-B 중 하나 결정 + 적용 (사용자 선택 대기)
- [x] §4-C 전부 통과 (데모 GIF 눈 확인 1건만 사용자 몫)
- [ ] 게시 후 §2 성공 기준 체크

## 7. 안 할 것 (재발 방지 메모)

이 기획서를 "전략·wedge·예산·3주 플랜"으로 다시 부풀리지 말 것. 무료 채널 몇 개 + 실사용 박제 + 런치 기간 서버 떠 있게가 전부다. 그 이상은 진행 중인 이직 준비에서 시간을 빼는 역효과.

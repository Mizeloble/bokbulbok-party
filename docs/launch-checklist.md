# 공개 서비스 · 수익화 활성화 체크리스트

광고 토대(Phase 0+1)와 공개 서비스 폴리시(OG·분석·레이트리밋)는 코드에 이미 들어가 있고, **전부 env로 꺼져 있음**. 빌드 파이프라인(`Dockerfile` `ARG`/`ENV` + `.github/workflows/fly-deploy.yml` `--build-arg`)도 광고·OG·분석 `NEXT_PUBLIC_*`을 전부 받도록 연결돼 있음 — 미설정 variable은 빈 값으로 전달돼 공개 fallback(none/localhost) 처리되니 안전. 켜는 건 **GitHub repo variable만 채우면** 됨(아래).

> **현재 방침: fly.dev로 먼저 오픈(분석만), 도메인·광고는 트래픽 붙으면.** 광고는 비용보다 "서비스로 키우기" 목적이라 1일차부터 켤 이유 없음. `SITE_URL`이 variable 하나라 나중에 도메인 사도 코드 변경 0.

---

## 지금: fly.dev + 분석으로 오픈 (광고 보류)

오픈 URL은 `https://bokbulbok-party.fly.dev`. 광고 관련 variable은 **건드리지 않음**(전부 none 유지 → 광고·동의배너 안 뜸).

### A. 분석 — 택1 (`src/lib/analytics.ts`)
수익화 가치 판단 근거(트래픽 측정). 익명 집계만.
- **Cloudflare Web Analytics (권장)** — **무료 + 쿠키리스**(동의 배너 불필요). fly.dev를 CF 프록시 뒤에 안 둬도 매뉴얼 beacon 스크립트로 동작. 측정은 얕음(방문/유입/페이지/국가)이지만 "트래픽 가늠" 목적엔 충분.
  CF 대시보드 → Web Analytics → **Add a site** `bokbulbok-party.fly.dev` → 발급된 **beacon 토큰** 복사 → variable: `ANALYTICS_PROVIDER=cloudflare`, `CF_BEACON_TOKEN=<토큰>`. **← 현재 채택 경로.**
- **Plausible** — 쿠키리스·노-동의지만 유료($9/월, 30일 트라이얼). variable: `ANALYTICS_PROVIDER=plausible`, `PLAUSIBLE_DOMAIN=bokbulbok-party.fly.dev`.
- **GA4** — 무료지만 식별자 사용 → 동의 이슈. variable: `ANALYTICS_PROVIDER=ga`, `GA_ID=G-XXXXXXX`.

### B. 등록할 GitHub repo variable (Settings → Secrets and variables → Actions → **Variables** 탭)
| variable | 값 |
|---|---|
| `SITE_URL` | `https://bokbulbok-party.fly.dev` — 공유 미리보기(OG) 절대경로 기준. 안 넣으면 localhost로 깨짐. 업타임 워크플로 감시 대상도 이 값을 따라감 |
| `ANALYTICS_PROVIDER` | `cloudflare` (권장) / `plausible` / `ga` |
| `CF_BEACON_TOKEN` / `PLAUSIBLE_DOMAIN` / `GA_ID` | 위 선택에 맞춰 하나 |
| `FEEDBACK_URL` | (선택) 의견 창구 링크(구글폼 권장). 설정하면 푸터에 "의견 보내기" 노출, 미설정이면 링크 없음 |

### C. Fly secret (런타임)
- [x] `fly secrets set ALLOWED_ORIGIN=https://bokbulbok-party.fly.dev` — 소켓 CORS 고정(`server.ts`). 동일출처라 게임엔 필수 아님(미스매치여도 same-origin 통과)이나 정확성 위해 설정됨.

### D. 배포 & 확인
- [x] 위 variable/secret 등록 후 main에 push(또는 워크플로 재실행)하면 빌드 반영. — CF beacon 토큰 라이브 HTML에 주입 확인(2026-06-09).
- [x] OG 미리보기 메타·이미지 정상 — `og:title=복불복`, `og:image` 절대경로→fly.dev, 실물 1200×630 PNG 렌더. (카카오톡 실물 캐시는 방 링크 직접 붙여 🎯 카드 확인 권장.)
- [x] `/privacy`·`/terms` 정상(둘 다 200). (CF 대시보드 방문 집계는 로그인해 확인.)
- [x] 광고 자리 비어 있고 동의 배너 안 뜸(adfit/adsense·consent 흔적 없음 — 광고 off라 정상).

### E. 운영 관측 (코드에 포함, 별도 설정 불필요)
- **업타임**: `.github/workflows/uptime.yml`이 30분마다 `/healthz` 체크 — 다운이면 `uptime` 라벨 이슈 자동 생성(GitHub 이메일 알림), 복구되면 자동 닫힘. 주기를 줄이면 scale-to-zero 머신이 계속 깨어 있게 되니 주의.
- **트래픽 지표**: 방 생성·게임 시작을 인메모리 카운터(`src/server/metrics.ts`)로 세고 `/metrics`로 노출 → fly.toml `[metrics]`가 Fly 관리형 Prometheus로 수집(수개월 보관, DB 없음 원칙 유지). `[metric]` 로그 라인은 실시간 확인용으로 유지되지만 fly 로그 보관이 ~100줄뿐이라 집계엔 못 쓴다. 도메인·광고 전환 판단("트래픽 붙었나")은 CF 페이지뷰가 아니라 이 수치로.
  - 최근 30일 방 생성: `curl -s "https://api.fly.io/prometheus/personal/api/v1/query" --data-urlencode 'query=sum(increase(bbk_rooms_created_total{app="bokbulbok-party"}[30d]))' -H "Authorization: FlyV1 $(fly auth token)"`
  - 게임별 라운드 수: 같은 명령에서 쿼리만 `sum by (game) (increase(bbk_rounds_started_total{app="bokbulbok-party"}[30d]))`

---

## 나중: 도메인 + 광고 (트래픽이 광고를 정당화하면)

### 1. 도메인
- [ ] 도메인 구입 후 Fly 연결: `fly certs add <도메인>` + DNS A/AAAA 또는 CNAME.
- [ ] variable `SITE_URL=https://<도메인>` 로 교체 + `fly secrets set ALLOWED_ORIGIN=https://<도메인>`.
- 애드핏 심사는 **매체 소유관계**를 봄 → `*.fly.dev`는 루트 미소유라 승인 리스크. 본인 도메인이 안전. 애드센스는 본인 도메인 사실상 필수.

### 2. 광고망 — 택1 (`src/lib/ads.ts`)
광고는 **로비·결과·랜딩 대기화면만** 노출(게임 중 없음).

**A. 카카오 애드핏 (한국 타겟·권장)**
- [ ] https://adfit.kakao.com 가입 → 매체 등록 → 자리별 **광고 단위** 3개(로비/결과/랜딩, 320×50).
- [ ] variable: `AD_NETWORK=adfit`, `ADFIT_UNIT_LOBBY` / `ADFIT_UNIT_RESULT` / `ADFIT_UNIT_LANDING` = 각 `DAN-xxxxxxxx`.

**B. 구글 애드센스 (심사 까다로움 — 도메인·콘텐츠·트래픽 필요)**
- [ ] https://adsense.google.com 가입 → 사이트 추가 → 심사 통과 → 광고 단위 3개.
- [ ] variable: `AD_NETWORK=adsense`, `ADSENSE_CLIENT=ca-pub-…`, `ADSENSE_SLOT_LOBBY` / `_RESULT` / `_LANDING`.
- 맞춤 광고는 `ConsentBanner` 동의 후에만(비동의 시 비맞춤 npa). `/privacy` 이미 존재.

### 3. 광고 켠 뒤 확인
- [ ] 광고 자리에 실제 배너, 게임 중 화면엔 없음, 동의 배너 1회 노출.

---

## Phase 2 잔여 (트래픽 붙은 뒤, 호스팅)
- [ ] **수직 확장 먼저**: `fly.toml` VM(`shared-cpu-1x`/512MB → `2x`/1GB+). scale-to-zero라 유휴 비용은 그대로 0.
- [ ] `ROOM.MAX_ROOMS`(현 10) 상향 — **반드시** VM 크기 + `http_service` 동시연결 한도(soft 150/hard 200)와 함께(`src/lib/constants.ts` 주석 참고).
- [ ] 방 생성 레이트리밋 수치(`RATE_LIMIT`) 트래픽 보고 조정.
- [ ] 캡차 도입 여부 재검토.
- 수평 확장이 필요해지면 그건 호스팅이 아니라 **앱 구조** 문제(인메모리 상태 → Socket.IO Redis 어댑터 + 스티키 세션). 어느 클라우드든 동일하게 재설계 필요.

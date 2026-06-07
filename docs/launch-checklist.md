# 공개 서비스 · 수익화 활성화 체크리스트

광고 토대(Phase 0+1)와 공개 서비스 폴리시(OG·분석·레이트리밋)는 코드에 이미 들어가 있고, **전부 env로 꺼져 있음**. 실제로 켜려면 아래 외부 작업 + env만 채우면 된다. 모든 env는 `NEXT_PUBLIC_*`이라 **빌드 시점**에 주입(Fly는 GitHub Actions 빌드 arg / secret).

## 0. 도메인 (먼저 권장)
- [ ] 도메인 구입 후 Fly에 연결: `fly certs add <도메인>` + DNS A/AAAA 또는 CNAME.
- [ ] `NEXT_PUBLIC_SITE_URL=https://<도메인>` — 공유 미리보기(OG) 절대경로 기준.
- [ ] `fly secrets set ALLOWED_ORIGIN=https://<도메인>` — 소켓 CORS 고정(`server.ts`).
- 애드센스는 본인 소유 도메인이 사실상 필수. 애드핏은 서브도메인도 비교적 관대.

## 1. 광고망 — 택1 (`src/lib/ads.ts`)
기본 `NEXT_PUBLIC_AD_NETWORK=none`. 광고는 **로비·결과·랜딩 대기화면만** 노출됨(게임 중 없음).

### A. 카카오 애드핏 (한국 타겟·승인 쉬움, 권장)
- [ ] https://adfit.kakao.com 가입 → 매체(사이트) 등록 → 자리별 **광고 단위** 3개 발급(로비/결과/랜딩, 320×50).
- [ ] env:
  ```
  NEXT_PUBLIC_AD_NETWORK=adfit
  NEXT_PUBLIC_ADFIT_UNIT_LOBBY=DAN-xxxxxxxx
  NEXT_PUBLIC_ADFIT_UNIT_RESULT=DAN-xxxxxxxx
  NEXT_PUBLIC_ADFIT_UNIT_LANDING=DAN-xxxxxxxx
  ```

### B. 구글 애드센스 (승인 까다로움 — 도메인·콘텐츠·트래픽 필요)
- [ ] https://adsense.google.com 가입 → 사이트 추가 → 심사 통과 → 광고 단위 3개 발급.
- [ ] env:
  ```
  NEXT_PUBLIC_AD_NETWORK=adsense
  NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-xxxxxxxxxxxxxxxx
  NEXT_PUBLIC_ADSENSE_SLOT_LOBBY=xxxxxxxxxx
  NEXT_PUBLIC_ADSENSE_SLOT_RESULT=xxxxxxxxxx
  NEXT_PUBLIC_ADSENSE_SLOT_LANDING=xxxxxxxxxx
  ```
- 맞춤 광고는 `ConsentBanner` 동의 후에만(비동의 시 비맞춤 npa). 개인정보처리방침 `/privacy` 이미 존재.

## 2. 분석 (선택, `src/lib/analytics.ts`)
수익화 판단 근거(트래픽 측정). 기본 `none`.
- [ ] **Plausible**(쿠키리스 권장): `NEXT_PUBLIC_ANALYTICS_PROVIDER=plausible` + `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=<도메인>`.
- [ ] **GA4**: `NEXT_PUBLIC_ANALYTICS_PROVIDER=ga` + `NEXT_PUBLIC_GA_ID=G-XXXXXXX`.

## 3. 배포 & 확인
- [ ] env를 GitHub Actions secret/variable에 등록(빌드 arg로 주입되는지 `Dockerfile`·워크플로 확인).
- [ ] `fly deploy` 후: 광고 자리에 실제 배너가 뜨는지, 게임 중 화면엔 없는지, 동의 배너 1회 노출, `/privacy`·`/terms` 정상.
- [ ] 카카오톡에 방 링크 붙여 OG 미리보기(제목·🎯 카드) 확인.

## 4. 트래픽 붙은 뒤 (Phase 2 잔여)
- [ ] `ROOM.MAX_ROOMS`(현 10) 상향 — **반드시** Fly VM 크기 + `fly.toml` `http_service` 동시연결 한도와 함께(`src/lib/constants.ts` 주석 참고).
- [ ] 방 생성 레이트리밋 수치(`RATE_LIMIT`) 트래픽 보고 조정.
- [ ] 캡차 도입 여부 재검토.

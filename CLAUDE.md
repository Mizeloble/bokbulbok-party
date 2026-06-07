# 복불복 (bokbulbok-party)

목적: 4~12명(최대 30명)이 폰으로 함께 즐기는 범용 복불복 벌칙 정하기 파티 게임. 호스트가 QR로 방을 열고 참가자들이 스캔해서 입장. 오픈소스(MIT), 공개 서비스.

## 실행
- 개발: `npm run dev` (http://localhost:3000, Socket.IO 동일 포트)
- 타입체크: `npm run typecheck`
- 프로덕션: `npm run build && npm start`

## 아키텍처 한줄 요약
Next.js 16(App Router) + 커스텀 Node 서버(`server.ts`) + Socket.IO. 방·플레이어는 서버 메모리에만, DB 없음. 게임 결과는 서버가 권위적으로 결정 → 리플레이 트랙 형태로 브로드캐스트 → 모든 클라가 동일 wall-clock에 재생.

## 공개 운영
단일 인스턴스 전제. 무한 방 생성 OOM 가드로 전역 동시 방 수 상한(`ROOM.MAX_ROOMS`, `src/lib/constants.ts`) — `createRoom`이 `RoomCapacityError` throw, `POST /api/rooms`가 503. 방 생성 IP 레이트리밋(`RATE_LIMIT`, `src/server/rate-limit.ts`)은 프로덕션에서만 적용, 초과 시 429. 캡차는 미도입(트래픽 관찰 후 결정).

## 광고 / 수익화
서버비 충당용 광고는 env로 게이팅(`NEXT_PUBLIC_AD_NETWORK`, 기본 `none` → 미로딩). `adfit`(카카오, 한국 권장)/`adsense` 전환 로직은 `src/lib/ads.ts` 한 곳. 광고는 **대기 시간 화면(로비·결과·랜딩)만** — `AdSlot`(`src/components/AdSlot.tsx`) 사용, 게임 진행 화면엔 절대 금지. 맞춤 광고는 `ConsentBanner` 동의 후에만(`src/lib/consent.ts`, key `bbk:consent`). 개인정보처리방침·약관은 `/privacy`·`/terms`(문구는 i18n `privacy`/`terms`).

## 한국어 UI 원칙
- 모든 사용자 가시 문자열은 `src/lib/i18n.ts`에서만. 인라인 한국어 금지.
- 카피는 짧게(모바일 한 줄 안에 들어오게).

## 구현 순위
v1은 게임 A(마블 레이스)만. 이후 B·C·D 추가 시 `src/games/<id>/` 한 쌍씩만 늘림.

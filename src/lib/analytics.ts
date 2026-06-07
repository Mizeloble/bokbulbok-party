// 분석 설정 — 광고(ads.ts)와 같은 패턴으로 env 게이팅. 기본 'none' = 미로딩.
// 트래픽이 광고 가치가 있는지 판단할 근거용. 익명 집계만(개인정보처리방침과 일치).
// 'cloudflare'(무료·쿠키리스, 권장)·'plausible'(쿠키리스·유료)은 동의 불필요, 'ga'(GA4)는 식별자 사용.

export type AnalyticsProvider = 'none' | 'cloudflare' | 'plausible' | 'ga';

export const ANALYTICS_PROVIDER: AnalyticsProvider =
  (process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER as AnalyticsProvider) || 'none';

// Cloudflare Web Analytics: 사이트 등록 시 발급되는 beacon 토큰. fly.dev를 CF 프록시
// 뒤에 두지 않아도 매뉴얼 beacon 스크립트만으로 동작(static.cloudflareinsights.com).
export const CF_BEACON_TOKEN = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN;
export const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export const analyticsEnabled = ANALYTICS_PROVIDER !== 'none';

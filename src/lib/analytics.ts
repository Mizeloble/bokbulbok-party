// 분석 설정 — 광고(ads.ts)와 같은 패턴으로 env 게이팅. 기본 'none' = 미로딩.
// 트래픽이 광고 가치가 있는지 판단할 근거용. 익명 집계만(개인정보처리방침과 일치).
// Plausible은 쿠키리스라 동의 불필요(권장), GA4는 식별자 사용.

export type AnalyticsProvider = 'none' | 'plausible' | 'ga';

export const ANALYTICS_PROVIDER: AnalyticsProvider =
  (process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER as AnalyticsProvider) || 'none';

export const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export const analyticsEnabled = ANALYTICS_PROVIDER !== 'none';

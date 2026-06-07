// 광고 설정 — 네트워크 중립. 실제 광고 단위 ID는 빌드 시 env로 주입.
// 기본값 'none': 키/계정 없이도 토대가 그대로 동작(개발·오픈소스 기본). 프로덕션에서
// NEXT_PUBLIC_AD_NETWORK + 자리별 단위 ID를 채워야 실제 광고가 송출됨.
// NEXT_PUBLIC_* 은 빌드 시 정적 치환되므로 각 env를 동적 키가 아닌 리터럴로 참조해야 함.

export type AdNetwork = 'none' | 'adfit' | 'adsense';

/** 광고가 들어갈 "대기 시간" 화면. 실게임 화면엔 두지 않음. */
export type AdPlacement = 'lobby' | 'result' | 'landing';

export const AD_NETWORK: AdNetwork =
  (process.env.NEXT_PUBLIC_AD_NETWORK as AdNetwork) || 'none';

export const adsEnabled = AD_NETWORK !== 'none';

// 카카오 애드핏: 자리마다 고유 광고 단위(data-ad-unit).
const ADFIT_UNITS: Record<AdPlacement, string | undefined> = {
  lobby: process.env.NEXT_PUBLIC_ADFIT_UNIT_LOBBY,
  result: process.env.NEXT_PUBLIC_ADFIT_UNIT_RESULT,
  landing: process.env.NEXT_PUBLIC_ADFIT_UNIT_LANDING,
};

// 구글 애드센스: 퍼블리셔 클라이언트(ca-pub-…) + 자리별 슬롯 ID.
export const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
const ADSENSE_SLOTS: Record<AdPlacement, string | undefined> = {
  lobby: process.env.NEXT_PUBLIC_ADSENSE_SLOT_LOBBY,
  result: process.env.NEXT_PUBLIC_ADSENSE_SLOT_RESULT,
  landing: process.env.NEXT_PUBLIC_ADSENSE_SLOT_LANDING,
};

export const adfitUnit = (p: AdPlacement) => ADFIT_UNITS[p];
export const adsenseSlot = (p: AdPlacement) => ADSENSE_SLOTS[p];

/** 해당 자리가 실제로 광고를 띄울 수 있게 설정됐는지(네트워크 + 단위 ID 존재). */
export function adConfigured(p: AdPlacement): boolean {
  if (AD_NETWORK === 'adfit') return !!ADFIT_UNITS[p];
  if (AD_NETWORK === 'adsense') return !!ADSENSE_CLIENT && !!ADSENSE_SLOTS[p];
  return false;
}

// adsbygoogle 전역(애드센스 로드 시 주입). requestNonPersonalizedAds=1 → 비맞춤 광고.
interface AdsbyGoogleArray extends Array<Record<string, unknown>> {
  requestNonPersonalizedAds?: number;
}
declare global {
  interface Window {
    adsbygoogle?: AdsbyGoogleArray;
  }
}

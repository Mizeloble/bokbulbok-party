'use client';

// 네트워크 중립 광고 자리. env(NEXT_PUBLIC_AD_NETWORK)에 따라 애드핏/애드센스 단위를
// 렌더하고, 동의 결정 전(consent === null)에는 자리만 비워둔다(레이아웃 점프 방지).
// 미설정(none)이면 프로덕션에선 아무것도 렌더 안 하고, 개발에선 자리 확인용 placeholder.
// 게임 진행 화면엔 절대 두지 않음 — 로비/결과/랜딩(대기 시간)에서만 사용.

import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import {
  AD_NETWORK,
  ADSENSE_CLIENT,
  adConfigured,
  adfitUnit,
  adsenseSlot,
  type AdPlacement,
} from '@/lib/ads';
import { useConsent } from '@/lib/consent';
import { ko } from '@/lib/i18n';

const isDev = process.env.NODE_ENV !== 'production';

export function AdSlot({
  placement,
  width,
  height,
  className,
}: {
  placement: AdPlacement;
  width: number;
  height: number;
  className?: string;
}) {
  const consent = useConsent();
  const pushedRef = useRef(false);
  const configured = adConfigured(placement);

  useEffect(() => {
    if (AD_NETWORK !== 'adsense' || !configured || consent === null) return;
    if (pushedRef.current) return;
    try {
      window.adsbygoogle = window.adsbygoogle ?? [];
      if (consent !== 'granted') window.adsbygoogle.requestNonPersonalizedAds = 1;
      window.adsbygoogle.push({});
      pushedRef.current = true;
    } catch {}
  }, [configured, consent]);

  // 자리 미설정: 개발에선 placeholder로 배치 확인, 프로덕션에선 빈 공간 없이 생략.
  if (!configured) {
    if (!isDev) return null;
    return (
      <div
        aria-hidden
        className={clsx(
          'mx-auto flex items-center justify-center rounded-lg border border-dashed border-zinc-700 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600',
          className,
        )}
        style={{ width, height }}
      >
        {ko.ads.label} · {placement}
      </div>
    );
  }

  // 동의 결정 전에는 자리만 확보(점프 방지), 결정되면 단위를 렌더.
  return (
    <div
      className={clsx('mx-auto', className)}
      style={{ minHeight: height, maxWidth: width }}
      role="complementary"
      aria-label={ko.ads.label}
    >
      {consent !== null && AD_NETWORK === 'adfit' && (
        <ins
          className="kakao_ad_area"
          style={{ display: 'none' }}
          data-ad-unit={adfitUnit(placement)}
          data-ad-width={String(width)}
          data-ad-height={String(height)}
        />
      )}
      {consent !== null && AD_NETWORK === 'adsense' && (
        <ins
          className="adsbygoogle"
          style={{ display: 'inline-block', width, height }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={adsenseSlot(placement)}
        />
      )}
    </div>
  );
}

'use client';

// 개인맞춤형 광고 동의 배너. 광고가 켜져 있고(adsEnabled) 아직 선택 안 했을 때만 1회 노출.
// "동의" → 맞춤 광고, "비맞춤 광고만" → 비맞춤. 선택은 localStorage에 저장(useConsent로 전파).
// 하단에서 올라오는 바텀시트 패턴 + 안전영역 회피(components/CLAUDE.md 규약).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ko } from '@/lib/i18n';
import { adsEnabled } from '@/lib/ads';
import { readConsent, writeConsent } from '@/lib/consent';

export function ConsentBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (adsEnabled && readConsent() === null) setShow(true);
  }, []);

  if (!show) return null;

  function choose(choice: 'granted' | 'denied') {
    writeConsent(choice);
    setShow(false);
  }

  return (
    <div
      role="dialog"
      aria-label={ko.consent.title}
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3"
    >
      <div className="mx-auto max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/95 backdrop-blur px-4 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <div className="text-sm font-bold text-zinc-100">{ko.consent.title}</div>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
          {ko.consent.desc}{' '}
          <Link
            href="/privacy"
            className="text-amber-200 underline underline-offset-2 decoration-amber-200/40 hover:decoration-amber-200"
          >
            {ko.consent.privacyLink}
          </Link>
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => choose('denied')}
            className="flex-1 py-3 rounded-xl border border-zinc-700 bg-transparent text-zinc-300 text-sm font-semibold active:scale-[0.98]"
          >
            {ko.consent.decline}
          </button>
          <button
            type="button"
            onClick={() => choose('granted')}
            className="flex-1 py-3 rounded-xl bg-amber-400 text-zinc-900 text-sm font-extrabold active:scale-[0.98]"
          >
            {ko.consent.accept}
          </button>
        </div>
      </div>
    </div>
  );
}

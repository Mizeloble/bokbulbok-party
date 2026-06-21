'use client';

import { useState } from 'react';
import { ko } from '@/lib/i18n';
import { shareResultCard } from '@/lib/share-card';

/**
 * 결과 화면 공유 버튼 — 꼴찌 카드(이미지)를 즉석 렌더해 공유 시트로 내보낸다.
 * 호스트·게스트 모두 노출. 바이럴 고리의 핵심: 단톡방으로 브랜드가 들어가는 통로.
 */
export function ResultShareButton({
  losers,
}: {
  losers: { nickname: string; color: string }[];
}) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'saved' | 'failed'>('idle');

  if (losers.length === 0) return null;

  async function onShare() {
    if (status === 'busy') return;
    setStatus('busy');
    const r = await shareResultCard({
      losers: losers.map((p) => ({ nickname: p.nickname, color: p.color })),
      origin: window.location.origin,
    });
    if (r === 'saved' || r === 'failed') {
      setStatus(r);
      setTimeout(() => setStatus('idle'), 2000);
    } else {
      setStatus('idle');
    }
  }

  const label =
    status === 'busy'
      ? ko.share.preparing
      : status === 'saved'
        ? ko.share.saved
        : status === 'failed'
          ? ko.share.failed
          : ko.share.button;

  return (
    <button
      type="button"
      onClick={onShare}
      disabled={status === 'busy'}
      className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-zinc-200 font-bold text-sm active:scale-[0.98] disabled:opacity-60"
    >
      <span aria-hidden>🎯</span>
      <span>{label}</span>
    </button>
  );
}

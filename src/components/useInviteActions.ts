'use client';

import { useState } from 'react';
import { ko } from '@/lib/i18n';

// 초대 링크 복사/공유 로직 — InviteSheet(모달)와 로비 인라인 QR 카드가 공유.
export function useInviteActions(url: string) {
  const [copied, setCopied] = useState(false);
  const [shareSupported] = useState(() => typeof navigator !== 'undefined' && 'share' in navigator);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: select+copy
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  async function share() {
    try {
      await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share({
        title: ko.app.title,
        text: ko.invite.shareText,
        url,
      });
    } catch {
      /* user cancelled */
    }
  }

  return { copied, copy, share, shareSupported };
}

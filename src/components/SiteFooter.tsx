// 공용 푸터 — 랜딩 + 정적 페이지(개인정보/약관)에서 재사용. 게임 화면엔 미부착.
// 크레딧 표기 + 개인정보/약관 링크. (랜딩의 인라인 푸터를 추출.)

import Link from 'next/link';
import { ko } from '@/lib/i18n';
import { APP_VERSION } from '@/lib/version';

export function SiteFooter() {
  return (
    <footer className="py-4 pb-[max(env(safe-area-inset-bottom),16px)] text-xs text-zinc-600 text-center">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <Link
          href="/privacy"
          className="underline-offset-2 hover:underline hover:text-zinc-400"
        >
          {ko.legal.privacy}
        </Link>
        <span aria-hidden>·</span>
        <Link
          href="/terms"
          className="underline-offset-2 hover:underline hover:text-zinc-400"
        >
          {ko.legal.terms}
        </Link>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-1.5">
        <span>{ko.credit.org}</span>
        <span aria-hidden>·</span>
        {ko.credit.authorUrl ? (
          <a
            href={ko.credit.authorUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-2 hover:underline hover:text-zinc-400"
          >
            {ko.credit.authorHandle}
          </a>
        ) : (
          <span>{ko.credit.authorHandle}</span>
        )}
        <span aria-hidden>·</span>
        <a
          href={ko.credit.repoUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="underline-offset-2 hover:underline hover:text-zinc-400"
        >
          {ko.credit.repoLabel}
        </a>
        <span aria-hidden>·</span>
        <span>{ko.credit.version(APP_VERSION)}</span>
      </div>
    </footer>
  );
}

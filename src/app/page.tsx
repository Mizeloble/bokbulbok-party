'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ko } from '@/lib/i18n';
import { APP_VERSION } from '@/lib/version';

export default function LandingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function createRoom() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) {
        // 503 = 전역 방 수 상한(혼잡) → 재시도 권유가 아닌 "잠시 후" 안내
        setBusy(false);
        alert(res.status === 503 ? ko.landing.busy : ko.landing.createFailed);
        return;
      }
      const { roomId, hostToken } = (await res.json()) as { roomId: string; hostToken: string };
      try {
        sessionStorage.setItem(`bbk:host:${roomId}`, hostToken);
      } catch {}
      router.push(`/r/${roomId}`);
    } catch {
      setBusy(false);
      alert(ko.landing.createFailed);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col px-6 text-center">
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-sm w-full space-y-10">
          <div className="space-y-2">
            <div className="text-6xl">🎯</div>
            <h1 className="text-3xl font-bold">{ko.app.title}</h1>
            <p className="text-zinc-400 text-sm">{ko.app.subtitle}</p>
            {ko.credit.authorUrl ? (
              <a
                href={ko.credit.authorUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-block text-xs text-zinc-500 underline-offset-2 hover:underline hover:text-zinc-300"
              >
                {ko.app.madeBy}
              </a>
            ) : (
              <p className="text-xs text-zinc-500">{ko.app.madeBy}</p>
            )}
          </div>
          <p className="text-zinc-300 text-sm leading-relaxed">{ko.landing.description}</p>
          <button
            type="button"
            onClick={createRoom}
            disabled={busy}
            className="w-full py-4 rounded-2xl bg-amber-400 text-zinc-900 font-bold text-lg disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {busy ? ko.landing.creating : ko.landing.createRoom}
          </button>
        </div>
      </div>
      <footer className="py-4 pb-[max(env(safe-area-inset-bottom),16px)] text-xs text-zinc-600">
        {ko.credit.org} ·{' '}
        {ko.credit.authorUrl ? (
          <a
            href={ko.credit.authorUrl}
            className="underline-offset-2 hover:underline hover:text-zinc-400"
          >
            {ko.credit.authorHandle}
          </a>
        ) : (
          <span>{ko.credit.authorHandle}</span>
        )}{' '}
        ·{' '}
        <a
          href={ko.credit.repoUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="underline-offset-2 hover:underline hover:text-zinc-400"
        >
          {ko.credit.repoLabel}
        </a>{' '}
        · {ko.credit.version(APP_VERSION)}
      </footer>
    </main>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ko } from '@/lib/i18n';
import { GAME_META, type GameId } from '@/games/types';
import { AdSlot } from '@/components/AdSlot';
import { SiteFooter } from '@/components/SiteFooter';

// 랜딩 라인업은 로비 GamePicker와 같은 출처(GAME_META) — 활성 게임만, 같은 순서.
const GAME_IDS = (Object.keys(GAME_META) as GameId[]).filter((id) => GAME_META[id].enabled);

export default function LandingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function createRoom() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) {
        // 503 = 전역 방 수 상한, 429 = IP 레이트리밋 → 둘 다 "잠시 후" 혼잡 안내
        setBusy(false);
        alert(res.status === 503 || res.status === 429 ? ko.landing.busy : ko.landing.createFailed);
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
    <main className="min-h-dvh flex flex-col px-6">
      <div className="flex-1 flex flex-col justify-center py-8">
        <div className="mx-auto w-full max-w-sm space-y-7">
          {/* 헤더 */}
          <div className="space-y-2 text-center">
            <div className="text-6xl">🎯</div>
            <h1 className="text-3xl font-bold">{ko.app.title}</h1>
            <p className="text-zinc-400 text-sm">{ko.app.subtitle}</p>
            <p className="inline-flex items-center gap-1 text-xs text-emerald-300/90">
              <span aria-hidden>✦</span>
              {ko.landing.installFree}
            </p>
          </div>

          {/* 이렇게 즐겨요 — 3스텝 */}
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {ko.landing.howTitle}
            </p>
            <ol className="space-y-2">
              {ko.landing.steps.map((step, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex-none grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-xs font-bold text-zinc-900">
                    {i + 1}
                  </span>
                  <span className="text-sm text-zinc-300">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* 미니게임 라인업 — 로비 진입 전 콜드 방문자에게 콘텐츠 노출 */}
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {ko.landing.gamesTitle(GAME_IDS.length)}
            </p>
            <ul className="grid grid-cols-3 gap-2">
              {GAME_IDS.map((id) => (
                <li
                  key={id}
                  className="flex flex-col items-center gap-1 rounded-xl border border-zinc-700/60 bg-zinc-800/50 px-2 py-3 text-center"
                >
                  <span className="text-2xl leading-none" aria-hidden>
                    {GAME_META[id].emoji}
                  </span>
                  <span className="text-[11px] leading-tight text-zinc-300">{ko.games[id]}</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={createRoom}
            disabled={busy}
            className="w-full py-4 rounded-2xl bg-amber-400 text-zinc-900 font-bold text-lg disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {busy ? ko.landing.creating : ko.landing.createRoom}
          </button>
          <AdSlot placement="landing" width={320} height={50} />
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}

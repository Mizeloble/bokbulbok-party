'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ko } from '@/lib/i18n';
import { GAME_META, type GameId } from '@/games/types';
import { gameSubLabel } from '@/lib/game-labels';
import { AdSlot } from '@/components/AdSlot';
import { SiteFooter } from '@/components/SiteFooter';
import { Logo } from '@/components/Logo';

// 랜딩 라인업은 로비 GamePicker와 같은 출처(GAME_META) — 활성 게임만, 같은 순서.
const GAME_IDS = (Object.keys(GAME_META) as GameId[]).filter((id) => GAME_META[id].enabled);

export default function LandingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // 방 생성 실패·혼잡은 네이티브 alert() 대신 인라인 배너로 — 공개 서비스 느낌.
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) {
        // 503 = 전역 방 수 상한, 429 = IP 레이트리밋 → 둘 다 "잠시 후" 혼잡 안내
        setBusy(false);
        setError(res.status === 503 || res.status === 429 ? ko.landing.busy : ko.landing.createFailed);
        return;
      }
      const { roomId, hostToken } = (await res.json()) as { roomId: string; hostToken: string };
      try {
        sessionStorage.setItem(`bbk:host:${roomId}`, hostToken);
      } catch {}
      router.push(`/r/${roomId}`);
    } catch {
      setBusy(false);
      setError(ko.landing.createFailed);
    }
  }

  return (
    <>
      {/* pb-28: 하단 고정 CTA 바에 가리지 않도록 스크롤 영역 여백 확보 */}
      <main className="min-h-dvh px-6 pb-28">
        <div className="mx-auto w-full max-w-sm space-y-6 py-8">
          {/* 헤더 */}
          <div className="space-y-3 text-center">
            <Logo size={56} className="mx-auto" />
            <div className="space-y-1">
              <h1 className="text-3xl font-bold">{ko.app.title}</h1>
              <p className="text-sm text-zinc-400">{ko.app.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-300/90">
                <span aria-hidden>✦</span>
                {ko.landing.installFree}
              </span>
              <a
                href={ko.credit.repoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <span aria-hidden>★</span>
                {ko.landing.openSource}
              </a>
            </div>
          </div>

          {/* 히어로 데모 — 실제 마블 레이스 한 장면(핵심 재미 즉시 전달) */}
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <video
              className="h-44 w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              poster="/demo-marble.jpg"
              aria-label={ko.landing.demoAlt}
            >
              <source src="/demo-marble.mp4" type="video/mp4" />
            </video>
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
            <ul className="grid grid-cols-2 gap-2">
              {GAME_IDS.map((id) => (
                <li
                  key={id}
                  className="flex items-center gap-2.5 rounded-xl border border-zinc-700/60 bg-zinc-800/50 px-3 py-2.5"
                >
                  <span className="text-xl leading-none" aria-hidden>
                    {GAME_META[id].emoji}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-zinc-200">
                      {ko.games[id]}
                    </span>
                    <span className="block truncate text-[10px] text-zinc-500">
                      {gameSubLabel(id)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <AdSlot placement="landing" width={320} height={50} />
        </div>
        <SiteFooter />
      </main>

      {/* 하단 고정 CTA — 스크롤 어디서든 즉시 시작. 노치/홈인디케이터 회피. */}
      <div className="fixed inset-x-0 bottom-0 z-50 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent px-6 pt-6 pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="mx-auto w-full max-w-sm space-y-2">
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-rose-500/15 px-3 py-2 text-center text-xs text-rose-200"
            >
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={createRoom}
            disabled={busy}
            className="w-full rounded-2xl bg-amber-400 py-4 text-lg font-bold text-zinc-900 transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? ko.landing.creating : ko.landing.createRoom}
          </button>
        </div>
      </div>
    </>
  );
}

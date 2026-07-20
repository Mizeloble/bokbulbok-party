'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ko } from '@/lib/i18n';
import { isValidRoomId, normalizeRoomId } from '@/lib/ids';
import { GAME_META, type GameId } from '@/games/types';
import { gameSubLabel } from '@/lib/game-labels';
import { AdSlot } from '@/components/AdSlot';
import { SiteFooter } from '@/components/SiteFooter';
import { Logo } from '@/components/Logo';

// 랜딩 라인업은 로비 GamePicker와 같은 출처(GAME_META) — 활성 게임만, 같은 순서.
const GAME_IDS = (Object.keys(GAME_META) as GameId[]).filter((id) => GAME_META[id].enabled);

// 구조화 데이터(검색 리치 결과용) — FAQ는 아래 가시 섹션과 같은 출처(i18n).
// 클라이언트 컴포넌트지만 SSR로 초기 HTML에 포함되므로 크롤러가 읽는다.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: ko.app.title,
      url: siteUrl,
      description: ko.app.metaDescription,
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any',
      inLanguage: 'ko',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: ko.landing.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
});

export default function LandingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // 방 생성 실패·혼잡은 네이티브 alert() 대신 인라인 배너로 — 공개 서비스 느낌.
  const [error, setError] = useState<string | null>(null);
  // QR을 못 찍는 참가자용 방 코드 직접 입력.
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  function joinByCode() {
    if (!isValidRoomId(code)) {
      setCodeError(ko.landing.joinByCodeInvalid);
      return;
    }
    router.push(`/r/${normalizeRoomId(code)}?join=1`);
  }

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

          {/* 히어로 데모 — 여러 미니게임 하이라이트 몽타주(마블·반응속도·퀴즈) */}
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <video
              className="h-44 w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              poster="/demo-games.jpg"
              aria-label={ko.landing.demoAlt}
            >
              <source src="/demo-games.mp4" type="video/mp4" />
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
                <li key={id}>
                  {/* 게임 소개 페이지 링크 — 검색 유입 페이지로의 내부 링크 겸 상세 규칙 안내 */}
                  <Link
                    href={`/games/${id}`}
                    className="surface flex items-center gap-2.5 rounded-xl px-3 py-2.5 active:scale-[0.98]"
                  >
                    <span className="text-xl leading-none" aria-hidden>
                      {GAME_META[id].emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-zinc-200">
                        {ko.games[id]}
                      </span>
                      <span className="block truncate text-[10px] text-zinc-500">
                        {gameSubLabel(id)}
                      </span>
                    </span>
                    <span className="text-zinc-600 text-sm" aria-hidden>
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* 코드로 입장 — QR을 못 찍는 참가자(카메라 없음·링크만 받음)용 우회 경로 */}
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {ko.landing.joinByCodeTitle}
            </p>
            <div className="flex gap-2">
              <input
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  if (codeError) setCodeError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') joinByCode();
                }}
                placeholder={ko.landing.joinByCodePlaceholder}
                aria-label={ko.landing.joinByCodeTitle}
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 font-mono text-base tracking-[0.2em] uppercase placeholder:tracking-normal placeholder:font-sans focus:border-amber-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={joinByCode}
                disabled={code.trim().length === 0}
                className="flex-none rounded-xl bg-zinc-700 px-5 py-3 text-sm font-bold text-zinc-100 active:scale-[0.98] disabled:opacity-50"
              >
                {ko.landing.joinByCodeSubmit}
              </button>
            </div>
            {codeError && (
              <p role="alert" className="text-xs text-rose-400">
                {codeError}
              </p>
            )}
          </div>

          {/* FAQ — 검색 유입용 콘텐츠(FAQPage JSON-LD와 같은 출처). 접힌 상태로 조용히. */}
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {ko.landing.faqTitle}
            </p>
            <ul className="space-y-1.5">
              {ko.landing.faq.map((f) => (
                <li key={f.q}>
                  <details className="surface group rounded-xl px-3.5 py-2.5">
                    <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 text-[13px] font-medium text-zinc-300">
                      <span>{f.q}</span>
                      <span
                        className="text-zinc-600 transition-transform group-open:rotate-180"
                        aria-hidden
                      >
                        ▾
                      </span>
                    </summary>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-400">{f.a}</p>
                  </details>
                </li>
              ))}
            </ul>
          </div>

          <AdSlot placement="landing" width={320} height={50} />
        </div>
        <SiteFooter />
      </main>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />

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
          <button type="button" onClick={createRoom} disabled={busy} className="btn-primary">
            {busy ? ko.landing.creating : ko.landing.createRoom}
          </button>
        </div>
      </div>
    </>
  );
}

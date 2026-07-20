import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ko } from '@/lib/i18n';
import { GAME_META, type GameId } from '@/games/types';
import { gameSubLabel } from '@/lib/game-labels';
import { SiteFooter } from '@/components/SiteFooter';

// 검색 유입용 정적 게임 소개 페이지. 활성 게임만 빌드 시 생성 — 방/게임 상태와
// 무관한 순수 콘텐츠라 서버 컴포넌트. 규칙 목록은 로비 GameIntro와 같은 출처(gameIntros).

const ENABLED_IDS = (Object.keys(GAME_META) as GameId[]).filter((id) => GAME_META[id].enabled);

// gamePages.intro는 활성 게임만 갖는다 — 비활성 id는 아래 가드에서 404.
const INTROS = ko.gamePages.intro as Partial<Record<GameId, string>>;

export const dynamicParams = false;

export function generateStaticParams() {
  return ENABLED_IDS.map((gameId) => ({ gameId }));
}

function resolveGame(rawId: string): { id: GameId; intro: string } | null {
  const id = rawId as GameId;
  if (!(id in GAME_META) || !GAME_META[id].enabled) return null;
  const intro = INTROS[id];
  return intro ? { id, intro } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const game = resolveGame(gameId);
  if (!game) return {};
  const title = `${ko.games[game.id]} · ${ko.app.title}`;
  return {
    title,
    description: game.intro,
    alternates: { canonical: `/games/${game.id}` },
    openGraph: { title, description: game.intro, url: `/games/${game.id}` },
    twitter: { title, description: game.intro },
  };
}

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const game = resolveGame(gameId);
  if (!game) notFound();
  const { id, intro } = game;
  const others = ENABLED_IDS.filter((g) => g !== id);

  return (
    <main className="min-h-dvh flex flex-col px-6">
      <article className="flex-1 mx-auto w-full max-w-sm py-10">
        <Link href="/" className="text-xs text-zinc-500 underline-offset-2 hover:underline">
          ← {ko.legal.backHome}
        </Link>

        {/* 헤더 */}
        <div className="mt-6 flex items-center gap-4">
          <span className="text-5xl leading-none" aria-hidden>
            {GAME_META[id].emoji}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{ko.games[id]}</h1>
            <p className="mt-0.5 text-xs text-zinc-500">{gameSubLabel(id)}</p>
          </div>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-zinc-300">{intro}</p>

        {/* 게임 규칙 — 로비 GameIntro와 같은 출처 */}
        <section className="mt-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {ko.gamePages.rulesTitle}
          </h2>
          <ul className="mt-2.5 space-y-2">
            {ko.gameIntros[id].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm text-zinc-400">
                <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-amber-400" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 시작하는 법 — 랜딩 3스텝 재사용 */}
        <section className="mt-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {ko.gamePages.howToTitle}
          </h2>
          <ol className="mt-2.5 space-y-2">
            {ko.landing.steps.map((step, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="flex-none grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-xs font-bold text-zinc-900">
                  {i + 1}
                </span>
                <span className="text-sm text-zinc-300">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <Link href="/" className="btn-primary mt-8 block text-center">
          {ko.gamePages.cta}
        </Link>

        {/* 다른 게임 — 소개 페이지 간 내부 링크 */}
        <section className="mt-10">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {ko.gamePages.otherTitle}
          </h2>
          <ul className="mt-2.5 grid grid-cols-2 gap-2">
            {others.map((g) => (
              <li key={g}>
                <Link
                  href={`/games/${g}`}
                  className="surface flex items-center gap-2.5 rounded-xl px-3 py-2.5 active:scale-[0.98]"
                >
                  <span className="text-xl leading-none" aria-hidden>
                    {GAME_META[g].emoji}
                  </span>
                  <span className="block min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-200">
                    {ko.games[g]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </article>
      <SiteFooter />
    </main>
  );
}

'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ko } from '@/lib/i18n';
import { useRoomStore } from '@/store/room-store';
import { AdSlot } from './AdSlot';
import { InviteSheet } from './InviteSheet';
import { ResultShareButton } from './ResultShareButton';
import { TriviaDetailPanel } from './TriviaDetailPanel';
import { useConfetti } from './useConfetti';
import { getSocket } from '@/lib/socket-client';
import { GAME } from '@/lib/constants';
import type { ReactionReplayData } from '@/games/reaction/server';
import type { TriviaReplayData } from '@/games/trivia/server';
import { gameCategory, isQuizGame } from '@/games/types';
import clsx from 'clsx';

export function ResultScreen({
  onReplay,
  inviteUrl,
}: { onReplay?: () => void; inviteUrl?: string } = {}) {
  const result = useRoomStore((s) => s.result);
  const state = useRoomStore((s) => s.state);
  const myToken = useRoomStore((s) => s.myToken);
  const isHost = useRoomStore((s) => s.isHost);
  const gameStart = useRoomStore((s) => s.gameStart);
  const router = useRouter();
  const [showRanking, setShowRanking] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useConfetti(canvasRef);

  if (!result || !state) return null;

  const losers = result.losers
    .map((tk) => state.players.find((p) => p.playerToken === tk))
    .filter((p): p is NonNullable<typeof p> => !!p);

  const iLost = !!myToken && result.losers.includes(myToken);

  const fullRanking = result.ranking
    .map((tk) => state.players.find((p) => p.playerToken === tk))
    .filter((p): p is NonNullable<typeof p> => !!p);

  const canReplay = !!gameStart && !!onReplay;

  // Reaction game: pull per-player tap offsets from the post-round state broadcast.
  // Empty during the intro broadcast — only populated when the round finishes.
  const reactionOffsets =
    gameCategory(state.gameId) === 'reaction'
      ? (state.currentRound?.replay as ReactionReplayData | undefined)?.offsets
      : undefined;
  const showReactionMs = !!reactionOffsets && Object.keys(reactionOffsets).length > 0;

  // Quiz games (trivia/nonsense): per-player cumulative score timeline. Last entry
  // = final score. Empty during the intro broadcast — only populated when the
  // round finishes.
  const triviaScores =
    isQuizGame(state.gameId)
      ? (state.currentRound?.replay as TriviaReplayData | undefined)?.scores
      : undefined;
  const showTriviaScores = !!triviaScores && Object.keys(triviaScores).length > 0;
  const triviaFinalScores: Record<string, number> | undefined = showTriviaScores
    ? Object.fromEntries(
        Object.entries(triviaScores!).map(([tk, arr]) => [tk, arr[arr.length - 1] ?? 0]),
      )
    : undefined;
  const triviaQuestions =
    isQuizGame(state.gameId)
      ? (state.currentRound?.replay as TriviaReplayData | undefined)?.questions
      : undefined;

  function leaveRoom() {
    router.push('/');
  }

  return (
    <main
      className="fixed inset-0 z-30 overflow-y-auto overscroll-contain text-center"
      style={{ background: 'radial-gradient(120% 80% at 50% 0%, #14141c 0%, #0b0b10 55%) #0b0b10' }}
    >
      {/* Confetti canvas pinned to the viewport so it doesn't scroll with content. */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none z-0"
      />

      {/* min-h-full + justify-center keeps the result block vertically centered when
          content fits the viewport, while gracefully growing taller (and scrolling)
          when the trivia detail panel expands beyond the screen. */}
      <div
        className="relative z-10 min-h-full flex flex-col items-center justify-center px-6 py-8"
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 32px)',
          paddingBottom: 'max(env(safe-area-inset-bottom), 32px)',
        }}
      >
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center">
        {/* Header chip — 🎯 오늘의 벌칙 × N명 */}
        <div className="inline-flex items-center gap-2 pl-3.5 pr-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs text-zinc-400 font-semibold whitespace-nowrap">
          <span className="text-sm">🎯</span>
          <span>{ko.result.headerChip}</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-400 text-zinc-900 font-extrabold text-xs">
            {ko.result.countBadge(losers.length)}
          </span>
        </div>

        <LoserBlock
          losers={losers}
          offsets={showReactionMs ? reactionOffsets : undefined}
          scores={showTriviaScores ? triviaFinalScores : undefined}
        />

        <div
          className={clsx(
            'mt-8 font-extrabold -tracking-wide',
            iLost ? 'text-rose-300' : 'text-emerald-300',
          )}
          style={{ fontSize: iLost && losers.length === 1 ? 18 : 17 }}
        >
          {iLost ? ko.result.youLost : ko.result.youWon}
        </div>

        {/* 결과 카드 공유 + 재초대 — 호스트·게스트 공통. 단톡방으로 들고 나가는 바이럴
            고리(공유)와 다음 라운드에 늦은 친구를 합류시키는 고리(초대). */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <ResultShareButton losers={losers} />
          {inviteUrl && (
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-zinc-200 font-bold text-sm active:scale-[0.98]"
            >
              <span aria-hidden>👥</span>
              <span>{ko.result.invite}</span>
            </button>
          )}
        </div>

        {/* Bottom actions — host primary grid vs guest secondary row */}
        {isHost ? (
          <div className="mt-10 w-full flex flex-col gap-2">
            <button
              type="button"
              onClick={() => getSocket().emit('start')}
              className="w-full py-4 rounded-2xl bg-amber-400 text-zinc-900 font-extrabold text-lg active:scale-[0.98] shadow-[0_8px_24px_rgba(251,191,36,0.25)]"
            >
              {ko.result.again}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => getSocket().emit('reset')}
                className="py-3.5 rounded-xl bg-transparent text-zinc-400 border-[1.5px] border-zinc-800 font-semibold text-sm active:scale-[0.98]"
              >
                {ko.result.changeGame}
              </button>
              <button
                type="button"
                onClick={leaveRoom}
                className="py-3.5 rounded-xl bg-transparent text-zinc-400 border-[1.5px] border-zinc-800 font-semibold text-sm active:scale-[0.98]"
              >
                {ko.result.closeRoom}
              </button>
            </div>
            {canReplay && (
              <button
                type="button"
                onClick={onReplay}
                className="mt-1 w-full py-2.5 text-zinc-500 text-xs underline-offset-2 hover:underline"
              >
                {ko.result.replay}
              </button>
            )}
          </div>
        ) : (
          <div className="mt-12 w-full flex flex-col items-center gap-3">
            <div className="inline-flex items-center gap-2 text-xs text-zinc-500">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>{ko.result.waitingNext}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowRanking((s) => !s)}
                className="px-4 py-2.5 rounded-xl bg-transparent text-zinc-400 border border-zinc-800 text-[13px] font-semibold active:scale-[0.98]"
              >
                {showRanking ? ko.result.fullRankingHide : ko.result.fullRankingShow}
              </button>
              <button
                type="button"
                onClick={leaveRoom}
                className="px-4 py-2.5 rounded-xl bg-transparent text-zinc-400 border border-zinc-800 text-[13px] font-semibold active:scale-[0.98]"
              >
                {ko.result.leaveRoom}
              </button>
            </div>
            {canReplay && (
              <button
                type="button"
                onClick={onReplay}
                className="mt-1 text-zinc-500 text-xs underline-offset-2 hover:underline"
              >
                {ko.result.replay}
              </button>
            )}
          </div>
        )}

        {/* 대기 시간 광고 — 액션 버튼 아래. 다음 라운드를 기다리는 동안 노출 */}
        <AdSlot placement="result" width={320} height={50} className="mt-6" />

        {/* Inline ranking (guest disclosure) */}
        {!isHost && showRanking && fullRanking.length > 0 && (
          <RankingList
            ranking={fullRanking}
            myToken={myToken}
            offsets={showReactionMs ? reactionOffsets : undefined}
            scores={showTriviaScores ? triviaFinalScores : undefined}
          />
        )}
      </div>

      {/* Host: ranking shown as compact disclosure below action grid (kept from v1, polished) */}
      {isHost && fullRanking.length > 0 && (
        <details className="relative z-10 mt-6 w-full max-w-sm rounded-xl bg-zinc-900/70 border border-zinc-800 px-4 py-3 text-left group">
          <summary className="text-xs font-semibold text-zinc-400 cursor-pointer select-none list-none flex items-center justify-between">
            <span>{ko.result.fullRanking}</span>
            <span className="text-zinc-600 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="border-t border-zinc-800 mt-3 pt-3">
            <RankingList
            ranking={fullRanking}
            myToken={myToken}
            offsets={showReactionMs ? reactionOffsets : undefined}
            scores={showTriviaScores ? triviaFinalScores : undefined}
          />
          </div>
        </details>
      )}

      {/* Trivia: filtered "특이점" detail. Hides questions where everyone got the
          same outcome (all right / all wrong / all skipped) — only shows the rounds
          worth teasing about ("4명 다 맞혔는데 한 명만…"). */}
      {triviaQuestions &&
        triviaQuestions.length > 0 &&
        isQuizGame(state.gameId) &&
        (() => {
          const picks =
            (state.currentRound?.replay as TriviaReplayData | undefined)?.picks ?? {};
          if (Object.keys(picks).length === 0) return null;
          return (
            <TriviaDetailPanel
              questions={triviaQuestions}
              picks={picks}
              players={state.players}
              myToken={myToken}
            />
          );
        })()}
      </div>

      {showInvite && inviteUrl && (
        <InviteSheet url={inviteUrl} onClose={() => setShowInvite(false)} />
      )}
    </main>
  );
}

function LoserBlock({
  losers,
  offsets,
  scores,
}: {
  losers: { playerToken: string; nickname: string; color: string }[];
  offsets?: Record<string, number | null>;
  scores?: Record<string, number>;
}) {
  const n = losers.length;
  const nameSize = n === 1 ? 80 : n === 2 ? 56 : 44;
  const lineGap = n === 1 ? 0 : n === 2 ? 14 : 10;
  const dotSize = n === 1 ? 14 : n === 2 ? 12 : 10;

  return (
    <div className="mt-9 flex flex-col items-center" style={{ gap: lineGap }}>
      {losers.map((p) => {
        const offsetLabel = offsets ? formatReactionOffset(offsets[p.playerToken]) : null;
        const scoreVal = scores ? (scores[p.playerToken] ?? 0) : null;
        return (
          <div key={p.playerToken} className="flex flex-col items-center gap-3.5">
            <div
              className="font-black text-zinc-50 flex items-center justify-center gap-4"
              style={{
                fontSize: nameSize,
                letterSpacing: '-0.05em',
                lineHeight: 1,
                textShadow: `0 4px 60px ${p.color}50`,
              }}
            >
              <span
                className="rounded-full shrink-0"
                style={{
                  width: dotSize,
                  height: dotSize,
                  background: p.color,
                  boxShadow: `0 0 0 4px ${p.color}30`,
                }}
              />
              <span>{p.nickname}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap justify-center">
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs text-zinc-400 font-bold uppercase tracking-[0.06em]">
                {ko.result.loserBadge}
              </div>
              {offsetLabel && (
                <div
                  className={clsx(
                    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold tabular-nums border',
                    offsetLabel.tone === 'rose'
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                      : offsetLabel.tone === 'dim'
                        ? 'bg-zinc-500/10 border-zinc-700 text-zinc-500'
                        : 'bg-white/[0.05] border-white/[0.08] text-zinc-300',
                  )}
                >
                  {offsetLabel.text}
                </div>
              )}
              {scoreVal != null && (
                <div className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold tabular-nums border bg-amber-400/10 border-amber-400/30 text-amber-200">
                  {ko.trivia.yourScore(scoreVal)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RankingList({
  ranking,
  myToken,
  offsets,
  scores,
}: {
  ranking: { playerToken: string; nickname: string; color: string }[];
  myToken: string | null;
  offsets?: Record<string, number | null>;
  scores?: Record<string, number>;
}) {
  return (
    <ul className="mt-3 w-full max-w-sm space-y-1.5">
      {ranking.map((p, i) => {
        const rank = i + 1;
        const isMe = p.playerToken === myToken;
        const offsetLabel = offsets ? formatReactionOffset(offsets[p.playerToken]) : null;
        const scoreVal = scores ? (scores[p.playerToken] ?? 0) : null;
        return (
          <li
            key={p.playerToken}
            className={clsx(
              'flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm',
              isMe && 'bg-amber-400/15',
            )}
          >
            <span className="w-7 text-right text-xs font-bold text-zinc-500 tabular-nums">
              {ko.result.rank(rank)}
            </span>
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ background: p.color }}
              aria-hidden
            />
            <span
              className={clsx(
                'flex-1 truncate',
                isMe ? 'text-amber-300 font-bold' : 'text-zinc-200',
              )}
            >
              {p.nickname}
            </span>
            {offsetLabel && (
              <span
                className={clsx(
                  'shrink-0 text-xs font-bold tabular-nums',
                  offsetLabel.tone === 'rose'
                    ? 'text-rose-400'
                    : offsetLabel.tone === 'dim'
                      ? 'text-zinc-600'
                      : isMe
                        ? 'text-amber-200'
                        : 'text-zinc-400',
                )}
              >
                {offsetLabel.text}
              </span>
            )}
            {scoreVal != null && (
              <span
                className={clsx(
                  'shrink-0 text-xs font-black tabular-nums',
                  isMe ? 'text-amber-200' : 'text-zinc-300',
                )}
              >
                {ko.trivia.yourScore(scoreVal)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Reaction game: classify a tap offset for display.
 *  - null → "미탭" (dim)
 *  - < REACTION_MIN_HUMAN_RT_MS (incl. negative) → "−180ms · 위반" (rose)
 *  - otherwise → "217ms" (normal)
 * Mirrors server-side classify() in src/games/reaction/server.ts so badge colors
 * line up with bucket placement.
 */
function formatReactionOffset(
  offset: number | null | undefined,
): { text: string; tone: 'normal' | 'rose' | 'dim' } | null {
  if (offset === undefined) return null;
  if (offset === null) {
    return { text: ko.reaction.resultNoTap, tone: 'dim' };
  }
  if (offset < GAME.REACTION_MIN_HUMAN_RT_MS) {
    return { text: ko.reaction.resultFalseStart(offset), tone: 'rose' };
  }
  return { text: ko.reaction.resultMs(offset), tone: 'normal' };
}

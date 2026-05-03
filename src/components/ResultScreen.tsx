'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ko } from '@/lib/i18n';
import { useRoomStore } from '@/store/room-store';
import { getSocket } from '@/lib/socket-client';
import { GAME } from '@/lib/constants';
import type { ReactionReplayData } from '@/games/reaction/server';
import type { TriviaReplayData } from '@/games/trivia/server';
import clsx from 'clsx';

export function ResultScreen({ onReplay }: { onReplay?: () => void } = {}) {
  const result = useRoomStore((s) => s.result);
  const state = useRoomStore((s) => s.state);
  const myToken = useRoomStore((s) => s.myToken);
  const isHost = useRoomStore((s) => s.isHost);
  const gameStart = useRoomStore((s) => s.gameStart);
  const router = useRouter();
  const [showRanking, setShowRanking] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function size() {
      if (!canvas) return;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    }
    size();
    window.addEventListener('resize', size);

    type P = { x: number; y: number; vx: number; vy: number; size: number; color: string; rot: number; vrot: number };
    const palette = ['#fbbf24', '#ef4444', '#22c55e', '#3b82f6', '#ec4899', '#a855f7', '#06b6d4'];
    const particles: P[] = [];
    function spawnBurst() {
      if (!canvas) return;
      const cx = canvas.width / 2;
      for (let i = 0; i < 80; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 8;
        particles.push({
          x: cx,
          y: canvas.height * 0.2,
          vx: Math.cos(a) * speed * 30,
          vy: Math.sin(a) * speed * 30 - 100,
          size: (4 + Math.random() * 5) * dpr,
          color: palette[Math.floor(Math.random() * palette.length)],
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 8,
        });
      }
    }
    spawnBurst();
    const burstId = setInterval(spawnBurst, 1800);

    let raf = 0;
    let lastT = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += 600 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        if (p.y > canvas.height + 40) {
          particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(burstId);
      window.removeEventListener('resize', size);
    };
  }, []);

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
    state.gameId === 'reaction'
      ? (state.currentRound?.replay as ReactionReplayData | undefined)?.offsets
      : undefined;
  const showReactionMs = !!reactionOffsets && Object.keys(reactionOffsets).length > 0;

  // Trivia game: per-player cumulative score timeline. Last entry = final score.
  // Empty during the intro broadcast — only populated when the round finishes.
  const triviaScores =
    state.gameId === 'trivia'
      ? (state.currentRound?.replay as TriviaReplayData | undefined)?.scores
      : undefined;
  const showTriviaScores = !!triviaScores && Object.keys(triviaScores).length > 0;
  const triviaFinalScores: Record<string, number> | undefined = showTriviaScores
    ? Object.fromEntries(
        Object.entries(triviaScores!).map(([tk, arr]) => [tk, arr[arr.length - 1] ?? 0]),
      )
    : undefined;
  const triviaQuestions =
    state.gameId === 'trivia'
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
        {/* Header chip — ☕ 오늘 커피값 × N명 */}
        <div className="inline-flex items-center gap-2 pl-3.5 pr-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs text-zinc-400 font-semibold whitespace-nowrap">
          <span className="text-sm">☕️</span>
          <span>{ko.result.headerChip}</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-400 text-zinc-900 font-extrabold text-[11px]">
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
        state.gameId === 'trivia' &&
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
    </main>
  );
}

type Pick = 0 | 1 | 2 | 3 | null;

function TriviaDetailPanel({
  questions,
  picks,
  players,
  myToken,
}: {
  questions: NonNullable<TriviaReplayData['questions']>;
  picks: Record<string, Pick[]>;
  players: { playerToken: string; nickname: string; color: string; manual: boolean }[];
  myToken: string | null;
}) {
  const [open, setOpen] = useState(false);

  // Manual players never answer — exclude from outcome-counting AND from per-question
  // chips. Keeps the panel honest (e.g., "다들 정답인데 한 명만 X" shouldn't be
  // skewed by phantom non-answerers).
  const realPlayers = players.filter((p) => !p.manual);
  const totalReal = realPlayers.length;
  // With < 2 real players the "다들 같음" filter would always trigger (1 person can't
  // be an outlier vs themselves). Fall back to showing every question so the dev/solo
  // case still gets a meaningful review pane.
  const soloMode = totalReal < 2;

  // Classify each question. An "outlier" question = at least one minority outcome
  // (not everyone-right, not everyone-wrong, not everyone-skipped). All-same →
  // hidden; counted only in the summary line at the bottom.
  type Row = {
    qIndex: number;
    rightTokens: string[];
    wrongTokens: { token: string; pick: Pick }[];
    skippedTokens: string[];
  };
  const rows: Row[] = [];
  let allRight = 0;
  let allWrong = 0;
  let allSkipped = 0;

  for (let i = 0; i < questions.length; i++) {
    const correct = questions[i].correctIndex;
    const right: string[] = [];
    const wrong: { token: string; pick: Pick }[] = [];
    const skipped: string[] = [];
    for (const p of realPlayers) {
      const pick = picks[p.playerToken]?.[i] ?? null;
      if (pick == null) skipped.push(p.playerToken);
      else if (pick === correct) right.push(p.playerToken);
      else wrong.push({ token: p.playerToken, pick });
    }
    if (!soloMode) {
      if (right.length === totalReal) {
        allRight++;
        continue;
      }
      if (wrong.length === totalReal) {
        allWrong++;
        continue;
      }
      if (skipped.length === totalReal) {
        allSkipped++;
        continue;
      }
    }
    rows.push({ qIndex: i, rightTokens: right, wrongTokens: wrong, skippedTokens: skipped });
  }

  const playerLookup = new Map(realPlayers.map((p) => [p.playerToken, p]));

  return (
    <div className="relative z-10 mt-3 w-full max-w-sm">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full rounded-xl bg-zinc-900/70 border border-zinc-800 px-4 py-2.5 text-xs font-semibold text-zinc-300 flex items-center justify-between active:scale-[0.99]"
      >
        <span>📖 {open ? ko.trivia.detailHide : ko.trivia.detailToggle}</span>
        <span className={clsx('text-zinc-500 transition-transform', open && 'rotate-180')}>▾</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {rows.length === 0 ? (
            <div className="rounded-xl bg-zinc-900/70 border border-zinc-800 px-4 py-4 text-center text-xs text-zinc-500">
              {ko.trivia.detailNoOutliers}
            </div>
          ) : (
            rows.map((row) => (
              <OutlierCard
                key={row.qIndex}
                question={questions[row.qIndex]}
                qIndex={row.qIndex}
                row={row}
                totalReal={totalReal}
                playerLookup={playerLookup}
                myToken={myToken}
              />
            ))
          )}
          {(allRight > 0 || allWrong > 0 || allSkipped > 0) && (
            <div className="px-1 pt-1 text-[11px] text-zinc-500 text-center">
              {ko.trivia.detailSkippedSummary(allRight, allWrong)}
              {allSkipped > 0 && ` · ${allSkipped}문제 ${ko.trivia.detailAllNone}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OutlierCard({
  question,
  qIndex,
  row,
  totalReal,
  playerLookup,
  myToken,
}: {
  question: NonNullable<TriviaReplayData['questions']>[number];
  qIndex: number;
  row: {
    rightTokens: string[];
    wrongTokens: { token: string; pick: Pick }[];
    skippedTokens: string[];
  };
  totalReal: number;
  playerLookup: Map<string, { playerToken: string; nickname: string; color: string }>;
  myToken: string | null;
}) {
  const correctChoice = question.choices[question.correctIndex];

  return (
    <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 px-3.5 py-3 text-left">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500 tabular-nums">
          {ko.trivia.detailQuestionNum(qIndex + 1, 0)}
        </span>
        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-amber-400/80">
          {question.category}
        </span>
        <span className="ml-auto text-[10px] font-black text-zinc-400 tabular-nums">
          {ko.trivia.detailHighlightHits(row.rightTokens.length, totalReal)}
        </span>
      </div>
      <div className="text-[14px] font-bold text-zinc-100 leading-snug">{question.question}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[12px] font-bold">
        <span className="text-emerald-400">✓</span>
        <span className="text-emerald-200">{correctChoice}</span>
      </div>

      {row.rightTokens.length > 0 && (
        <PlayerChipRow
          tone="emerald"
          label={ko.trivia.detailCorrect}
          tokens={row.rightTokens.map((t) => ({ token: t }))}
          playerLookup={playerLookup}
          myToken={myToken}
        />
      )}
      {row.wrongTokens.length > 0 && (
        <PlayerChipRow
          tone="rose"
          label={ko.trivia.detailWrong}
          tokens={row.wrongTokens.map((w) => ({
            token: w.token,
            pickLabel: w.pick != null ? question.choices[w.pick] : null,
          }))}
          playerLookup={playerLookup}
          myToken={myToken}
        />
      )}
      {row.skippedTokens.length > 0 && (
        <PlayerChipRow
          tone="zinc"
          label={ko.trivia.detailNoAnswer}
          tokens={row.skippedTokens.map((t) => ({ token: t }))}
          playerLookup={playerLookup}
          myToken={myToken}
        />
      )}

      {question.note && (
        <div className="mt-2 rounded-lg bg-amber-400/5 border border-amber-400/20 px-2.5 py-1.5 text-[12px] text-amber-100/90 leading-snug">
          <span className="text-amber-300 font-black mr-1.5">{ko.trivia.detailNoteLabel}</span>
          {question.note}
        </div>
      )}
    </div>
  );
}

function PlayerChipRow({
  tone,
  label,
  tokens,
  playerLookup,
  myToken,
}: {
  tone: 'emerald' | 'rose' | 'zinc';
  label: string;
  tokens: { token: string; pickLabel?: string | null }[];
  playerLookup: Map<string, { playerToken: string; nickname: string; color: string }>;
  myToken: string | null;
}) {
  const labelColor =
    tone === 'emerald' ? 'text-emerald-300' : tone === 'rose' ? 'text-rose-300' : 'text-zinc-500';
  const chipBg =
    tone === 'emerald'
      ? 'bg-emerald-500/10 ring-emerald-500/30'
      : tone === 'rose'
        ? 'bg-rose-500/10 ring-rose-500/30'
        : 'bg-zinc-800 ring-zinc-700';
  return (
    <div className="mt-1.5">
      <div className={clsx('text-[10px] font-black uppercase tracking-wider mb-1', labelColor)}>
        {label}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {tokens.map(({ token, pickLabel }) => {
          const p = playerLookup.get(token);
          if (!p) return null;
          const isMe = token === myToken;
          return (
            <li
              key={token}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ring-1',
                chipBg,
                isMe && 'ring-amber-300/60',
              )}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: p.color }}
                aria-hidden
              />
              <span className={clsx('font-bold', isMe ? 'text-amber-200' : 'text-zinc-200')}>
                {p.nickname}
              </span>
              {pickLabel && (
                <span className="text-zinc-400">→ {pickLabel}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
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
            <div className="flex items-center gap-1.5">
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-[11px] text-zinc-400 font-bold uppercase tracking-[0.06em]">
                {ko.result.loserBadge}
              </div>
              {offsetLabel && (
                <div
                  className={clsx(
                    'inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tabular-nums border',
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
                <div className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tabular-nums border bg-amber-400/10 border-amber-400/30 text-amber-200">
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

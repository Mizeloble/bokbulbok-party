'use client';

import { useState } from 'react';
import { ko } from '@/lib/i18n';
import type { TriviaReplayData } from '@/games/trivia/server';
import clsx from 'clsx';

type Pick = 0 | 1 | 2 | 3 | null;

/**
 * Trivia/nonsense result detail ("특이점") panel shown below the ranking on the
 * result screen. Filters out questions where everyone got the same outcome (all
 * right / all wrong / all skipped) and surfaces only the rounds worth teasing
 * about ("4명 다 맞혔는데 한 명만…"). Quiz-only; rendered from ResultScreen.
 */
export function TriviaDetailPanel({
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
            <div className="px-1 pt-1 text-xs text-zinc-500 text-center">
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
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500 tabular-nums">
          {ko.trivia.detailQuestionNum(qIndex + 1, 0)}
        </span>
        <span className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-400/80">
          {question.category}
        </span>
        <span className="ml-auto text-[11px] font-black text-zinc-400 tabular-nums">
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
      <div className={clsx('text-[11px] font-black uppercase tracking-wider mb-1', labelColor)}>
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
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ring-1',
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

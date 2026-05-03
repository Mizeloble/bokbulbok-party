'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ko } from '@/lib/i18n';
import { getSocket } from '@/lib/socket-client';
import { haptics } from '@/games/marble/haptics';
import { GAME } from '@/lib/constants';
import type { TriviaReschedulePayload, TriviaStandingsPayload } from '@/lib/protocol';
import { computeRunningScores } from './scoring';
import type { TriviaReplayData } from './server';

type Player = { playerToken: string; nickname: string; color: string };

type CurrentPhase =
  | { kind: 'pre' }
  | { kind: 'question'; qIndex: number; openAt: number; closeAt: number }
  | { kind: 'reveal'; qIndex: number; closeAt: number; revealUntil: number }
  | { kind: 'final' };

const CHOICE_LABELS = ['A', 'B', 'C', 'D'] as const;
const CHOICE_BG = [
  'bg-rose-500/15 border-rose-500/40 text-rose-100',
  'bg-amber-500/15 border-amber-500/40 text-amber-100',
  'bg-emerald-500/15 border-emerald-500/40 text-emerald-100',
  'bg-sky-500/15 border-sky-500/40 text-sky-100',
] as const;

/**
 * Trivia game UI. Phases driven entirely by wall-clock against the schedule embedded
 * in `replay.data` — no network calls during play. Server is the source of truth for
 * answer arrival time; client does NOT send a timestamp.
 *
 * Per question: TRIVIA_QUESTION_MS answer window → TRIVIA_REVEAL_MS reveal. After
 * last reveal: TRIVIA_TAIL_MS "tabulating" before result screen takes over.
 *
 * Score formula lives in `./scoring.ts` and is mirrored client-side here for the
 * +N toast and personal running total. Server score remains authoritative — final
 * standings come from the result payload, not from this preview.
 */
export function TriviaRenderer({
  startAt,
  replay,
  players,
  myPlayerToken,
}: {
  startAt: number;
  durationMs: number;
  replay: TriviaReplayData;
  players: Player[];
  myPlayerToken: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [myAnswers, setMyAnswers] = useState<Array<0 | 1 | 2 | 3 | null>>(() =>
    Array.from({ length: replay.questions.length }, () => null),
  );
  // Click time captured locally as ms-offset from this question's openAt. Mirrors
  // what the server records on `trivia:answer` arrival (within network RTT). Used
  // only for the local +N toast preview — server total is authoritative at result.
  const [myPickOffsets, setMyPickOffsets] = useState<Array<number | null>>(() =>
    Array.from({ length: replay.questions.length }, () => null),
  );
  // Mid-round standings broadcast at each question close. Stored by qIndex so
  // re-renders during the reveal phase keep showing the right snapshot even
  // after the next question opens (we display the LAST received).
  const [standings, setStandings] = useState<TriviaStandingsPayload | null>(null);
  // All-answered short-circuit: when every player picks before the timer expires,
  // the server emits a new schedule and we render off it instead of replay.schedule.
  const [scheduleOverride, setScheduleOverride] = useState<TriviaReplayData['schedule'] | null>(
    null,
  );
  // The "+N · 🔥combo" toast that flashes at the start of each reveal phase if
  // my pick was correct. Auto-clears after a beat.
  const [scoreToast, setScoreToast] = useState<{
    qIndex: number;
    gain: number;
    combo: number;
  } | null>(null);

  const tickedRef = useRef<Set<number>>(new Set());
  const revealedRef = useRef<Set<number>>(new Set());
  const lastUrgentSecRef = useRef<number>(Number.POSITIVE_INFINITY);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const sock = getSocket();
    const standingsHandler = (payload: TriviaStandingsPayload) => setStandings(payload);
    const rescheduleHandler = (payload: TriviaReschedulePayload) =>
      setScheduleOverride({
        openAtOffsets: payload.openAtOffsets,
        closeAtOffsets: payload.closeAtOffsets,
      });
    sock.on('trivia:standings', standingsHandler);
    sock.on('trivia:reschedule', rescheduleHandler);
    return () => {
      sock.off('trivia:standings', standingsHandler);
      sock.off('trivia:reschedule', rescheduleHandler);
    };
  }, []);

  const schedule = scheduleOverride ?? replay.schedule;

  const phase = useMemo<CurrentPhase>(() => {
    const { openAtOffsets, closeAtOffsets } = schedule;
    const total = replay.questions.length;
    if (now < startAt) return { kind: 'pre' };
    for (let i = 0; i < total; i++) {
      const openAt = startAt + openAtOffsets[i];
      const closeAt = startAt + closeAtOffsets[i];
      const revealUntil = closeAt + GAME.TRIVIA_REVEAL_MS;
      if (now < openAt) return { kind: 'pre' };
      if (now < closeAt) return { kind: 'question', qIndex: i, openAt, closeAt };
      if (now < revealUntil) return { kind: 'reveal', qIndex: i, closeAt, revealUntil };
    }
    return { kind: 'final' };
  }, [now, startAt, schedule, replay]);

  // Local mirror of scoring.ts. Not authoritative — server result wins. Used for
  // the score badge in the header and the +N toast on reveal entry.
  const myRunning = useMemo(() => {
    const correctIndices = replay.questions.map((q) => q.correctIndex);
    const answers = myAnswers.map((choice, i) =>
      choice == null ? null : { choice, atOffsetMs: myPickOffsets[i] ?? 0 },
    );
    return computeRunningScores(answers, correctIndices);
  }, [myAnswers, myPickOffsets, replay]);

  // Cumulative score = total points for questions whose reveal has begun.
  const revealedThrough = useMemo(() => {
    const { closeAtOffsets } = schedule;
    let last = -1;
    for (let i = 0; i < replay.questions.length; i++) {
      if (now >= startAt + closeAtOffsets[i]) last = i;
    }
    return last;
  }, [now, startAt, schedule, replay]);

  const myScore = revealedThrough >= 0 ? myRunning.cumulative[revealedThrough] : 0;

  // Question-open haptic (once per qIndex)
  useEffect(() => {
    if (phase.kind !== 'question') return;
    if (tickedRef.current.has(phase.qIndex)) return;
    tickedRef.current.add(phase.qIndex);
    haptics.countdownTick();
  }, [phase]);

  // Per-second urgent tick when ≤3s remain.
  useEffect(() => {
    if (phase.kind !== 'question') {
      lastUrgentSecRef.current = Number.POSITIVE_INFINITY;
      return;
    }
    const sec = Math.ceil((phase.closeAt - now) / 1000);
    if (sec <= 3 && sec >= 1 && sec < lastUrgentSecRef.current) {
      lastUrgentSecRef.current = sec;
      haptics.triviaUrgentTick();
    }
  }, [phase, now]);

  // Reveal-entry feedback: score toast + correct/wrong haptics + combo haptic.
  useEffect(() => {
    if (phase.kind !== 'reveal') return;
    if (revealedRef.current.has(phase.qIndex)) return;
    revealedRef.current.add(phase.qIndex);

    const i = phase.qIndex;
    const result = myRunning.perQuestion[i];
    if (!result) return;

    if (result.score > 0) {
      setScoreToast({ qIndex: i, gain: result.score, combo: result.comboAfter });
      haptics.triviaCorrect();
      if (result.comboAfter >= 2) {
        // Tiny extra buzz on combo — fire after the success haptic settles.
        setTimeout(() => haptics.triviaCombo(), 140);
      }
    } else if (myAnswers[i] != null) {
      haptics.triviaWrong();
    }
  }, [phase, myRunning, myAnswers]);

  // Auto-clear the toast after a beat.
  useEffect(() => {
    if (!scoreToast) return;
    const id = setTimeout(() => setScoreToast(null), 1500);
    return () => clearTimeout(id);
  }, [scoreToast]);

  function handlePick(qIndex: number, choice: 0 | 1 | 2 | 3) {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (myAnswers[qIndex] != null) return;
    if (phase.kind !== 'question' || phase.qIndex !== qIndex) return;

    const offset = Math.max(0, Date.now() - phase.openAt);
    setMyAnswers((prev) => {
      if (prev[qIndex] != null) return prev;
      const next = prev.slice();
      next[qIndex] = choice;
      return next;
    });
    setMyPickOffsets((prev) => {
      if (prev[qIndex] != null) return prev;
      const next = prev.slice();
      next[qIndex] = offset;
      return next;
    });
    haptics.chargeTap();
    getSocket().emit('trivia:answer', { qIndex, choice });
  }

  const isLastQuestion =
    (phase.kind === 'question' || phase.kind === 'reveal') &&
    phase.qIndex === replay.questions.length - 1;

  // Standings render alongside the answer reveal — same screen, no context switch.
  // Server emits at closeAt; we display from then through the rest of reveal phase.
  const showStandings =
    standings != null &&
    phase.kind === 'reveal' &&
    standings.qIndex === phase.qIndex;

  return (
    <main
      key={myPlayerToken ?? 'spectator'}
      className="fixed inset-0 z-30 flex flex-col bg-zinc-950 text-zinc-100 select-none"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 12px)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
      }}
    >
      <Header
        questionLabel={
          phase.kind === 'question' || phase.kind === 'reveal'
            ? ko.trivia.questionLabel(phase.qIndex + 1, replay.questions.length)
            : ''
        }
        timeLeftSec={
          phase.kind === 'question'
            ? Math.max(0, Math.ceil((phase.closeAt - now) / 1000))
            : null
        }
        score={myScore}
        isLast={isLastQuestion}
      />

      {phase.kind === 'question' && (
        <ProgressBar remainingMs={phase.closeAt - now} totalMs={GAME.TRIVIA_QUESTION_MS} />
      )}

      <div className="flex-1 px-4 pt-3 pb-2 flex flex-col">
        {phase.kind === 'pre' && (
          <PreView
            secondsToStart={Math.max(0, Math.ceil((startAt - now) / 1000))}
            totalQuestions={replay.questions.length}
          />
        )}
        {(phase.kind === 'question' || phase.kind === 'reveal') && (
          <QuestionView
            question={replay.questions[phase.qIndex]}
            qIndex={phase.qIndex}
            myPick={myAnswers[phase.qIndex]}
            revealing={phase.kind === 'reveal'}
            onPick={handlePick}
          />
        )}
        {showStandings && standings && (
          <InlineStandings
            payload={standings}
            players={players}
            myToken={myPlayerToken}
          />
        )}
        {phase.kind === 'final' && <FinalView />}
      </div>

      {scoreToast && <ScoreToast gain={scoreToast.gain} combo={scoreToast.combo} />}
    </main>
  );
}

function Header({
  questionLabel,
  timeLeftSec,
  score,
  isLast,
}: {
  questionLabel: string;
  timeLeftSec: number | null;
  score: number;
  isLast: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 pt-2 pb-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
          🧠 {ko.games.trivia}
        </span>
        {questionLabel && (
          <span className="text-sm font-black text-amber-400 tabular-nums">{questionLabel}</span>
        )}
        {isLast && (
          <span className="rounded-md bg-rose-500/20 px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-rose-300 ring-1 ring-rose-500/40">
            {ko.trivia.lastQuestionBadge}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {timeLeftSec != null && (
          <span
            className={clsx(
              'rounded-full px-2.5 py-1 text-xs font-black tabular-nums',
              timeLeftSec <= 3
                ? 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40'
                : 'bg-zinc-800 text-zinc-300',
            )}
          >
            {ko.trivia.timeLeft(timeLeftSec)}
          </span>
        )}
        <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-black text-amber-300 ring-1 ring-amber-400/30 tabular-nums">
          {ko.trivia.scoreLabel} {ko.trivia.yourScore(score)}
        </span>
      </div>
    </div>
  );
}

function ProgressBar({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
  const tone =
    pct > 50
      ? 'bg-emerald-400'
      : pct > 25
        ? 'bg-amber-400'
        : 'bg-rose-500';
  return (
    <div className="mx-4 h-1.5 overflow-hidden rounded-full bg-zinc-800/80">
      <div
        className={clsx('h-full transition-[width,background-color] duration-150 ease-linear', tone)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function PreView({
  secondsToStart,
  totalQuestions,
}: {
  secondsToStart: number;
  totalQuestions: number;
}) {
  // The pre phase only fires before Q1 (subsequent questions chain directly off
  // the previous reveal), so this view is purely the "warming up" moment after
  // countdown begins. The big number ticks down 3 → 2 → 1 → 시작! to mirror the
  // anticipation of the other games' Countdown component.
  return (
    <div
      key={secondsToStart}
      className="flex-1 flex flex-col items-center justify-center gap-3 text-center"
    >
      <div className="text-5xl">🧠</div>
      <div className="text-lg font-black text-zinc-100 tracking-tight">
        {ko.trivia.startingTitle}
      </div>
      <div className="text-xs text-zinc-500 font-semibold">
        {ko.trivia.startingSub(totalQuestions)}
      </div>
      <div
        className={clsx(
          'mt-3 text-7xl font-black tabular-nums tracking-tighter',
          secondsToStart > 0 ? 'text-amber-300' : 'text-emerald-300',
        )}
        style={{ animation: 'trivia-pre-pop 320ms cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
      >
        {ko.trivia.startingCountdown(secondsToStart)}
      </div>
      <style jsx>{`
        @keyframes trivia-pre-pop {
          0% {
            transform: scale(0.6);
            opacity: 0;
          }
          60% {
            transform: scale(1.1);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

function FinalView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-zinc-400">
      <div className="text-sm">{ko.trivia.finalTabulating}</div>
      <div className="mt-4 flex gap-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-600" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-600 [animation-delay:120ms]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-600 [animation-delay:240ms]" />
      </div>
    </div>
  );
}

function QuestionView({
  question,
  qIndex,
  myPick,
  revealing,
  onPick,
}: {
  question: TriviaReplayData['questions'][number];
  qIndex: number;
  myPick: 0 | 1 | 2 | 3 | null;
  revealing: boolean;
  onPick: (qIndex: number, choice: 0 | 1 | 2 | 3) => void;
}) {
  return (
    <div className="flex flex-col">
      <div
        className={clsx(
          'rounded-2xl bg-zinc-900/80 ring-1 ring-zinc-800 transition-all',
          revealing ? 'px-3.5 py-2.5 mb-2.5' : 'px-4 py-5 mb-4',
        )}
      >
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-400/80">
          {question.category}
        </div>
        <div
          className={clsx(
            'mt-1 font-bold leading-snug transition-all',
            revealing ? 'text-[14px] text-zinc-300' : 'text-lg text-zinc-100',
          )}
        >
          {question.question}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 transition-all">
        {question.choices.map((label, i) => {
          const idx = i as 0 | 1 | 2 | 3;
          const picked = myPick === idx;
          const isCorrect = idx === question.correctIndex;
          const showCorrect = revealing && isCorrect;
          const showWrong = revealing && picked && !isCorrect;
          const dim = revealing && !isCorrect && !picked;
          const disabled = revealing || myPick != null;

          return (
            <button
              key={i}
              type="button"
              onClick={() => !disabled && onPick(qIndex, idx)}
              disabled={disabled}
              className={clsx(
                'relative flex items-center gap-3 rounded-2xl border-[1.5px] text-left transition-all',
                revealing ? 'min-h-[42px] px-3 py-2' : 'min-h-[64px] px-4 py-4',
                showCorrect &&
                  'border-emerald-400 bg-emerald-500/20 text-emerald-50 ring-2 ring-emerald-400/60 scale-[1.015]',
                showWrong &&
                  'border-rose-500 bg-rose-500/15 text-rose-100 ring-1 ring-rose-500/50',
                !showCorrect && !showWrong && picked && 'border-amber-400 bg-amber-400/15 text-amber-100',
                !showCorrect && !showWrong && !picked && CHOICE_BG[i],
                dim && 'opacity-30',
                !disabled && 'active:scale-[0.98]',
              )}
            >
              <span
                className={clsx(
                  'flex shrink-0 items-center justify-center rounded-full font-black transition-all',
                  revealing ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm',
                  showCorrect
                    ? 'bg-emerald-400 text-emerald-950'
                    : showWrong
                      ? 'bg-rose-500 text-rose-50'
                      : picked
                        ? 'bg-amber-400 text-zinc-950'
                        : 'bg-zinc-800 text-zinc-400',
                )}
              >
                {CHOICE_LABELS[i]}
              </span>
              <span
                className={clsx(
                  'font-bold leading-snug flex-1 transition-all',
                  revealing ? 'text-[13px]' : 'text-[15px]',
                )}
              >
                {label}
              </span>
              {revealing && isCorrect && (
                <span className="text-xs font-black text-emerald-300">{ko.trivia.correctReveal}</span>
              )}
              {!revealing && picked && (
                <span className="text-[11px] font-black uppercase tracking-wider text-amber-300">
                  {ko.trivia.answered}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InlineStandings({
  payload,
  players,
  myToken,
}: {
  payload: TriviaStandingsPayload;
  players: Player[];
  myToken: string | null;
}) {
  const lookup = new Map(players.map((p) => [p.playerToken, p]));
  // Top 6 fits comfortably below the compressed question + 4 choices on a phone.
  const rows = payload.standings.slice(0, 6);

  return (
    <div
      className="mt-3 rounded-2xl bg-zinc-900/85 ring-1 ring-zinc-800 px-3 py-3"
      style={{ animation: 'trivia-inline-standings 280ms ease-out both' }}
    >
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500 px-1 pb-2">
        📊 {ko.trivia.midRankTitle}
      </div>
      <ul className="space-y-1.5">
        {rows.map((s, i) => {
          const player = lookup.get(s.playerToken);
          const isMe = s.playerToken === myToken;
          const rank = i + 1;
          const podium = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
          return (
            <li
              key={s.playerToken}
              className={clsx(
                'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[14px] ring-1',
                isMe
                  ? 'bg-amber-400/15 ring-amber-400/50'
                  : rank === 1
                    ? 'bg-zinc-800/60 ring-amber-300/20'
                    : 'bg-transparent ring-transparent',
              )}
              style={{
                animation: `trivia-standings-row 360ms cubic-bezier(0.34, 1.56, 0.64, 1) ${
                  i * 50
                }ms both`,
              }}
            >
              <span
                className={clsx(
                  'flex shrink-0 items-center justify-center font-black tabular-nums',
                  podium ? 'h-6 w-6 text-lg' : 'h-6 w-6 text-[12px]',
                  podium
                    ? 'bg-transparent'
                    : isMe
                      ? 'rounded-full bg-amber-400 text-zinc-950'
                      : 'rounded-full bg-zinc-800 text-zinc-400',
                )}
              >
                {podium ?? rank}
              </span>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: player?.color ?? '#666' }}
                aria-hidden
              />
              <span
                className={clsx(
                  'flex-1 truncate font-bold',
                  isMe ? 'text-amber-200' : 'text-zinc-100',
                )}
              >
                {player?.nickname ?? '—'}
              </span>
              {s.combo >= 2 && (
                <span className="rounded-md bg-rose-500/15 px-1 py-0.5 text-[11px] font-black text-rose-300 tabular-nums ring-1 ring-rose-500/30">
                  🔥{s.combo}
                </span>
              )}
              <span
                className={clsx(
                  'min-w-[3.5rem] text-right text-[14px] font-black tabular-nums',
                  isMe ? 'text-amber-200' : 'text-zinc-200',
                )}
              >
                {ko.trivia.yourScore(s.score)}
              </span>
            </li>
          );
        })}
      </ul>

      <style jsx>{`
        @keyframes trivia-inline-standings {
          0% {
            transform: translateY(10px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes trivia-standings-row {
          0% {
            transform: translateY(6px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

function ScoreToast({ gain, combo }: { gain: number; combo: number }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-40 flex flex-col items-center gap-1.5">
      <div
        className="rounded-full bg-emerald-400 px-5 py-2 text-2xl font-black text-emerald-950 tabular-nums shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-300/60"
        style={{ animation: 'trivia-toast 1.5s ease-out forwards' }}
      >
        {ko.trivia.scoreToastGain(gain)}
      </div>
      {combo >= 2 && (
        <div
          className="rounded-full bg-rose-500/95 px-3.5 py-1 text-xs font-black text-white shadow shadow-rose-500/40"
          style={{ animation: 'trivia-toast 1.5s ease-out forwards' }}
        >
          {ko.trivia.comboBadge(combo)}
        </div>
      )}
      <style jsx>{`
        @keyframes trivia-toast {
          0% {
            transform: translateY(-12px) scale(0.85);
            opacity: 0;
          }
          15% {
            transform: translateY(0) scale(1.05);
            opacity: 1;
          }
          80% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
          100% {
            transform: translateY(-8px) scale(0.95);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

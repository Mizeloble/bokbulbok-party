import { clearTrivia, getRoom, publicRoomState, touch, type RoomState } from '../rooms';
import { runGame } from '../game-runner';
import { buildQuizPlan, type QuizQuestion, type TriviaReplayData } from '../../games/trivia/server';
import { TRIVIA_POOL_SORTED } from '../../games/trivia/questions';
import { NONSENSE_POOL_SORTED } from '../../games/nonsense/questions';
import { computeRunningScores } from '../../games/trivia/scoring';
import { GAME } from '../../lib/constants';
import { type GameId } from '../../games/types';
import type { TriviaPerPlayerAnswers } from '../../games/types';
import { emitResult, type IO } from './shared';

// Quiz-family games share one engine (4-choice, speed+combo scoring, live standings):
// trivia and nonsense differ only by question pool. The runner below picks the pool
// by gameId; the rest of the flow (state, `trivia:*` events) is content-agnostic.
// Membership check is the shared `isQuizGame` in src/games/types.ts.
const QUIZ_POOLS: Partial<Record<GameId, readonly QuizQuestion[]>> = {
  trivia: TRIVIA_POOL_SORTED,
  nonsense: NONSENSE_POOL_SORTED,
};

// 문항 품질 신호: 라운드가 끝날 때마다 문항별 응답/정답 수를 [metric] 로그로 남긴다.
// 서버는 영속 저장소가 없으므로 집계는 로그에서(grep/awk) — 누적 정답률이 극단인 문항
// (≈0%: 정답이 자의적, ≈100%: 시시함)을 골라 풀에서 퇴출하는 용도. 입고 게이트는
// src/games/nonsense/CLAUDE.md 참고. answered는 실제 픽 수라 manual 플레이어(전부 null)는
// 자연히 빠지고, players는 픽 행 수(manual 포함) 그대로다.
function logQuestionStats(roomId: string, gameId: GameId, data: TriviaReplayData) {
  const rows = Object.values(data.picks);
  data.questions.forEach((q, i) => {
    let answered = 0;
    let correct = 0;
    for (const picks of rows) {
      const pick = picks[i];
      if (pick === null || pick === undefined) continue;
      answered++;
      if (pick === q.correctIndex) correct++;
    }
    console.log(
      `[metric] quiz_question room=${roomId} game=${gameId} qid=${q.id} answered=${answered} correct=${correct} players=${rows.length}`,
    );
  });
}

/**
 * Quiz round (trivia / nonsense): client-input game with N sequential question
 * phases. Pool is chosen by `room.gameId`; everything else is content-agnostic. Flow:
 *   1. countdown (3s) — clients render "준비…" off the renderer's startAt gate.
 *   2. for each question i: phase open at openAt[i], close at closeAt[i] = openAt[i] + QUESTION_MS.
 *      Server accepts `trivia:answer` only when arrival is in [openAt[i], closeAt[i]].
 *      Reveal phase (REVEAL_MS) follows; client highlights correct choice off the
 *      schedule it received in `game:start.replay`.
 *   3. after the last reveal + TRIVIA_TAIL_MS, build per-player answer arrays and
 *      call computeResult to derive ranking.
 *
 * Like reaction, `game:start` carries a full intro replay (the entire schedule +
 * questions + correct indices). The final `game:result` only needs ranking/losers.
 */
export async function runQuizRound(io: IO, room: RoomState) {
  const connectedPlayers = [...room.players.values()].filter((p) => p.connected);
  if (connectedPlayers.length < GAME.MIN_PLAYERS) return;

  const gameId = room.gameId;
  const pool = QUIZ_POOLS[gameId];
  if (!pool) {
    console.error('quiz round started for non-quiz game', gameId);
    return;
  }

  const seed = (Math.random() * 0x7fffffff) | 0;
  const plan = buildQuizPlan(seed, pool);
  if (plan.questions.length === 0) {
    console.error('quiz plan returned no questions');
    return;
  }

  const startAt = Date.now() + GAME.COUNTDOWN_MS;
  const openAts = plan.schedule.openAtOffsets.map((off) => startAt + off);
  const closeAts = plan.schedule.closeAtOffsets.map((off) => startAt + off);
  const correctIndices = plan.questions.map((q) => q.correctIndex);
  // Players whose answers we wait for to trigger the all-answered short-circuit.
  // Manual-only rooms (no expected tokens) fall back to running the full max-window timer.
  const expectedTokens = connectedPlayers.filter((p) => !p.manual).map((p) => p.playerToken);

  // Status=countdown immediately; stash an intro replay so mid-play reconnects can
  // sync the schedule and questions via `currentRound.replay`.
  room.status = 'countdown';
  const introData: TriviaReplayData = {
    schedule: plan.schedule,
    questions: plan.questions,
    scores: {},
    picks: {},
  };
  const introReplay = {
    durationMs: plan.durationMs,
    ranking: [] as string[],
    losers: [] as string[],
    data: introData,
  };
  room.currentRound = { gameId, seed, startAt, replay: introReplay };

  // Pre-allocate per-player answer slots so the `trivia:answer` handler can no-op
  // for unknown tokens. Each entry mutates in place.
  const answers = new Map<string, Array<{ choice: 0 | 1 | 2 | 3; atOffsetMs: number } | null>>();
  for (const p of connectedPlayers) {
    answers.set(
      p.playerToken,
      Array.from({ length: plan.questions.length }, () => null),
    );
  }

  // Finalize the round: run computeResult, broadcast game:result. Reused by the
  // regular finishTimer and rescheduled when short-circuit shifts the schedule.
  const finishHandler = async () => {
    if (!getRoom(room.id) || room.currentRound?.startAt !== startAt) return;
    if (!room.trivia) return;

    const triviaAnswers: Record<string, TriviaPerPlayerAnswers> = {};
    for (const p of connectedPlayers) {
      // Manual players can't answer — they get a row of nulls (0 score, infinite-equivalent
      // tiebreak via deterministic token order).
      triviaAnswers[p.playerToken] = p.manual
        ? Array.from({ length: plan.questions.length }, () => null)
        : (room.trivia?.answers.get(p.playerToken) ?? Array.from({ length: plan.questions.length }, () => null));
    }

    let replay;
    try {
      replay = await runGame({
        gameId,
        seed,
        players: connectedPlayers,
        loserCount: room.loserCount,
        triviaAnswers,
      });
    } catch (err) {
      console.error('quiz runGame failed', err);
      clearTrivia(room);
      room.status = 'lobby';
      room.currentRound = undefined;
      io.to(room.id).emit('state', publicRoomState(room));
      return;
    }

    room.currentRound = { gameId, seed, startAt, replay };
    clearTrivia(room);
    room.status = 'result';
    io.to(room.id).emit('state', publicRoomState(room));
    emitResult(io, room, replay);
    logQuestionStats(room.id, gameId, replay.data as TriviaReplayData);
  };

  // Per-question standings emit. Safe to call once per qi per round: if it fires
  // after the round has moved on, the early-out guards no-op.
  const emitStandings = (qi: number) => {
    if (!getRoom(room.id) || room.currentRound?.startAt !== startAt) return;
    if (!room.trivia) return;
    const standings = connectedPlayers.map((p) => {
      const ans = room.trivia!.answers.get(p.playerToken) ?? [];
      const r = computeRunningScores(ans, correctIndices);
      // Combo length up to and including question qi (consecutive correct ending at qi).
      let combo = 0;
      for (let i = 0; i <= qi; i++) {
        if (r.perQuestion[i].score > 0) combo++;
        else combo = 0;
      }
      return { playerToken: p.playerToken, score: r.cumulative[qi] ?? 0, combo };
    });
    standings.sort((a, b) =>
      a.score !== b.score ? b.score - a.score : a.playerToken < b.playerToken ? -1 : 1,
    );
    io.to(room.id).emit('trivia:standings', { qIndex: qi, standings });
  };

  // Schedule the per-qi standings broadcasts. Fires at closeAt — the start of the
  // reveal phase. The client renders standings inline alongside the answer reveal
  // so the flow is "see your answer + see leaderboard" in one continuous screen
  // rather than a jarring full-screen takeover. Returns the timer array so we can
  // cancel/replace on short-circuit.
  const scheduleStandingsFrom = (fromQi: number, currentCloseAts: number[]): NodeJS.Timeout[] => {
    const timers: NodeJS.Timeout[] = [];
    for (let qi = fromQi; qi < currentCloseAts.length; qi++) {
      const delay = Math.max(0, currentCloseAts[qi] - Date.now());
      const captureQi = qi;
      timers.push(setTimeout(() => emitStandings(captureQi), delay));
    }
    return timers;
  };

  const scheduleFinishTimer = (newLastCloseAt: number) =>
    setTimeout(
      finishHandler,
      Math.max(0, newLastCloseAt + GAME.TRIVIA_REVEAL_MS + GAME.TRIVIA_TAIL_MS - Date.now()),
    );

  // All-answered short-circuit. Called from trivia:answer after a player's pick is
  // recorded. If every expected player has answered question `qIndex` and we're still
  // inside its window, collapse the remaining wait — close this question NOW, shift
  // every subsequent open/close forward by the saved time, and broadcast the new
  // schedule so clients re-derive their phase. Standings emit fires immediately for
  // the just-closed question.
  const shortCircuitFromAnswer = (qIndex: number) => {
    if (!room.trivia) return;
    if (expectedTokens.length === 0) return; // no one to wait for; let the timer run
    if (qIndex < 0 || qIndex >= room.trivia.closeAts.length) return;
    const now = Date.now();
    if (now >= room.trivia.closeAts[qIndex]) return; // already past; reveal will fire on its own
    for (const tok of expectedTokens) {
      // Only wait on players still present & connected. A player who left
      // mid-round (removed after grace, or disconnected) can never answer —
      // blocking on them would stall the short-circuit until finishTimer.
      const p = room.players.get(tok);
      if (!p || !p.connected) continue;
      const ans = room.trivia.answers.get(tok)?.[qIndex];
      if (!ans) return; // someone hasn't answered yet
    }

    const shift = room.trivia.closeAts[qIndex] - now;
    if (shift <= 0) return;

    const newCloseAts = room.trivia.closeAts.slice();
    const newOpenAts = room.trivia.openAts.slice();
    newCloseAts[qIndex] = now;
    for (let i = qIndex + 1; i < newCloseAts.length; i++) {
      newCloseAts[i] -= shift;
      newOpenAts[i] -= shift;
    }
    room.trivia.closeAts = newCloseAts;
    room.trivia.openAts = newOpenAts;

    // Cancel any pending standings timers (some may already have fired for past
    // questions; clearTimeout on a fired timer is a no-op).
    for (const t of room.trivia.standingsTimers) clearTimeout(t);
    // Fire current question standings immediately (its closeAt is now), then schedule
    // the rest from qIndex+1.
    emitStandings(qIndex);
    room.trivia.standingsTimers = scheduleStandingsFrom(qIndex + 1, newCloseAts);

    // Reschedule the round-finalize timer to the new last close.
    clearTimeout(room.trivia.finishTimer);
    room.trivia.finishTimer = scheduleFinishTimer(newCloseAts[newCloseAts.length - 1]);

    // Tell every client to realign its wall-clock phase to the new schedule.
    io.to(room.id).emit('trivia:reschedule', {
      qIndex,
      openAtOffsets: newOpenAts.map((t) => t - startAt),
      closeAtOffsets: newCloseAts.map((t) => t - startAt),
    });
  };

  const finishTimer = scheduleFinishTimer(closeAts[closeAts.length - 1]);
  const standingsTimers = scheduleStandingsFrom(0, closeAts);

  room.trivia = {
    openAts,
    closeAts,
    answers,
    finishTimer,
    standingsTimers,
    correctIndices,
    expectedTokens,
    startAt,
    shortCircuitFromAnswer,
  };
  touch(room);
  io.to(room.id).emit('state', publicRoomState(room));
  io.to(room.id).emit('countdown', { startAt });
  io.to(room.id).emit('game:start', {
    gameId,
    seed,
    startAt,
    durationMs: plan.durationMs,
    replay: introData,
    players: connectedPlayers.map((p) => ({
      playerToken: p.playerToken,
      nickname: p.nickname,
      color: p.color,
    })),
  });

  setTimeout(() => {
    if (!getRoom(room.id) || room.currentRound?.startAt !== startAt) return;
    room.status = 'playing';
    io.to(room.id).emit('state', publicRoomState(room));
  }, GAME.COUNTDOWN_MS);
}

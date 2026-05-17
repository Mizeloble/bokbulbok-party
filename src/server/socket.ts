import type { Server as IOServer, Socket } from 'socket.io';
import {
  addPlayer,
  clearCharge,
  clearMarbleTilt,
  clearReaction,
  clearTrivia,
  findPlayerBySocket,
  getRoom,
  isHostToken,
  publicRoomState,
  touch,
  type RoomState,
} from './rooms';
import { prepareGameIntro, runGame } from './game-runner';
import { buildTriviaPlan, type TriviaReplayData } from '../games/trivia/server';
import { computeRunningScores } from '../games/trivia/scoring';
import { ko } from '../lib/i18n';
import { GAME, NICKNAME, ROOM } from '../lib/constants';
import { GAME_META } from '../games/types';
import type { TriviaPerPlayerAnswers } from '../games/types';
import type { ClientToServerEvents, ServerToClientEvents } from '../lib/protocol';
import { mulberry32 } from '../games/reaction/server';
import { MarbleTiltLiveSim } from '../games/marble-tilt/liveSim';

type IO = IOServer<ClientToServerEvents, ServerToClientEvents>;

export function attachSocketHandlers(io: IO) {
  io.on('connection', (socket) => {
    let currentRoomId: string | null = null;

    socket.on('join', (payload, ack) => {
      const room = getRoom(payload.roomId);
      if (!room) return ack(err('NO_ROOM', ko.errors.roomNotFound));
      if (room.players.size >= GAME.MAX_PLAYERS && !payload.playerToken) {
        return ack(err('FULL', ko.errors.full));
      }
      if (room.status !== 'lobby' && room.status !== 'result' && !payload.playerToken) {
        return ack(err('IN_PROGRESS', ko.errors.inProgress));
      }
      const nickCheck = validateNickname(room, payload.nickname, payload.playerToken);
      if (!nickCheck.ok) return ack(nickCheck);

      const player = addPlayer(room, {
        nickname: nickCheck.nickname,
        playerToken: payload.playerToken,
        socketId: socket.id,
      });

      const isHost = isHostToken(room, payload.hostToken);
      if (isHost) room.hostSocketId = socket.id;

      currentRoomId = room.id;
      socket.join(room.id);
      ack({ ok: true, playerToken: player.playerToken, isHost });
      io.to(room.id).emit('state', publicRoomState(room));
    });

    socket.on('host:addPlayer', (payload, ack) => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return ack(guard);
      const { room } = guard;

      if (room.status !== 'lobby' && room.status !== 'result') {
        return ack(err('BAD_STATE', ko.errors.badStateAdd));
      }
      if (room.players.size >= GAME.MAX_PLAYERS) return ack(err('FULL', ko.errors.full));

      const nickCheck = validateNickname(room, payload.nickname);
      if (!nickCheck.ok) return ack(nickCheck);

      const player = addPlayer(room, { nickname: nickCheck.nickname, socketId: null, manual: true });
      io.to(room.id).emit('state', publicRoomState(room));
      ack({ ok: true, playerToken: player.playerToken });
    });

    socket.on('host:removePlayer', ({ playerToken }, ack) => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return ack?.(guard);
      const { room } = guard;

      if (room.status !== 'lobby' && room.status !== 'result') {
        return ack?.(err('BAD_STATE', ko.errors.badStateChange));
      }
      const target = room.players.get(playerToken);
      if (!target) return ack?.(err('NO_PLAYER', ko.errors.noPlayer));
      if (!target.manual) return ack?.(err('NOT_MANUAL', ko.errors.notManual));

      if (target.graceTimer) clearTimeout(target.graceTimer);
      room.players.delete(playerToken);
      touch(room);
      io.to(room.id).emit('state', publicRoomState(room));
      ack?.({ ok: true });
    });

    socket.on('setLoserCount', ({ count }) => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return;
      const { room } = guard;
      if (room.status !== 'lobby' && room.status !== 'result') return;
      room.loserCount = clamp(Math.floor(count), GAME.LOSER_COUNT_MIN, GAME.LOSER_COUNT_MAX);
      touch(room);
      io.to(room.id).emit('state', publicRoomState(room));
    });

    socket.on('setGameId', ({ gameId }) => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return;
      const { room } = guard;
      if (room.status !== 'lobby' && room.status !== 'result') return;
      room.gameId = gameId;
      touch(room);
      io.to(room.id).emit('state', publicRoomState(room));
    });

    socket.on('start', async () => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return;
      const { room } = guard;

      const connectedPlayers = [...room.players.values()].filter((p) => p.connected);
      if (connectedPlayers.length < GAME.MIN_PLAYERS) return;
      if (room.status === 'charging' || room.status === 'countdown' || room.status === 'playing') return;

      const meta = GAME_META[room.gameId];
      if (room.gameId === 'marble-tilt') {
        await runMarbleTiltRound(io, room);
      } else if (meta.needsClientInput) {
        if (room.gameId === 'trivia') {
          await runTriviaRound(io, room);
        } else {
          await runReactionRound(io, room);
        }
      } else if (meta.needsPreCharge) {
        startChargingPhase(io, room);
      } else {
        await runRound(io, room, /*chargeRatios*/ undefined);
      }
    });

    socket.on('charge:tick', ({ count }) => {
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room || room.status !== 'charging' || !room.charge) return;
      const player = findPlayerBySocket(room, socket.id);
      if (!player) return;
      const safe = Math.max(0, Math.min(GAME.CHARGE_TAP_CAP, Math.floor(count)));
      const prev = room.charge.counts.get(player.playerToken) ?? 0;
      // Idempotent: client sends cumulative count, we keep the maximum.
      if (safe > prev) room.charge.counts.set(player.playerToken, safe);
    });

    socket.on('reaction:tap', () => {
      // Capture arrival time IMMEDIATELY — this is the source of truth for ranking.
      const arrivalAt = Date.now();
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room || room.gameId !== 'reaction' || !room.reaction) return;
      if (room.status !== 'playing') return;
      if (arrivalAt > room.reaction.deadlineAt) return;
      const player = findPlayerBySocket(room, socket.id);
      if (!player) return;
      // First tap only — server-authoritative.
      if (room.reaction.firstTaps.has(player.playerToken)) return;
      const offset = arrivalAt - room.reaction.goAt;
      room.reaction.firstTaps.set(player.playerToken, offset);
    });

    socket.on('trivia:answer', ({ qIndex, choice }) => {
      // Capture arrival time IMMEDIATELY — server-arrival is the truth for tiebreak.
      const arrivalAt = Date.now();
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room || room.gameId !== 'trivia' || !room.trivia) return;
      if (room.status !== 'playing') return;
      if (typeof qIndex !== 'number' || !Number.isInteger(qIndex)) return;
      if (qIndex < 0 || qIndex >= room.trivia.openAts.length) return;
      if (choice !== 0 && choice !== 1 && choice !== 2 && choice !== 3) return;
      const openAt = room.trivia.openAts[qIndex];
      const closeAt = room.trivia.closeAts[qIndex];
      // Strict window: only accept answers for the question that's currently open.
      if (arrivalAt < openAt || arrivalAt > closeAt) return;
      const player = findPlayerBySocket(room, socket.id);
      if (!player) return;
      const answers = room.trivia.answers.get(player.playerToken);
      if (!answers) return;
      // First answer per question only.
      if (answers[qIndex]) return;
      answers[qIndex] = { choice, atOffsetMs: arrivalAt - openAt };
      // After recording, see if everyone's done — if so, collapse the remaining
      // wait and broadcast the new schedule.
      room.trivia.shortCircuitFromAnswer(qIndex);
    });

    socket.on('marble:tilt', ({ x }) => {
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room || room.gameId !== 'marble-tilt' || !room.marbleTilt) return;
      if (room.status !== 'playing' && room.status !== 'countdown') return;
      if (typeof x !== 'number' || !Number.isFinite(x)) return;
      const player = findPlayerBySocket(room, socket.id);
      if (!player) return;
      // Clamp on receive — clients cap at 1 but a misbehaving / spoofed client
      // shouldn't be able to multiply tilt force by an arbitrary factor.
      const clamped = Math.max(-1, Math.min(1, x));
      room.marbleTilt.sim.setTilt(player.playerToken, clamped);
    });

    socket.on('marble:boost', () => {
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room || room.gameId !== 'marble-tilt' || !room.marbleTilt) return;
      if (room.status !== 'playing') return;
      const player = findPlayerBySocket(room, socket.id);
      if (!player) return;
      // Sim enforces budget + cooldown internally, so we just forward.
      room.marbleTilt.sim.tryBoost(player.playerToken);
    });

    socket.on('reset', () => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return;
      const { room } = guard;
      clearCharge(room);
      clearReaction(room);
      clearTrivia(room);
      clearMarbleTilt(room);
      room.status = 'lobby';
      room.currentRound = undefined;
      touch(room);
      io.to(room.id).emit('state', publicRoomState(room));
    });

    socket.on('disconnect', () => {
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room) return;
      const player = findPlayerBySocket(room, socket.id);
      if (!player) return;
      player.connected = false;
      player.socketId = null;
      if (room.hostSocketId === socket.id) room.hostSocketId = null;
      io.to(room.id).emit('state', publicRoomState(room));

      // Grace period: drop player if they don't return in time
      player.graceTimer = setTimeout(() => {
        if (!player.connected) {
          room.players.delete(player.playerToken);
          touch(room);
          io.to(room.id).emit('state', publicRoomState(room));
        }
      }, ROOM.RECONNECT_GRACE_MS);
    });
  });
}

// --- charge / round flow ---------------------------------------------------

/**
 * Pre-game tap-charging phase used by games with `needsPreCharge` (currently
 * marble-cheer). Broadcasts an aggregate `charge:state` every CHARGE_TICK_MS so
 * clients can render gauges, then runs the round with chargeRatios derived from
 * each player's tap total. Manual (no-phone) players default to a neutral 50%.
 */
function startChargingPhase(io: IO, room: RoomState) {
  const endsAt = Date.now() + GAME.CHARGE_MS;
  room.status = 'charging';

  const tickTimer = setInterval(() => {
    if (!room.charge) return;
    const totals: Record<string, number> = {};
    for (const [token, count] of room.charge.counts) totals[token] = count;
    io.to(room.id).emit('charge:state', { totals, cap: GAME.CHARGE_TAP_CAP });
  }, GAME.CHARGE_TICK_MS);

  const finishTimer = setTimeout(async () => {
    if (!getRoom(room.id) || room.status !== 'charging') return;

    const counts = room.charge?.counts ?? new Map<string, number>();
    clearCharge(room);

    const chargeRatios: Record<string, number> = {};
    for (const p of room.players.values()) {
      if (p.manual) {
        chargeRatios[p.playerToken] = GAME.CHARGE_MANUAL_DEFAULT;
      } else {
        const c = counts.get(p.playerToken) ?? 0;
        chargeRatios[p.playerToken] = Math.min(c, GAME.CHARGE_TAP_CAP) / GAME.CHARGE_TAP_CAP;
      }
    }

    await runRound(io, room, chargeRatios);
  }, GAME.CHARGE_MS);

  room.charge = { endsAt, counts: new Map(), tickTimer, finishTimer };
  touch(room);
  io.to(room.id).emit('state', publicRoomState(room));
  io.to(room.id).emit('charge:start', { endsAt });
  // Send an immediate empty state so clients render gauges from t=0 without a 250ms gap.
  io.to(room.id).emit('charge:state', { totals: {}, cap: GAME.CHARGE_TAP_CAP });
}

/**
 * Reaction game round: client-input game where ranking is computed AFTER play.
 * Flow:
 *   1. countdown (3s) — clients render "준비…" via the renderer's startAt gate
 *   2. wait until goAt (seed-derived 1.5..3.5s after startAt) — "지금!" phase
 *   3. accept `reaction:tap` until deadlineAt; server-arrival time = ranking truth
 *   4. after deadline + REACTION_TAIL_MS, build tapOffsets and call computeResult
 *
 * Note: unlike marble, the broadcast game:start sends an *intro-only* replay
 * payload (`{ goAt, deadlineAt }`). The final ranking arrives via game:result.
 */
async function runReactionRound(io: IO, room: RoomState) {
  const connectedPlayers = [...room.players.values()].filter((p) => p.connected);
  if (connectedPlayers.length < GAME.MIN_PLAYERS) return;

  const seed = (Math.random() * 0x7fffffff) | 0;
  const intro = prepareGameIntro({ gameId: 'reaction', seed });
  if (!intro) {
    console.error('reaction game has no prepareIntro');
    return;
  }

  const startAt = Date.now() + GAME.COUNTDOWN_MS;
  const goAt = startAt + intro.goAtOffsetMs;
  const deadlineAt = goAt + GAME.REACTION_DEADLINE_MS;

  // Set status=countdown and stash a placeholder replay so publicRoomState carries
  // intro data for mid-play reconnects via the `currentRound.replay` channel.
  room.status = 'countdown';
  const introReplay = {
    durationMs: intro.durationMs,
    ranking: [] as string[],
    losers: [] as string[],
    // offsets stays empty until the round ends — ResultScreen uses presence of
    // entries (not the field itself) to decide whether to render ms badges.
    data: { goAt, deadlineAt, offsets: {} as Record<string, number | null> },
  };
  room.currentRound = { gameId: 'reaction', seed, startAt, replay: introReplay };

  // Schedule final result computation. Stored on room so reset() can cancel it.
  const finishTimer = setTimeout(async () => {
    if (!getRoom(room.id) || room.currentRound?.startAt !== startAt) return;
    if (!room.reaction) return;

    // Use the snapshot from broadcast time so the result ranking matches the players
    // clients saw on `game:start`. Mid-round disconnects keep their slot — they just
    // end up as non-tappers if they didn't tap before dropping.
    const tapOffsets: Record<string, number | null> = {};
    for (const p of connectedPlayers) {
      if (p.bot) {
        // Dev-only bot: deterministic 200–400ms reaction so result screens look realistic.
        tapOffsets[p.playerToken] = simulateBotReaction(seed, p.playerToken);
      } else if (p.manual) {
        tapOffsets[p.playerToken] = null;
      } else {
        tapOffsets[p.playerToken] = room.reaction.firstTaps.get(p.playerToken) ?? null;
      }
    }

    let replay;
    try {
      replay = await runGame({
        gameId: 'reaction',
        seed,
        players: connectedPlayers,
        loserCount: room.loserCount,
        tapOffsets,
      });
    } catch (err) {
      console.error('reaction runGame failed', err);
      clearReaction(room);
      room.status = 'lobby';
      room.currentRound = undefined;
      io.to(room.id).emit('state', publicRoomState(room));
      return;
    }

    // Preserve goAt/deadlineAt in the final replay.data so late observers can still
    // anchor their UI. computeResult set offsets relative to startAt; here we
    // overwrite with absolute wall-clock and carry tapOffsets through so the
    // result screen can show each player's reaction time.
    replay.data = { goAt, deadlineAt, offsets: tapOffsets };
    room.currentRound = { gameId: 'reaction', seed, startAt, replay };
    clearReaction(room);
    room.status = 'result';
    io.to(room.id).emit('state', publicRoomState(room));
    emitResult(io, room, replay);
  }, deadlineAt + GAME.REACTION_TAIL_MS - Date.now());

  room.reaction = { goAt, deadlineAt, firstTaps: new Map(), finishTimer };
  touch(room);
  io.to(room.id).emit('state', publicRoomState(room));
  io.to(room.id).emit('countdown', { startAt });
  io.to(room.id).emit('game:start', {
    gameId: 'reaction',
    seed,
    startAt,
    durationMs: intro.durationMs,
    // offsets stays empty here — populated on the post-round state broadcast.
    replay: { goAt, deadlineAt, offsets: {} as Record<string, number | null> },
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

/**
 * Trivia game round: client-input game with N sequential question phases. Flow:
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
async function runTriviaRound(io: IO, room: RoomState) {
  const connectedPlayers = [...room.players.values()].filter((p) => p.connected);
  if (connectedPlayers.length < GAME.MIN_PLAYERS) return;

  const seed = (Math.random() * 0x7fffffff) | 0;
  const plan = buildTriviaPlan(seed);
  if (plan.questions.length === 0) {
    console.error('trivia plan returned no questions');
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
  room.currentRound = { gameId: 'trivia', seed, startAt, replay: introReplay };

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
        gameId: 'trivia',
        seed,
        players: connectedPlayers,
        loserCount: room.loserCount,
        triviaAnswers,
      });
    } catch (err) {
      console.error('trivia runGame failed', err);
      clearTrivia(room);
      room.status = 'lobby';
      room.currentRound = undefined;
      io.to(room.id).emit('state', publicRoomState(room));
      return;
    }

    room.currentRound = { gameId: 'trivia', seed, startAt, replay };
    clearTrivia(room);
    room.status = 'result';
    io.to(room.id).emit('state', publicRoomState(room));
    emitResult(io, room, replay);
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
    gameId: 'trivia',
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

/**
 * Run sim → broadcast countdown + game:start → schedule playing/result transitions.
 * Shared by the no-charge path (marble) and the post-charge path (marble-cheer).
 */
async function runRound(io: IO, room: RoomState, chargeRatios: Record<string, number> | undefined) {
  const connectedPlayers = [...room.players.values()].filter((p) => p.connected);
  if (connectedPlayers.length < GAME.MIN_PLAYERS) {
    room.status = 'lobby';
    io.to(room.id).emit('state', publicRoomState(room));
    return;
  }

  const seed = (Math.random() * 0x7fffffff) | 0;
  // Mark as countdown immediately so a second click is ignored even while WASM loads
  room.status = 'countdown';
  io.to(room.id).emit('state', publicRoomState(room));

  let replay;
  try {
    replay = await runGame({
      gameId: room.gameId,
      seed,
      players: connectedPlayers,
      loserCount: room.loserCount,
      chargeRatios,
    });
  } catch (err) {
    console.error('runGame failed', err);
    room.status = 'lobby';
    io.to(room.id).emit('state', publicRoomState(room));
    return;
  }

  const startAt = Date.now() + GAME.COUNTDOWN_MS;
  room.currentRound = { gameId: room.gameId, seed, startAt, replay };
  touch(room);
  io.to(room.id).emit('state', publicRoomState(room));
  io.to(room.id).emit('countdown', { startAt });
  io.to(room.id).emit('game:start', {
    gameId: room.gameId,
    seed,
    startAt,
    durationMs: replay.durationMs,
    replay: replay.data,
    players: connectedPlayers.map((p) => ({ playerToken: p.playerToken, nickname: p.nickname, color: p.color })),
  });

  setTimeout(() => {
    if (!getRoom(room.id) || room.currentRound?.startAt !== startAt) return;
    room.status = 'playing';
    io.to(room.id).emit('state', publicRoomState(room));
  }, GAME.COUNTDOWN_MS);

  setTimeout(() => {
    if (!getRoom(room.id) || room.currentRound?.startAt !== startAt) return;
    room.status = 'result';
    io.to(room.id).emit('state', publicRoomState(room));
    emitResult(io, room, replay);
  }, GAME.COUNTDOWN_MS + replay.durationMs);
}

/**
 * Live marble race driven by per-player gyroscope tilt input. Unlike `runRound`
 * (which precomputes the entire race deterministically), this runner steps
 * Box2D in real time and streams positions ~30 Hz so tilt forces affect the
 * race as it happens.
 *
 * Flow:
 *   1. instantiate `MarbleTiltLiveSim`, await `init()` (loads Box2D-WASM, builds stage)
 *   2. emit `'game:start'` with a lite intro payload (entities + bounds, no frames)
 *   3. start the sim's tick loop; each tick relays `'marble:tick'` to the room
 *   4. on natural finish, emit `'game:result'` and clean up
 */
async function runMarbleTiltRound(io: IO, room: RoomState) {
  const connectedPlayers = [...room.players.values()].filter((p) => p.connected);
  if (connectedPlayers.length < GAME.MIN_PLAYERS) {
    room.status = 'lobby';
    io.to(room.id).emit('state', publicRoomState(room));
    return;
  }

  // Defensive: if a previous round is somehow still around, drop it before
  // starting a new live sim (otherwise we'd leak tick timers).
  clearMarbleTilt(room);

  const seed = (Math.random() * 0x7fffffff) | 0;
  room.status = 'countdown';
  io.to(room.id).emit('state', publicRoomState(room));

  const startAt = Date.now() + GAME.COUNTDOWN_MS;

  const sim = new MarbleTiltLiveSim({
    seed,
    players: connectedPlayers.map((p) => ({ playerToken: p.playerToken })),
    loserCount: room.loserCount,
    callbacks: {
      onTick: (payload) => {
        // Guard against late-arriving ticks after a reset / new round.
        if (room.marbleTilt?.startAt !== startAt) return;
        io.to(room.id).emit('marble:tick', payload);
      },
      onFinish: ({ ranking, losers, durationMs }) => {
        if (room.marbleTilt?.startAt !== startAt) return;
        // Build the same shape `emitResult` expects.
        const replay = {
          durationMs,
          ranking,
          losers,
          data: undefined as unknown,
        };
        room.currentRound = { gameId: 'marble-tilt', seed, startAt, replay };
        room.status = 'result';
        io.to(room.id).emit('state', publicRoomState(room));
        emitResult(io, room, replay);
        clearMarbleTilt(room);
      },
    },
  });

  let intro;
  try {
    intro = await sim.init();
  } catch (err) {
    console.error('marble-tilt init failed', err);
    sim.dispose();
    room.status = 'lobby';
    io.to(room.id).emit('state', publicRoomState(room));
    return;
  }

  // If the room moved on while WASM was loading (host hit reset), bail.
  if (!getRoom(room.id) || room.status !== 'countdown') {
    sim.dispose();
    return;
  }

  room.marbleTilt = { sim, startAt };

  // Stash a lightweight currentRound so reconnects during play see the right gameId.
  // The actual replay payload is meaningless for marble-tilt (no frames); clients
  // should reconnect and rely on the incoming `marble:tick` stream instead.
  room.currentRound = {
    gameId: 'marble-tilt',
    seed,
    startAt,
    replay: { durationMs: intro.durationMsHint, ranking: [], losers: [], data: undefined },
  };
  touch(room);
  io.to(room.id).emit('state', publicRoomState(room));
  io.to(room.id).emit('countdown', { startAt });
  io.to(room.id).emit('game:start', {
    gameId: 'marble-tilt',
    seed,
    startAt,
    durationMs: intro.durationMsHint,
    replay: intro,
    players: connectedPlayers.map((p) => ({
      playerToken: p.playerToken,
      nickname: p.nickname,
      color: p.color,
    })),
  });

  setTimeout(() => {
    if (!getRoom(room.id) || room.marbleTilt?.startAt !== startAt) return;
    room.status = 'playing';
    io.to(room.id).emit('state', publicRoomState(room));
    sim.start();
  }, GAME.COUNTDOWN_MS);
}

// --- helpers ---------------------------------------------------------------

/**
 * Broadcast the round result. Server-authoritative ranking/losers only —
 * no persistence (the app is memory-only; no DB).
 */
function emitResult(
  io: IO,
  room: RoomState,
  replay: { ranking: string[]; losers: string[] },
) {
  io.to(room.id).emit('game:result', {
    ranking: replay.ranking,
    losers: replay.losers,
  });
}

type Failure = { ok: false; code: string; message: string };

function err(code: string, message: string): Failure {
  return { ok: false, code, message };
}

/**
 * Resolve `currentRoomId` and verify the socket holds host rights.
 * Returns either `{ ok: true, room }` or a ready-to-ack failure payload.
 */
function requireHost(
  currentRoomId: string | null,
  socket: Socket,
): { ok: true; room: RoomState } | Failure {
  const room = currentRoomId ? getRoom(currentRoomId) : null;
  if (!room) return err('NO_ROOM', ko.errors.roomNotFound);
  if (room.hostSocketId !== socket.id) return err('NOT_HOST', ko.errors.notHost);
  return { ok: true, room };
}

/**
 * Sanitize and validate a nickname against length and per-room duplicate rules.
 * `excludeToken` lets a rejoining player keep their own nickname.
 */
function validateNickname(
  room: RoomState,
  raw: unknown,
  excludeToken?: string,
): { ok: true; nickname: string } | Failure {
  const nickname = sanitizeNickname(raw);
  if (!nickname) return err('BAD_NICK', ko.errors.badNick);
  for (const p of room.players.values()) {
    if (p.nickname === nickname && p.playerToken !== excludeToken) {
      return err('DUP_NICK', ko.errors.duplicateNick);
    }
  }
  return { ok: true, nickname };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function sanitizeNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.length < 1 || t.length > NICKNAME.MAX_LENGTH) return null;
  return t;
}

/**
 * Dev-only deterministic bot reaction time. Mixes round seed with token hash so:
 *  - same seed + same player → same offset within a round (replayable)
 *  - different rounds (different seeds) → different offsets (not boring)
 *  - different bots in the same round → different offsets (varied result spread)
 * Range 200–400ms keeps bots in the realistic-human bucket so they neither
 * dominate nor always lose in dev testing.
 */
function simulateBotReaction(seed: number, token: string): number {
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  const rng = mulberry32(seed ^ h);
  return 200 + Math.floor(rng() * 200);
}

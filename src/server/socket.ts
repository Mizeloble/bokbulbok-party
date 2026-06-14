import type { Socket } from 'socket.io';
import {
  addPlayer,
  clearCharge,
  clearMarbleTilt,
  clearReaction,
  clearTrivia,
  deleteRoom,
  findPlayerBySocket,
  getRoom,
  isHostToken,
  publicRoomState,
  touch,
  type RoomState,
} from './rooms';
import { ko } from '../lib/i18n';
import { GAME, NICKNAME, ROOM } from '../lib/constants';
import { GAME_META, isLiveGame, isQuizGame } from '../games/types';
import type { IO } from './rounds/shared';
import { startChargingPhase } from './rounds/charge';
import { runRound } from './rounds/standard';
import { runReactionRound } from './rounds/reaction';
import { runQuizRound } from './rounds/quiz';
import { runMarbleTiltRound } from './rounds/marble-tilt';

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

      // Same socket switching rooms (browser back to landing → new room): leave the
      // previous socket.io room so its broadcasts stop reaching this client, and mark
      // the old player record disconnected so grace eviction / empty-room cleanup run.
      // After validation only — a rejected join must not detach the socket from its
      // current room.
      if (currentRoomId && currentRoomId !== room.id) {
        socket.leave(currentRoomId);
        const prev = getRoom(currentRoomId);
        if (prev) detachSocketFromRoom(io, prev, socket.id);
      }

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
      if (isLiveGame(room.gameId)) {
        await runMarbleTiltRound(io, room);
      } else if (meta.needsClientInput) {
        if (isQuizGame(room.gameId)) {
          await runQuizRound(io, room);
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

    socket.on('reaction:tap', (ack) => {
      // Capture arrival time IMMEDIATELY — this is the source of truth for ranking.
      const arrivalAt = Date.now();
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room || room.gameId !== 'reaction' || !room.reaction) return ack?.({ recorded: false });
      if (room.status !== 'playing') return ack?.({ recorded: false });
      if (arrivalAt > room.reaction.deadlineAt) return ack?.({ recorded: false });
      const player = findPlayerBySocket(room, socket.id);
      if (!player) return ack?.({ recorded: false });
      // First tap only — server-authoritative.
      if (room.reaction.firstTaps.has(player.playerToken)) return ack?.({ recorded: false });
      const offset = arrivalAt - room.reaction.goAt;
      room.reaction.firstTaps.set(player.playerToken, offset);
      // Echo the recorded offset so the renderer can show the same number the
      // result screen will — client-side estimates drift by latency + clock skew.
      ack?.({ recorded: true, offsetMs: offset });
    });

    socket.on('trivia:answer', ({ qIndex, choice }) => {
      // Capture arrival time IMMEDIATELY — server-arrival is the truth for tiebreak.
      const arrivalAt = Date.now();
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room || !isQuizGame(room.gameId) || !room.trivia) return;
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
      if (!room || !isLiveGame(room.gameId) || !room.marbleTilt) return;
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
      if (!room || !isLiveGame(room.gameId) || !room.marbleTilt) return;
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
      detachSocketFromRoom(io, room, socket.id);
    });
  });
}

/**
 * Mark the player bound to `socketId` as disconnected from `room` and start the
 * reconnect grace timer. Shared by the `disconnect` handler and the room-switch
 * path in `join` (same socket joining a different room).
 */
function detachSocketFromRoom(io: IO, room: RoomState, socketId: string) {
  const player = findPlayerBySocket(room, socketId);
  if (!player) return;
  player.connected = false;
  player.socketId = null;
  if (room.hostSocketId === socketId) room.hostSocketId = null;
  io.to(room.id).emit('state', publicRoomState(room));

  // Grace period: drop player if they don't return in time
  if (player.graceTimer) clearTimeout(player.graceTimer);
  player.graceTimer = setTimeout(() => {
    if (!player.connected) {
      room.players.delete(player.playerToken);
      // Last player gone — delete the room now instead of letting `touch`
      // push the idle cleanup another IDLE_MS out (would hold a MAX_ROOMS slot).
      if (room.players.size === 0) {
        deleteRoom(room.id);
        return;
      }
      touch(room);
      io.to(room.id).emit('state', publicRoomState(room));
    }
  }, ROOM.RECONNECT_GRACE_MS);
}

// --- helpers ---------------------------------------------------------------

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

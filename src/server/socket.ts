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
  isHostPlayer,
  isHostToken,
  promoteNextHost,
  publicRoomState,
  touch,
  type RoomState,
} from './rooms';
import { ko } from '../lib/i18n';
import { GAME, NICKNAME, ROOM, SOCKET_RATE } from '../lib/constants';
import { GAME_META, isLiveGame, isQuizGame, type GameId } from '../games/types';
import { checkRateLimit } from './rate-limit';
import type { IO } from './rounds/shared';
import { startChargingPhase } from './rounds/charge';
import { runRound } from './rounds/standard';
import { runReactionRound } from './rounds/reaction';
import { runQuizRound } from './rounds/quiz';
import { runMarbleTiltRound } from './rounds/marble-tilt';

export function attachSocketHandlers(io: IO) {
  io.on('connection', (socket) => {
    // Per-IP new-connection rate limit (prod only): one client opening unlimited
    // sockets is a cheap flood / fork-bomb vector. Bursty simultaneous QR scans at
    // a single venue stay well under the cap.
    if (isProd) {
      const { ok } = checkRateLimit(
        `conn:${socketIp(socket)}`,
        SOCKET_RATE.CONNECT_WINDOW_MS,
        SOCKET_RATE.CONNECT_MAX,
        Date.now(),
      );
      if (!ok) {
        socket.disconnect(true);
        return;
      }
    }

    let currentRoomId: string | null = null;

    socket.on('join', (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (ctrlLimited(socket)) return ack(err('RATE', ko.errors.roomNotFound));
      if (!isObj(payload)) return ack(err('BAD_REQ', ko.errors.roomNotFound));
      const roomId = payload.roomId;
      if (typeof roomId !== 'string') return ack(err('NO_ROOM', ko.errors.roomNotFound));
      const playerToken = typeof payload.playerToken === 'string' ? payload.playerToken : undefined;
      const hostToken = typeof payload.hostToken === 'string' ? payload.hostToken : undefined;

      const room = getRoom(roomId);
      if (!room) return ack(err('NO_ROOM', ko.errors.roomNotFound));
      // A `playerToken` is only a reconnect credential if it matches a player
      // record the server still holds. The server issues every token and has no
      // persistence, so a token that isn't currently in the room is either a
      // fabrication or a player evicted after grace — both must be treated as a
      // fresh join. Without this gate a hostile client could fabricate tokens to
      // bypass the full / in-progress guards and inflate `room.players` past
      // MAX_PLAYERS (memory abuse on the single shared VM).
      const reconnecting = !!playerToken && room.players.has(playerToken);
      if (room.players.size >= GAME.MAX_PLAYERS && !reconnecting) {
        return ack(err('FULL', ko.errors.full));
      }
      if (room.status !== 'lobby' && room.status !== 'result' && !reconnecting) {
        return ack(err('IN_PROGRESS', ko.errors.inProgress));
      }
      const nickCheck = validateNickname(room, payload.nickname, playerToken);
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
        playerToken,
        socketId: socket.id,
      });

      // Host rights come from either the secret hostToken (original creator) or
      // holding the current hostPlayerToken (original host reconnecting, or a
      // participant auto-promoted after the previous host left). Recording the
      // token here is what lets host survive a refresh without re-sending the
      // secret hostToken.
      const isHost = isHostToken(room, hostToken) || isHostPlayer(room, player.playerToken);
      if (isHost) {
        room.hostSocketId = socket.id;
        room.hostPlayerToken = player.playerToken;
      }

      currentRoomId = room.id;
      socket.join(room.id);
      ack({ ok: true, playerToken: player.playerToken, isHost });
      io.to(room.id).emit('state', publicRoomState(room));
    });

    socket.on('host:addPlayer', (payload, ack) => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return ack?.(guard);
      if (ctrlLimited(socket)) return ack?.(err('RATE', ko.errors.notHost));
      if (!isObj(payload)) return ack?.(err('BAD_REQ', ko.errors.badNick));
      const { room } = guard;

      if (room.status !== 'lobby' && room.status !== 'result') {
        return ack?.(err('BAD_STATE', ko.errors.badStateAdd));
      }
      if (room.players.size >= GAME.MAX_PLAYERS) return ack?.(err('FULL', ko.errors.full));

      const nickCheck = validateNickname(room, payload.nickname);
      if (!nickCheck.ok) return ack?.(nickCheck);

      const player = addPlayer(room, { nickname: nickCheck.nickname, socketId: null, manual: true });
      io.to(room.id).emit('state', publicRoomState(room));
      ack?.({ ok: true, playerToken: player.playerToken });
    });

    socket.on('host:removePlayer', (payload, ack) => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return ack?.(guard);
      if (ctrlLimited(socket)) return ack?.(err('RATE', ko.errors.notHost));
      if (!isObj(payload) || typeof payload.playerToken !== 'string') {
        return ack?.(err('NO_PLAYER', ko.errors.noPlayer));
      }
      const { playerToken } = payload;
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

    socket.on('setLoserCount', (payload) => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return;
      if (ctrlLimited(socket)) return;
      if (!isObj(payload) || typeof payload.count !== 'number' || !Number.isFinite(payload.count)) return;
      const { room } = guard;
      if (room.status !== 'lobby' && room.status !== 'result') return;
      room.loserCount = clamp(Math.floor(payload.count), GAME.LOSER_COUNT_MIN, GAME.LOSER_COUNT_MAX);
      touch(room);
      io.to(room.id).emit('state', publicRoomState(room));
    });

    socket.on('setGameId', (payload) => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return;
      if (ctrlLimited(socket)) return;
      if (!isObj(payload) || !isValidGameId(payload.gameId)) return;
      const { room } = guard;
      if (room.status !== 'lobby' && room.status !== 'result') return;
      room.gameId = payload.gameId;
      touch(room);
      io.to(room.id).emit('state', publicRoomState(room));
    });

    socket.on('start', async () => {
      const guard = requireHost(currentRoomId, socket);
      if (!guard.ok) return;
      if (ctrlLimited(socket)) return;
      const { room } = guard;

      const connectedPlayers = [...room.players.values()].filter((p) => p.connected);
      if (connectedPlayers.length < GAME.MIN_PLAYERS) return;
      if (room.status === 'charging' || room.status === 'countdown' || room.status === 'playing') return;

      // A round runner throwing mid-game would reject this async handler with no
      // catch — an unhandledRejection on the shared process. Contain it here: log
      // with room context and reset the room to lobby so the group can retry
      // instead of being stuck in a half-started state.
      try {
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
      } catch (e) {
        console.error(`[start] round failed room=${room.id} game=${room.gameId}`, e);
        clearCharge(room);
        clearReaction(room);
        clearTrivia(room);
        clearMarbleTilt(room);
        room.status = 'lobby';
        room.currentRound = undefined;
        touch(room);
        io.to(room.id).emit('state', publicRoomState(room));
      }
    });

    socket.on('charge:tick', (payload) => {
      if (hotLimited(socket, 'charge')) return;
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room || room.status !== 'charging' || !room.charge) return;
      if (!isObj(payload) || typeof payload.count !== 'number' || !Number.isFinite(payload.count)) return;
      const player = findPlayerBySocket(room, socket.id);
      if (!player) return;
      const safe = Math.max(0, Math.min(GAME.CHARGE_TAP_CAP, Math.floor(payload.count)));
      const prev = room.charge.counts.get(player.playerToken) ?? 0;
      // Idempotent: client sends cumulative count, we keep the maximum.
      if (safe > prev) room.charge.counts.set(player.playerToken, safe);
    });

    socket.on('reaction:tap', (ack) => {
      // Capture arrival time IMMEDIATELY — this is the source of truth for ranking.
      const arrivalAt = Date.now();
      if (hotLimited(socket, 'tap')) return ack?.({ recorded: false });
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

    socket.on('trivia:answer', (payload) => {
      // Capture arrival time IMMEDIATELY — server-arrival is the truth for tiebreak.
      const arrivalAt = Date.now();
      if (hotLimited(socket, 'answer')) return;
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room || !isQuizGame(room.gameId) || !room.trivia) return;
      if (room.status !== 'playing') return;
      if (!isObj(payload)) return;
      const { qIndex, choice } = payload;
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

    socket.on('marble:tilt', (payload) => {
      if (hotLimited(socket, 'tilt')) return;
      const room = currentRoomId ? getRoom(currentRoomId) : null;
      if (!room || !isLiveGame(room.gameId) || !room.marbleTilt) return;
      if (room.status !== 'playing' && room.status !== 'countdown') return;
      if (!isObj(payload) || typeof payload.x !== 'number' || !Number.isFinite(payload.x)) return;
      const player = findPlayerBySocket(room, socket.id);
      if (!player) return;
      // Clamp on receive — clients cap at 1 but a misbehaving / spoofed client
      // shouldn't be able to multiply tilt force by an arbitrary factor.
      const clamped = Math.max(-1, Math.min(1, payload.x));
      room.marbleTilt.sim.setTilt(player.playerToken, clamped);
    });

    socket.on('marble:boost', () => {
      if (hotLimited(socket, 'boost')) return;
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
      if (ctrlLimited(socket)) return;
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
      // If the host never came back within grace, hand host to the next
      // participant after removing them — otherwise the room is stuck with
      // nobody able to pick a game or press start.
      const wasHost = isHostPlayer(room, player.playerToken);
      room.players.delete(player.playerToken);
      // Last player gone — delete the room now instead of letting `touch`
      // push the idle cleanup another IDLE_MS out (would hold a MAX_ROOMS slot).
      if (room.players.size === 0) {
        deleteRoom(room.id);
        return;
      }
      if (wasHost) promoteNextHost(room);
      touch(room);
      io.to(room.id).emit('state', publicRoomState(room));
    }
  }, ROOM.RECONNECT_GRACE_MS);
}

// --- helpers ---------------------------------------------------------------

const isProd = process.env.NODE_ENV === 'production';

type Failure = { ok: false; code: string; message: string };

function err(code: string, message: string): Failure {
  return { ok: false, code, message };
}

// Runtime-only guard (NOT a type predicate): the protocol types payloads as
// well-formed, but Socket.IO does no validation — a hostile client can send null
// or a primitive. We keep the declared types intact and just reject non-objects.
function isObj(v: unknown): boolean {
  return typeof v === 'object' && v !== null;
}

function isValidGameId(v: unknown): v is GameId {
  return typeof v === 'string' && v in GAME_META && GAME_META[v as GameId].enabled;
}

/** Resolve the real client IP for per-IP connection limiting (Fly → XFF → socket). */
function socketIp(socket: Socket): string {
  const h = socket.handshake.headers;
  const fly = h['fly-client-ip'];
  if (typeof fly === 'string' && fly) return fly;
  const xff = h['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return socket.handshake.address || 'unknown';
}

/**
 * Per-socket flood guard (prod only). Hot gameplay inputs (tilt/boost/tap/answer/
 * charge) are unbounded otherwise — one socket could emit thousands/sec and
 * saturate the single shared vCPU. Keyed per (socket, event) so each input type
 * gets its own budget. Dev/LAN testing is never throttled.
 */
function hotLimited(socket: Socket, event: string): boolean {
  if (!isProd) return false;
  return !checkRateLimit(
    `hot:${socket.id}:${event}`,
    SOCKET_RATE.HOT_WINDOW_MS,
    SOCKET_RATE.HOT_MAX,
    Date.now(),
  ).ok;
}

/** Per-socket limit for low-frequency control events (join, host actions, setGameId/setLoserCount, start, reset). */
function ctrlLimited(socket: Socket): boolean {
  if (!isProd) return false;
  return !checkRateLimit(
    `ctrl:${socket.id}`,
    SOCKET_RATE.CTRL_WINDOW_MS,
    SOCKET_RATE.CTRL_MAX,
    Date.now(),
  ).ok;
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
  // Normalize so visually-identical inputs collapse to a single form (blocks
  // combining-char / compatibility lookalikes from dodging the dup-nick check).
  const normalized = raw.normalize('NFC');
  // Strip control (Cc) and format (Cf) characters — zero-width chars (U+200B…),
  // BiDi overrides (U+202E), etc. They render invisibly, so without this an
  // attacker could craft an empty-looking, identical-looking, or reversed
  // nickname to impersonate another player (the dup-nick check compares exact
  // strings, so two invisibly-different names that render the same slip past it).
  const stripped = normalized.replace(/[\p{Cc}\p{Cf}]/gu, '');
  // Collapse any whitespace run (incl. Unicode spaces) to one ASCII space + trim,
  // so a name made only of exotic spaces ends up empty and is rejected below.
  const t = stripped.replace(/\s+/gu, ' ').trim();
  if (t.length < 1 || t.length > NICKNAME.MAX_LENGTH) return null;
  return t;
}

import { newHostToken, newPlayerToken, newRoomId } from '../lib/ids';
import { ko } from '../lib/i18n';
import { MARBLE_COLORS, ROOM } from '../lib/constants';
import type { RoomStatus } from '../lib/protocol';
import type { GameId } from '../games/types';

export type { GameId, RoomStatus };

export type Player = {
  socketId: string | null; // null while disconnected (within grace window) or for host-added players
  playerToken: string;
  nickname: string;
  joinedAt: number;
  connected: boolean;
  graceTimer?: NodeJS.Timeout;
  color: string;
  manual: boolean; // host-added (no device); freely removable by host
  // Dev-only: seeded bot. Treated as `manual` for client UI but the server
  // simulates inputs for them (e.g. fake reaction taps) instead of leaving them idle.
  bot?: boolean;
};

export type ReplayPayload = {
  // marble: prefix-coded position track. shape: { fps, frames: number[][] (per-frame [x,y,...]) }
  // generic: { ranking } only
  durationMs: number;
  ranking: string[]; // playerToken order, last = worst
  losers: string[]; // playerTokens
  data?: unknown; // game-specific
};

export type ChargeState = {
  endsAt: number;
  /** playerToken -> cumulative tap count (capped server-side at GAME.CHARGE_TAP_CAP). */
  counts: Map<string, number>;
  tickTimer: NodeJS.Timeout;
  finishTimer: NodeJS.Timeout;
};

export type ReactionState = {
  /** Wall-clock time when "지금!" reveals. */
  goAt: number;
  /** Wall-clock cutoff for accepted taps. */
  deadlineAt: number;
  /** playerToken -> first-tap server-arrival offset (ms relative to goAt; negative = false start). */
  firstTaps: Map<string, number>;
  finishTimer: NodeJS.Timeout;
};

export type TriviaAnswerRecord = { choice: 0 | 1 | 2 | 3; atOffsetMs: number };

export type TriviaState = {
  /** Wall-clock when each question becomes interactive. */
  openAts: number[];
  /** Wall-clock when each question's answer window closes. */
  closeAts: number[];
  /** playerToken -> per-question first-answer (null = no answer yet). Length = openAts.length. */
  answers: Map<string, Array<TriviaAnswerRecord | null>>;
  finishTimer: NodeJS.Timeout;
  /** Per-question standings broadcast timers (one per question close). Cleared on round end or reschedule. */
  standingsTimers: NodeJS.Timeout[];
  /** Post-shuffle correct index per question. Frozen at round start; used by short-circuit. */
  correctIndices: ReadonlyArray<0 | 1 | 2 | 3>;
  /** Player tokens that must each submit an answer to trigger the all-answered short-circuit. */
  expectedTokens: ReadonlyArray<string>;
  /** Wall-clock startAt for this round — needed to convert wall-clock back to offsets. */
  startAt: number;
  /** Reschedules timers + emits trivia:reschedule when called. Set by runTriviaRound. */
  shortCircuitFromAnswer: (qIndex: number) => void;
};

export type RoomState = {
  id: string;
  hostToken: string;
  hostSocketId: string | null;
  status: RoomStatus;
  gameId: GameId; // selected game (default 'marble')
  loserCount: number; // 1..3
  players: Map<string, Player>; // keyed by playerToken
  currentRound?: { gameId: GameId; seed: number; startAt: number; replay: ReplayPayload };
  charge?: ChargeState; // present only while status === 'charging'
  reaction?: ReactionState; // present only during a `reaction` round (countdown + playing)
  trivia?: TriviaState; // present only during a `trivia` round (countdown + playing)
  lastActivityAt: number;
  cleanupTimer?: NodeJS.Timeout;
};

export function clearCharge(room: RoomState) {
  if (!room.charge) return;
  clearInterval(room.charge.tickTimer);
  clearTimeout(room.charge.finishTimer);
  room.charge = undefined;
}

export function clearReaction(room: RoomState) {
  if (!room.reaction) return;
  clearTimeout(room.reaction.finishTimer);
  room.reaction = undefined;
}

export function clearTrivia(room: RoomState) {
  if (!room.trivia) return;
  clearTimeout(room.trivia.finishTimer);
  for (const t of room.trivia.standingsTimers) clearTimeout(t);
  room.trivia = undefined;
}

// IMPORTANT: Next.js API routes (Turbopack-bundled) and the Socket.IO handler (loaded by tsx)
// run in different module instances, so a plain `new Map()` here would split into two stores
// (one used by `POST /api/rooms`, another by socket join). Pin to globalThis to share.
const ROOMS_KEY = '__lunchCoffeeRooms';
type GlobalWithRooms = typeof globalThis & { [ROOMS_KEY]?: Map<string, RoomState> };
const g = globalThis as GlobalWithRooms;
const rooms: Map<string, RoomState> = g[ROOMS_KEY] ?? new Map<string, RoomState>();
g[ROOMS_KEY] = rooms;

export function createRoom(): { roomId: string; hostToken: string } {
  // Avoid collisions
  let id = newRoomId();
  while (rooms.has(id)) id = newRoomId();
  const hostToken = newHostToken();
  const room: RoomState = {
    id,
    hostToken,
    hostSocketId: null,
    status: 'lobby',
    gameId: 'marble',
    loserCount: 1,
    players: new Map(),
    lastActivityAt: Date.now(),
  };
  rooms.set(id, room);
  scheduleCleanup(room);
  if (process.env.NODE_ENV !== 'production') seedDevBots(room);
  return { roomId: id, hostToken };
}

// Dev-only: seed 5 fake players so a single browser tab can test multiplayer flows
// without juggling incognito windows. Bots have no socket — they sit in the room as
// `connected: true` and get included in the simulation like any real player.
function seedDevBots(room: RoomState) {
  for (const name of ko.dev.botNames) {
    const token = newPlayerToken();
    const color = MARBLE_COLORS[room.players.size % MARBLE_COLORS.length];
    room.players.set(token, {
      socketId: null,
      playerToken: token,
      nickname: name,
      joinedAt: Date.now(),
      connected: true,
      color,
      manual: true,
      bot: true,
    });
  }
}

export function getRoom(roomId: string): RoomState | undefined {
  return rooms.get(roomId.toUpperCase());
}

export function deleteRoom(roomId: string) {
  const r = rooms.get(roomId);
  if (!r) return;
  if (r.cleanupTimer) clearTimeout(r.cleanupTimer);
  for (const p of r.players.values()) {
    if (p.graceTimer) clearTimeout(p.graceTimer);
  }
  rooms.delete(roomId);
}

export function addPlayer(
  room: RoomState,
  params: { nickname: string; playerToken?: string; socketId: string | null; manual?: boolean },
): Player {
  const token = params.playerToken ?? newPlayerToken();
  const existing = room.players.get(token);
  if (existing) {
    if (existing.graceTimer) clearTimeout(existing.graceTimer);
    if (params.socketId !== null) existing.socketId = params.socketId;
    existing.connected = true;
    existing.nickname = params.nickname;
    return existing;
  }
  const color = MARBLE_COLORS[room.players.size % MARBLE_COLORS.length];
  const p: Player = {
    socketId: params.socketId,
    playerToken: token,
    nickname: params.nickname,
    joinedAt: Date.now(),
    connected: true,
    color,
    manual: params.manual ?? false,
  };
  room.players.set(token, p);
  touch(room);
  return p;
}

export function findPlayerBySocket(room: RoomState, socketId: string): Player | undefined {
  for (const p of room.players.values()) if (p.socketId === socketId) return p;
  return undefined;
}

export function isHostToken(room: RoomState, token: string | null | undefined): boolean {
  return !!token && token === room.hostToken;
}

export function touch(room: RoomState) {
  room.lastActivityAt = Date.now();
  scheduleCleanup(room);
}

function scheduleCleanup(room: RoomState) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    const idleFor = Date.now() - room.lastActivityAt;
    const empty = [...room.players.values()].every((p) => !p.connected);
    if (idleFor >= ROOM.IDLE_MS || empty) {
      deleteRoom(room.id);
    } else {
      scheduleCleanup(room);
    }
  }, ROOM.IDLE_MS);
}

export function snapshotPlayers(room: RoomState) {
  return [...room.players.values()].map((p) => ({
    playerToken: p.playerToken,
    nickname: p.nickname,
    connected: p.connected,
    color: p.color,
    manual: p.manual,
  }));
}

export function publicRoomState(room: RoomState) {
  return {
    id: room.id,
    status: room.status,
    gameId: room.gameId,
    loserCount: room.loserCount,
    players: snapshotPlayers(room),
    currentRound: room.currentRound
      ? {
          gameId: room.currentRound.gameId,
          startAt: room.currentRound.startAt,
          durationMs: room.currentRound.replay.durationMs,
          // Exposed for mid-play reconnects (reaction needs goAt/deadlineAt to render).
          // For marble, `data` is large frame data — only include intro-only payloads.
          replay: shouldExposeReplayData(room) ? room.currentRound.replay.data : undefined,
        }
      : undefined,
  };
}

function shouldExposeReplayData(room: RoomState): boolean {
  // Only reaction's and trivia's replay.data is small intro-only metadata. Marble's
  // frames stay out of state broadcasts to keep them light.
  return room.gameId === 'reaction' || room.gameId === 'trivia';
}

import { newHostToken, newPlayerToken, newRoomId } from '../lib/ids';
import { ko } from '../lib/i18n';
import { MARBLE_COLORS, ROOM } from '../lib/constants';
import type { RoomStatus } from '../lib/protocol';
import { exposesReplayData, type GameId } from '../games/types';
import type { MarbleTiltLiveSim } from '../games/marble-tilt/liveSim';

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

export type MarbleTiltState = {
  /** Live simulation owning the box2d world. Disposed via `clearMarbleTilt`. */
  sim: MarbleTiltLiveSim;
  /** Wall-clock when this round was scheduled to begin (also the `currentRound.startAt`). */
  startAt: number;
};

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
  marbleTilt?: MarbleTiltState; // present only during a `marble-tilt` round
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

export function clearMarbleTilt(room: RoomState) {
  if (!room.marbleTilt) return;
  room.marbleTilt.sim.dispose();
  room.marbleTilt = undefined;
}

// IMPORTANT: Next.js API routes (Turbopack-bundled) and the Socket.IO handler (loaded by tsx)
// run in different module instances, so a plain `new Map()` here would split into two stores
// (one used by `POST /api/rooms`, another by socket join). Pin to globalThis to share.
const ROOMS_KEY = '__bokbulbokRooms';
type GlobalWithRooms = typeof globalThis & { [ROOMS_KEY]?: Map<string, RoomState> };
const g = globalThis as GlobalWithRooms;
const rooms: Map<string, RoomState> = g[ROOMS_KEY] ?? new Map<string, RoomState>();
g[ROOMS_KEY] = rooms;

/** Thrown by `createRoom` when the global concurrent-room cap is reached. */
export class RoomCapacityError extends Error {
  constructor() {
    super('room capacity reached');
    this.name = 'RoomCapacityError';
  }
}

export function createRoom(): { roomId: string; hostToken: string } {
  // OOM guard: refuse new rooms past the global cap (abuse / runaway creation).
  if (rooms.size >= ROOM.MAX_ROOMS) throw new RoomCapacityError();
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
  if (process.env.NODE_ENV !== 'production') seedDevBots(room);
  // Start with the short unclaimed-room window; the first live `join` calls
  // `touch` → `scheduleCleanup`, upgrading it to the normal IDLE_MS lifecycle.
  scheduleUnclaimedCleanup(room);
  return { roomId: id, hostToken };
}

// Dev-only: seed 5 fake players so a single browser tab can test multiplayer flows
// without juggling incognito windows. Bots have no socket — they sit in the room as
// `connected: true` and get included in the simulation like any real player.
function seedDevBots(room: RoomState) {
  for (const name of ko.dev.botNames) {
    const token = newPlayerToken();
    const color = pickColor(room);
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
  // Defensive: roomId arrives from client payloads. A non-string would throw on
  // `.toUpperCase()` as an uncaught exception in the socket connection scope.
  if (typeof roomId !== 'string') return undefined;
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
  const color = pickColor(room);
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

/**
 * Pick the lowest unused palette color so removals / rejoins don't hand two
 * present players the same color — in marble games color is the only way to tell
 * your marble apart. Past the palette size (>12 players) collisions are
 * unavoidable, so fall back to join-order cycling.
 */
function pickColor(room: RoomState): string {
  const used = new Set<string>();
  for (const p of room.players.values()) used.add(p.color);
  for (const c of MARBLE_COLORS) if (!used.has(c)) return c;
  return MARBLE_COLORS[room.players.size % MARBLE_COLORS.length];
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
    // "Empty" = no player holds a live socket. Manual/bot players have a null
    // socketId, so a room of only manual players (host closed their tab) still
    // counts as empty and gets reaped instead of lingering the full IDLE_MS.
    const empty = ![...room.players.values()].some((p) => p.socketId !== null);
    if (idleFor >= ROOM.IDLE_MS || empty) {
      deleteRoom(room.id);
    } else {
      scheduleCleanup(room);
    }
  }, ROOM.IDLE_MS);
}

/**
 * Short-fuse cleanup for a brand-new room: if no live socket claims it within
 * UNCLAIMED_MS it's dropped immediately (squatted / abandoned). The first real
 * `join` calls `touch` → `scheduleCleanup`, replacing this with the normal
 * IDLE_MS lifecycle.
 */
function scheduleUnclaimedCleanup(room: RoomState) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    const hasLive = [...room.players.values()].some((p) => p.socketId !== null);
    if (hasLive) {
      scheduleCleanup(room);
    } else {
      deleteRoom(room.id);
    }
  }, ROOM.UNCLAIMED_MS);
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
          replay: exposesReplayData(room.gameId) ? room.currentRound.replay.data : undefined,
          // Result recovery: a client that was off the room route when `game:result`
          // fired (browser back during the round) rebuilds the result from state alone.
          ranking: room.status === 'result' ? room.currentRound.replay.ranking : undefined,
          losers: room.status === 'result' ? room.currentRound.replay.losers : undefined,
        }
      : undefined,
  };
}

// Single source of truth for socket message and room-state shapes shared between
// the server (`src/server/socket.ts`) and the client store / UI.
//
// `GameId` lives in `src/games/types.ts` so this file can be imported safely from
// either side without dragging server-only code into the client bundle.

import type { GameId } from '@/games/types';

export type RoomStatus = 'lobby' | 'charging' | 'countdown' | 'playing' | 'result';

export type PublicPlayer = {
  playerToken: string;
  nickname: string;
  connected: boolean;
  color: string;
  manual: boolean;
};

export type PublicRoomState = {
  id: string;
  status: RoomStatus;
  gameId: GameId;
  loserCount: number;
  /** playerToken currently holding host authority (null if none). A client is
   * host when its own token equals this — reassigned on host auto-promotion. */
  hostPlayerToken: string | null;
  players: PublicPlayer[];
  currentRound?: {
    gameId: GameId;
    startAt: number;
    durationMs: number;
    /** Game-specific intro data exposed for mid-play reconnects (e.g. reaction's goAt/deadlineAt). */
    replay?: unknown;
    /** Present only while status === 'result' — lets a client that missed the
     * `game:result` broadcast (navigated away mid-round) rebuild the result screen. */
    ranking?: string[];
    losers?: string[];
  };
};

export type GameStartPayload = {
  gameId: GameId;
  seed: number;
  startAt: number;
  durationMs: number;
  replay: unknown;
  players: { playerToken: string; nickname: string; color: string }[];
};

export type ResultPayload = {
  ranking: string[];
  losers: string[];
};

export type CountdownPayload = { startAt: number };

/**
 * Mid-round leaderboard snapshot for trivia. Emitted at each question's closeAt
 * (i.e. when the reveal phase begins) so clients can show running totals during
 * the reveal without learning what others picked before they answered themselves.
 * Standings are sorted server-side, descending by score.
 */
export type TriviaStandingsPayload = {
  qIndex: number;
  standings: Array<{ playerToken: string; score: number; combo: number }>;
};

/**
 * Trivia all-answered short-circuit: when every connected non-manual player has
 * picked for the current question before the timer expires, the server collapses
 * the remaining wait and advances. The new full schedule (offsets from startAt,
 * length === question count) is broadcast so every client realigns its wall-clock
 * phase calculation. Past offsets are unchanged; only `qIndex` and beyond shift.
 */
export type TriviaReschedulePayload = {
  qIndex: number;
  openAtOffsets: number[];
  closeAtOffsets: number[];
};

export type ChargeStartPayload = { endsAt: number };
export type ChargeStatePayload = { totals: Record<string, number>; cap: number };

/**
 * Live tick from the marble-tilt server-authoritative simulation. Unlike the
 * deterministic precompute path used by `marble`/`marble-cheer`, marble-tilt
 * streams positions ~60 Hz (see `TICK_HZ` in liveSim.ts) so player tilt input can
 * affect the race in real time.
 * `t` is the server tick index, useful for late-frame ordering / interpolation
 * gates. `finished` indices crossed the goal during this tick (one-shot fanfare
 * trigger). `done: true` signals the last tick — no more positions will arrive.
 */
export type MarbleTiltTickPayload = {
  t: number;
  positions: number[]; // [x0,y0,x1,y1,...] in box2d meters, rounded to .01
  finished?: number[]; // marble indices (matching playerOrder) that crossed goal this tick
  /** Marble indices whose owner triggered a boost during this tick — clients
   *  use these for one-shot visual effects (white flash + burst). */
  boosted?: number[];
  done?: boolean;
};

/**
 * Server ack for `reaction:tap`. `offsetMs` is the offset the server recorded
 * (arrival − goAt) — the exact number the result screen will later show. The
 * renderer displays this instead of its local estimate so the in-game badge and
 * the final ranking can never disagree. `recorded: false` = tap was ignored
 * (duplicate, outside window, not playing).
 */
export type ReactionTapAck = { recorded: true; offsetMs: number } | { recorded: false };

export type ErrorPayload = { code: string; message: string };

export type JoinAck =
  | { ok: true; playerToken: string; isHost: boolean }
  | { ok: false; code: string; message: string };

export type AddPlayerAck =
  | { ok: true; playerToken: string }
  | { ok: false; code: string; message: string };

export type RemovePlayerAck =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type ServerToClientEvents = {
  state: (state: PublicRoomState) => void;
  error: (payload: ErrorPayload) => void;
  countdown: (payload: CountdownPayload) => void;
  'charge:start': (payload: ChargeStartPayload) => void;
  'charge:state': (payload: ChargeStatePayload) => void;
  'game:start': (payload: GameStartPayload) => void;
  'game:result': (payload: ResultPayload) => void;
  'trivia:standings': (payload: TriviaStandingsPayload) => void;
  'trivia:reschedule': (payload: TriviaReschedulePayload) => void;
  'marble:tick': (payload: MarbleTiltTickPayload) => void;
  /** Sent to all clients right before the server exits (deploy/restart) so they
   * can show a "restarting" notice instead of a silent freeze. No payload. */
  'server:shutdown': (payload: Record<string, never>) => void;
};

export type ClientToServerEvents = {
  join: (
    payload: { roomId: string; nickname: string; playerToken?: string; hostToken?: string },
    ack: (res: JoinAck) => void,
  ) => void;
  setLoserCount: (payload: { count: number }) => void;
  setGameId: (payload: { gameId: GameId }) => void;
  start: () => void;
  reset: () => void;
  /** Charge phase: client sends cumulative tap count (idempotent). */
  'charge:tick': (payload: { count: number }) => void;
  /** Reaction game: tap signal. No payload — server uses arrival time as the source
   * of truth and returns the recorded offset via ack (display-only channel). */
  'reaction:tap': (ack?: (res: ReactionTapAck) => void) => void;
  /** Trivia game: answer for the currently open question. Server uses arrival time, not client timestamps. */
  'trivia:answer': (payload: { qIndex: number; choice: 0 | 1 | 2 | 3 }) => void;
  /** Marble-tilt: client streams normalized X-axis tilt (-1..1) at ~20 Hz while playing. */
  'marble:tilt': (payload: { x: number }) => void;
  /** Marble-tilt: instant boost (tap). Server enforces per-round budget + cooldown. */
  'marble:boost': () => void;
  'host:addPlayer': (
    payload: { nickname: string },
    ack: (res: AddPlayerAck) => void,
  ) => void;
  'host:removePlayer': (
    payload: { playerToken: string },
    ack?: (res: RemovePlayerAck) => void,
  ) => void;
};

import type { Server as IOServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../lib/protocol';
import type { RoomState } from '../rooms';

export type IO = IOServer<ClientToServerEvents, ServerToClientEvents>;

/**
 * Broadcast the round result. Server-authoritative ranking/losers only —
 * no persistence (the app is memory-only; no DB). Shared by every round flow.
 */
export function emitResult(
  io: IO,
  room: RoomState,
  replay: { ranking: string[]; losers: string[] },
) {
  io.to(room.id).emit('game:result', {
    ranking: replay.ranking,
    losers: replay.losers,
  });
}

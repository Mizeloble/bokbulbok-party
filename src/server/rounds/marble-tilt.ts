import { clearMarbleTilt, getRoom, publicRoomState, touch, type RoomState } from '../rooms';
import { GAME } from '../../lib/constants';
import { MarbleTiltLiveSim } from '../../games/marble-tilt/liveSim';
import { emitResult, type IO } from './shared';

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
export async function runMarbleTiltRound(io: IO, room: RoomState) {
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

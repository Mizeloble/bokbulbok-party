// Live, server-authoritative tilt-driven marble simulation.
//
// Differs from `simulateRace()` in `../marble/sim.ts`: that runner pre-computes
// the entire race deterministically and ships a flat `frames` array to clients
// once. This runner steps Box2D in real time, applies a per-tick force vector
// derived from each player's device orientation, and streams positions every
// ~33 ms. Live-mode determinism is intentionally given up — see `CLAUDE.md`.
//
// Lifetime: created in `runMarbleTiltRound()` (src/server/socket.ts), held on
// `room.marbleTilt`, disposed via `clearMarbleTilt()` on round end / reset / disconnect.

import { mulberry32 } from '../../lib/rng';
import { Box2dPhysics } from '../marble/lazygyu/physics';
import { stages } from '../marble/lazygyu/maps';
import { spawnMarbles } from '../marble/sim';
import type { StaticEntity } from '../marble/sim';

// --- tuning constants ------------------------------------------------------
// Centralized so they're easy to A/B in playtest. See CLAUDE.md for rationale.

/** Internal Box2D step rate. Matches the marble runner's substep cadence. */
const INTERNAL_HZ = 60;
/** Substeps per internal tick — 4 substeps × 60 Hz = 240 Hz substep rate, same
 *  as the precompute path in sim.ts. Lower values let fast marbles tunnel
 *  through pegs / cause "snap" jitter. */
const SUBSTEPS = 4;
/** Outgoing tick rate over the wire. 60 Hz halves perceived control lag vs 30 Hz
 *  at the cost of ~6 KB/s/client extra bandwidth — fine for 4–12 players. */
const TICK_HZ = 60;
/** Tilt force scale (Newtons at full deflection). At marble mass ~0.3 kg, 5N
 *  gives ~17 m/s² horizontal accel — well above gravity (10 m/s²) so a hard
 *  tilt clearly dominates the marble's trajectory through peg corridors.
 *  Lower values (1-2 N) lose the tilt signal in peg-bounce chaos. */
const TILT_FX = 5.0;
/** No tilt update for this long → treat as zero (network drop / disconnect). */
const TILT_STALE_MS = 250;
/** Boost (tap) gameplay: limited resource per round + cooldown so spam-tapping
 *  doesn't trivialize the race. 3 charges feels like "save them for tight peg
 *  clusters" pacing across a ~30s round. */
const BOOST_BUDGET_MAX = 3;
const BOOST_COOLDOWN_MS = 800;
/** Forward kick (toward goal, +Y in this stage's gravity frame). 0.3 kg marble
 *  × 2.0 N·s ≈ 6.7 m/s velocity change — clearly bursty without launching the
 *  marble off the track. */
const BOOST_IMPULSE_FORWARD = 2.0;
/** Lateral kick blends with current tilt direction. */
const BOOST_IMPULSE_LATERAL = 1.5;
/** Anti-stuck threshold copied from sim.ts (recalibrated for this tick rate). */
const STUCK_DELAY_MS = 600;
const STUCK_DIST_PER_FRAME = 0.05 * (30 / INTERNAL_HZ);
const STUCK_DIST_SQ = STUCK_DIST_PER_FRAME * STUCK_DIST_PER_FRAME;
/** Hard cap on race length. */
const MAX_SECONDS = 60;
/** Hold the final state this long before emitting `done` (lets fanfare land). */
const HOLD_MS = 1600;

const STEP_DT = 1 / (INTERNAL_HZ * SUBSTEPS);
const FRAME_MS = 1000 / INTERNAL_HZ;
const TICK_INTERVAL_MS = 1000 / INTERNAL_HZ;
const EMIT_EVERY_N_TICKS = Math.max(1, Math.round(INTERNAL_HZ / TICK_HZ));

export type LiveTiltPlayer = { playerToken: string };

export type LiveIntroData = {
  entities: StaticEntity[];
  playerOrder: string[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  goalY: number;
  zoomY: number;
  durationMsHint: number;
  /** Marble positions at spawn (flat [x0,y0,x1,y1,...]). Lets the client render
   *  marbles correctly during the countdown, before the first tick arrives. */
  initialPositions: number[];
};

export type LiveTickPayload = {
  t: number;
  positions: number[];
  finished?: number[];
  /** Marble indices boosted this tick — clients show one-shot visual on them. */
  boosted?: number[];
  done?: boolean;
};

export type LiveSimCallbacks = {
  onTick: (payload: LiveTickPayload) => void;
  onFinish: (result: { ranking: string[]; losers: string[]; durationMs: number }) => void;
};

export class MarbleTiltLiveSim {
  private physics: Box2dPhysics | null = null;
  private players: LiveTiltPlayer[];
  private loserCount: number;
  private callbacks: LiveSimCallbacks;
  private seed: number;
  private rng: () => number;

  // Per-marble tilt state, keyed by playerToken (so disconnects don't break index alignment).
  private tilts = new Map<string, { x: number; ts: number }>();

  // Per-player remaining boost budget + last-boost timestamp (server enforces).
  private boostBudget = new Map<string, number>();
  private boostLastAt = new Map<string, number>();
  // Marble indices boosted since the last tick emit; drained into `payload.boosted`.
  private pendingBoosts = new Set<number>();

  // Anti-stuck per marble.
  private lastPos = new Map<number, { x: number; y: number }>();
  private stuckMs = new Map<number, number>();

  // Finishing state.
  private finishedSet = new Set<number>();
  private finishOrder: string[] = [];
  private frozenPositions = new Map<number, { x: number; y: number }>();

  private goalY = 0;
  private tickIndex = 0;
  private startedAtMs = 0;
  private nextTickAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private finished = false;
  private intro: LiveIntroData | null = null;
  /** Wall-clock at which the race ended (loser locked in or timeout). 0 means
   *  race still in progress. After this is set, ticks keep flowing for HOLD_MS
   *  so the client's fanfare/rank-card animations have continuous tickIdx
   *  progression to play out against. */
  private raceEndedAtMs = 0;
  /** Final ranking, computed once at race end. */
  private finalResult: { ranking: string[]; losers: string[] } | null = null;

  constructor(opts: {
    seed: number;
    players: LiveTiltPlayer[];
    loserCount: number;
    callbacks: LiveSimCallbacks;
  }) {
    this.seed = opts.seed;
    this.players = opts.players;
    this.loserCount = Math.max(1, opts.loserCount);
    this.callbacks = opts.callbacks;
    this.rng = mulberry32(opts.seed);
  }

  /**
   * Boot box2d, build the stage, spawn marbles. Returns the static intro data
   * to ship in `game:start` so clients can render the world before the first
   * tick arrives.
   */
  async init(): Promise<LiveIntroData> {
    const physics = new Box2dPhysics(this.rng);
    await physics.init();
    const stage = stages[0];
    physics.createStage(stage);
    spawnMarbles(physics, this.players, this.rng /* no chargeRatios for tilt */);
    physics.start();

    // Snapshot static + kinematic entities (for client rendering).
    const entities: StaticEntity[] = physics.getEntities().map((e, idx) => {
      const src = stage.entities?.[idx];
      const isKinematic = src?.type === 'kinematic';
      return {
        x: e.x,
        y: e.y,
        shape: e.shape,
        angularVelocity: src?.props.angularVelocity ?? 0,
        isKinematic,
      };
    });

    // Compute coordinate bounds the same way sim.ts does, so the camera fits.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const e of entities) {
      if (e.shape.type === 'polyline') {
        for (const [px, py] of e.shape.points) {
          const ax = e.x + px;
          const ay = e.y + py;
          if (ax < minX) minX = ax;
          if (ax > maxX) maxX = ax;
          if (ay < minY) minY = ay;
          if (ay > maxY) maxY = ay;
        }
      }
    }
    if (minY < 0) minY = 0;

    this.physics = physics;
    this.goalY = stage.goalY;

    // Snapshot initial marble positions so the client has something accurate to
    // draw during the countdown phase, before the first live tick arrives.
    const initialPositions = new Array<number>(this.players.length * 2);
    for (let i = 0; i < this.players.length; i++) {
      const p = physics.getMarblePosition(i);
      initialPositions[i * 2] = round2(p.x);
      initialPositions[i * 2 + 1] = round2(p.y);
    }

    this.intro = {
      entities,
      playerOrder: this.players.map((p) => p.playerToken),
      bounds: { minX, maxX, minY, maxY },
      goalY: stage.goalY,
      zoomY: stage.zoomY,
      durationMsHint: MAX_SECONDS * 1000,
      initialPositions,
    };
    return this.intro;
  }

  /** Update the latest tilt for a player. Caller validates + clamps to [-1,1]. */
  setTilt(playerToken: string, x: number): void {
    if (!Number.isFinite(x)) return;
    this.tilts.set(playerToken, { x: Math.max(-1, Math.min(1, x)), ts: Date.now() });
  }

  /** Try to apply a boost impulse for the given player. Returns true if applied
   *  (caller can use this for ack/UI sync). Silent no-op if budget exhausted,
   *  cooldown still active, marble already finished, or race not in progress. */
  tryBoost(playerToken: string): boolean {
    if (this.raceEndedAtMs > 0) return false;
    if (!this.physics) return false;
    const idx = this.players.findIndex((p) => p.playerToken === playerToken);
    if (idx < 0 || this.frozenPositions.has(idx)) return false;

    const now = Date.now();
    const budget = this.boostBudget.get(playerToken) ?? BOOST_BUDGET_MAX;
    if (budget <= 0) return false;
    const lastAt = this.boostLastAt.get(playerToken) ?? 0;
    if (now - lastAt < BOOST_COOLDOWN_MS) return false;

    // Blend a forward kick (+Y, toward goal) with a lateral kick in the current
    // tilt direction so the boost feels like an intentional "leap that direction"
    // rather than an arbitrary forward shove.
    const tilt = this.tilts.get(playerToken);
    const tiltX = tilt && now - tilt.ts <= TILT_STALE_MS ? tilt.x : 0;
    this.physics.applyImpulseToMarble(
      idx,
      tiltX * BOOST_IMPULSE_LATERAL,
      BOOST_IMPULSE_FORWARD,
    );

    this.boostBudget.set(playerToken, budget - 1);
    this.boostLastAt.set(playerToken, now);
    this.pendingBoosts.add(idx);
    return true;
  }

  /** Remaining boost budget for a player (clients reflect this in their UI). */
  getBoostBudget(playerToken: string): number {
    return this.boostBudget.get(playerToken) ?? BOOST_BUDGET_MAX;
  }

  /** Begin the tick loop. Caller should already have emitted `game:start`. */
  start(): void {
    if (this.timer) return;
    this.startedAtMs = Date.now();
    this.nextTickAt = this.startedAtMs;
    this.scheduleNextTick();
  }

  /** Self-correcting setTimeout loop: each tick computes its target fire time
   *  from the start of the round, so individual delays don't accumulate drift.
   *  If a tick handler runs long, the next setTimeout delay clamps to 0 and
   *  fires immediately to catch up. */
  private scheduleNextTick(): void {
    if (this.finished) return;
    this.nextTickAt += TICK_INTERVAL_MS;
    const delay = Math.max(0, this.nextTickAt - Date.now());
    this.timer = setTimeout(() => {
      this.tick();
      this.scheduleNextTick();
    }, delay);
  }

  /** Tear down everything. Idempotent. */
  dispose(): void {
    this.finished = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.physics) {
      // box2d-wasm has no explicit world destructor; we just drop the reference.
      this.physics = null;
    }
    this.tilts.clear();
  }

  // -------------------------------------------------------------------------

  private tick(): void {
    if (this.finished || !this.physics) return;
    const now = Date.now();
    const racePhase = this.raceEndedAtMs === 0;

    // Apply per-marble tilt force BEFORE stepping. Stale entries decay to zero.
    // After race end (hold phase) we stop applying tilt so finished marbles
    // don't drift forever and the loser doesn't get pushed sideways while the
    // result animations play out.
    if (racePhase) {
      for (let i = 0; i < this.players.length; i++) {
        if (this.frozenPositions.has(i)) continue;
        const token = this.players[i].playerToken;
        const t = this.tilts.get(token);
        let fx = 0;
        if (t && now - t.ts <= TILT_STALE_MS) {
          fx = t.x * TILT_FX;
        }
        if (fx !== 0) this.physics.applyForceToMarble(i, fx, 0);
      }
    }

    // Advance physics. Substeps × tick rate = 240 Hz substep — same stability
    // buffer as the precompute path.
    for (let s = 0; s < SUBSTEPS; s++) this.physics.step(STEP_DT);

    // Sample positions, anti-stuck check, finish detection.
    const positions = new Array<number>(this.players.length * 2);
    const finishedThisTick: number[] = [];
    for (let i = 0; i < this.players.length; i++) {
      const frozen = this.frozenPositions.get(i);
      const p = frozen ?? this.physics.getMarblePosition(i);
      positions[i * 2] = round2(p.x);
      positions[i * 2 + 1] = round2(p.y);

      if (frozen) continue;

      const prev = this.lastPos.get(i);
      if (prev) {
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        if (dx * dx + dy * dy < STUCK_DIST_SQ) {
          const total = (this.stuckMs.get(i) ?? 0) + FRAME_MS;
          this.stuckMs.set(i, total);
          if (total >= STUCK_DELAY_MS) {
            this.physics.shakeMarble(i);
            this.stuckMs.set(i, 0);
          }
        } else {
          this.stuckMs.set(i, 0);
        }
      }
      this.lastPos.set(i, { x: p.x, y: p.y });

      if (p.y > this.goalY) {
        this.finishedSet.add(i);
        this.finishOrder.push(this.players[i].playerToken);
        this.frozenPositions.set(i, { x: p.x, y: this.goalY + 0.5 });
        this.physics.removeMarble(i);
        finishedThisTick.push(i);
      }
    }

    // Detect race end → freeze ranking, but KEEP TICKING through the hold so
    // the client's tickIdx progresses naturally (which drives all rank-card /
    // banner animations). Without this the card alpha freezes at ~0 when the
    // race ends and never reaches full opacity.
    if (racePhase) {
      const elapsed = now - this.startedAtMs;
      const enoughFinished = this.finishedSet.size >= this.players.length - this.loserCount;
      const timedOut = elapsed >= MAX_SECONDS * 1000;
      if (enoughFinished || timedOut) {
        this.raceEndedAtMs = now;
        this.finalResult = this.computeFinalResult();
      }
    }

    // Last tick of the round: mark `done` and tear down the timer. Either
    // immediately if we hit the timeout / loser-decided gate AND the hold has
    // also elapsed, or just at HOLD_MS past raceEndedAtMs in the normal case.
    const isDoneTick =
      this.raceEndedAtMs > 0 && now - this.raceEndedAtMs >= HOLD_MS;

    // Emit at the configured wire rate, plus on every tick where something
    // visually important changed (a finish, a boost, or the final done) —
    // those carry single-fire fanfare triggers and must not be coalesced away.
    const hasBoost = this.pendingBoosts.size > 0;
    const shouldEmit =
      this.tickIndex % EMIT_EVERY_N_TICKS === 0 ||
      finishedThisTick.length > 0 ||
      hasBoost ||
      isDoneTick;
    if (shouldEmit) {
      const payload: LiveTickPayload = { t: this.tickIndex, positions };
      if (finishedThisTick.length > 0) payload.finished = finishedThisTick;
      if (hasBoost) {
        payload.boosted = [...this.pendingBoosts];
        this.pendingBoosts.clear();
      }
      if (isDoneTick) payload.done = true;
      this.callbacks.onTick(payload);
    }
    this.tickIndex++;

    if (isDoneTick && this.finalResult) {
      this.finished = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      const elapsed = now - this.startedAtMs;
      this.callbacks.onFinish({
        ranking: this.finalResult.ranking,
        losers: this.finalResult.losers,
        durationMs: elapsed,
      });
    }
  }

  /**
   * Build the final ranking + losers list from the current finishOrder, ranking
   * any stragglers (who didn't cross the goal) by their current Y position.
   * Called once at race end.
   */
  private computeFinalResult(): { ranking: string[]; losers: string[] } {
    const finishOrder = this.finishOrder.slice();
    if (this.finishedSet.size < this.players.length && this.physics) {
      const remaining: { idx: number; y: number }[] = [];
      for (let i = 0; i < this.players.length; i++) {
        if (this.finishedSet.has(i)) continue;
        const frozen = this.frozenPositions.get(i);
        const p = frozen ?? this.physics.getMarblePosition(i);
        remaining.push({ idx: i, y: p.y });
      }
      remaining.sort((a, b) => b.y - a.y);
      for (const r of remaining) finishOrder.push(this.players[r.idx].playerToken);
    }
    const losers = finishOrder.slice(-this.loserCount);
    return { ranking: finishOrder, losers };
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

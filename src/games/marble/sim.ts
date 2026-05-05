import { mulberry32 } from './rng';
import { Box2dPhysics } from './lazygyu/physics';
import { stages } from './lazygyu/maps';
import type { MapEntityState } from './lazygyu/MapEntity';

export type StaticEntity = {
  x: number;
  y: number;
  shape: MapEntityState['shape'];
  // For kinematic entities (rotors), constant angular velocity in rad/s — clients animate locally.
  angularVelocity: number;
  isKinematic: boolean;
};

export type SimulationResult = {
  fps: number;
  durationMs: number;
  // frames[i] = flat [x0,y0,x1,y1,...] of marble positions in box2d meters at frame i
  frames: number[][];
  // playerToken order matching the indices in each frame
  playerOrder: string[];
  // first to finish ... last to finish (last = worst)
  finishOrder: string[];
  // For each playerOrder index: the frame on which the marble crossed the goal line, or -1 if never finished.
  // Used by the client to spawn finish-line fanfare particles at the right moment.
  finishFrames: number[];
  // Static + kinematic entities to draw on the client (sent once per round)
  entities: StaticEntity[];
  goalY: number;
  zoomY: number;
  // box2d coordinate range (for camera sizing on client)
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  // Per-frame playback duration in ms. Currently uniform (no slow-mo) but kept as
  // an array so future per-frame pacing tweaks don't require a wire-format change.
  frameDurations: number[];
  // marble-cheer only: charge ratio per player (playerOrder-indexed, 0..1).
  // Used by the renderer to draw an outer glow on cheered marbles. `undefined`
  // for plain `marble` runs.
  chargeRatios?: number[];
};

const FPS = 120; // recording FPS; client interpolates between frames if higher refresh
const STEP_DT = 1 / 240; // physics substep — 240Hz for stable contacts with fast marbles
const STEPS_PER_FRAME = 2; // 240 / 120 = 2 substeps per recorded frame
const MAX_SECONDS = 60;
const MAX_FRAMES = MAX_SECONDS * FPS;

export async function simulateRace(
  seed: number,
  players: { playerToken: string }[],
  chargeRatios?: Record<string, number>,
): Promise<SimulationResult> {
  const rng = mulberry32(seed);

  const physics = new Box2dPhysics(rng);
  await physics.init();

  const stage = stages[0];
  physics.createStage(stage);

  // Marble spawn — line/slot grid ported from lazygyu/src/marble.ts:72, but slots
  // within each line are now picked randomly (seeded) instead of filled left-to-right,
  // so each round looks visibly different. With ≤10 players in line 0, this means
  // the marbles spread out across the full spawn band (e.g. positions 0,3,5,8,9)
  // rather than always clustering at the left.
  const SLOTS_PER_LINE = 10;
  const max = players.length;
  const maxLine = Math.ceil(max / 10);
  const lineDelta = -Math.max(0, Math.ceil(maxLine - 5));

  // Build the pool of (line, slotInLine) positions, picking distinct slots per line.
  const positions: { line: number; slotInLine: number }[] = [];
  let remaining = players.length;
  for (let l = 0; remaining > 0; l++) {
    const slotPool: number[] = [];
    for (let k = 0; k < SLOTS_PER_LINE; k++) slotPool.push(k);
    // Fisher–Yates with the seeded rng so the layout is reproducible per seed.
    for (let k = slotPool.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [slotPool[k], slotPool[j]] = [slotPool[j], slotPool[k]];
    }
    const count = Math.min(remaining, SLOTS_PER_LINE);
    for (let k = 0; k < count; k++) positions.push({ line: l, slotInLine: slotPool[k] });
    remaining -= count;
  }
  // Shuffle player→position mapping so player[0] doesn't always end up in line 0.
  for (let k = positions.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [positions[k], positions[j]] = [positions[j], positions[k]];
  }

  // Per-player ratio array, ordered to match `players` (and thus `playerOrder`).
  const ratios: number[] = new Array(players.length).fill(0);
  for (let i = 0; i < players.length; i++) {
    const { line, slotInLine } = positions[i];
    const x = 10.25 + slotInLine * 0.6;
    const baseY = maxLine - line + lineDelta;
    const ratio = chargeRatios?.[players[i].playerToken] ?? 0;
    ratios[i] = ratio;
    // Cheered marbles spawn well ahead of the pack (positive y is downward in box2d
    // gravity here). Up to 5.0m of head-start — clearly separated from non-cheered
    // marbles the moment the race begins; head-start is the *primary* visual cue
    // for the cheer effect.
    const y = baseY + 5.0 * ratio;
    physics.createMarble(i, x, y, ratio);
  }

  physics.start();

  // Snapshot static/kinematic entities once
  const initialEntities: StaticEntity[] = physics.getEntities().map((e, idx) => {
    // Determine if the body is kinematic by checking the source map entity (we can't easily ask the body)
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

  const frames: number[][] = [];
  const finishOrder: string[] = [];
  const finishedSet = new Set<number>();
  const finishFrames: number[] = new Array(players.length).fill(-1);
  // Once a marble crosses the goal line, freeze its position (cosmetically) and remove from physics
  const frozenPositions = new Map<number, { x: number; y: number }>();
  // Anti-stuck (ported from lazygyu/src/marble.ts): if marble barely moves for STUCK_DELAY ms, shake it
  const lastPos = new Map<number, { x: number; y: number }>();
  const stuckMs = new Map<number, number>();
  const STUCK_DELAY_MS = 600;
  // Velocity threshold: ~1.5 m/s (originally "5cm per 30Hz frame"). Scale per-frame distance with FPS.
  const stuckDistPerFrame = 0.05 * (30 / FPS);
  const STUCK_DIST_SQ = stuckDistPerFrame * stuckDistPerFrame;
  const FRAME_MS = 1000 / FPS;

  let frameIdx = 0;

  while (frameIdx < MAX_FRAMES) {
    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      physics.step(STEP_DT);
    }

    const snap = new Array(players.length * 2);
    for (let i = 0; i < players.length; i++) {
      const frozen = frozenPositions.get(i);
      const p = frozen ?? physics.getMarblePosition(i);
      snap[i * 2] = round2(p.x);
      snap[i * 2 + 1] = round2(p.y);

      if (frozen) continue;

      // Anti-stuck
      const prev = lastPos.get(i);
      if (prev) {
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        if (dx * dx + dy * dy < STUCK_DIST_SQ) {
          const total = (stuckMs.get(i) ?? 0) + FRAME_MS;
          stuckMs.set(i, total);
          if (total >= STUCK_DELAY_MS) {
            physics.shakeMarble(i);
            stuckMs.set(i, 0);
          }
        } else {
          stuckMs.set(i, 0);
        }
      }
      lastPos.set(i, { x: p.x, y: p.y });

      if (p.y > stage.goalY) {
        finishedSet.add(i);
        finishOrder.push(players[i].playerToken);
        finishFrames[i] = frameIdx;
        frozenPositions.set(i, { x: p.x, y: stage.goalY + 0.5 });
        physics.removeMarble(i);
      }
    }
    frames.push(snap);
    frameIdx++;

    // Stop as soon as N-1 finish — the loser is mathematically decided at that moment,
    // and watching them crawl across the line afterward is anticlimactic.
    if (finishedSet.size >= players.length - 1) break;
  }

  // Stragglers ranked by how far they got (higher y = closer to goal). With the
  // N-1 exit above, this is normally just the loser — appended once so finishOrder
  // is complete.
  if (finishedSet.size < players.length) {
    const lastFrame = frames[frames.length - 1];
    const remaining: { idx: number; y: number }[] = [];
    for (let i = 0; i < players.length; i++) {
      if (!finishedSet.has(i)) remaining.push({ idx: i, y: lastFrame[i * 2 + 1] });
    }
    remaining.sort((a, b) => b.y - a.y);
    for (const r of remaining) finishOrder.push(players[r.idx].playerToken);
  }

  // Hold final state for ~1.6s so the loser-decided fanfare and personal rank cards
  // have time to register before the result screen takes over.
  const HOLD_FRAMES = Math.ceil(FPS * 1.6);
  if (frames.length > 0) {
    const lastSnap = frames[frames.length - 1];
    for (let h = 0; h < HOLD_FRAMES; h++) frames.push(lastSnap.slice());
  }

  // Playback runs at recording FPS — no slow-motion. The N-1 reveal moment carries
  // the drama on its own (fanfare + banner + 1.6s hold).
  const realFrameMs = 1000 / FPS;
  const frameDurations: number[] = new Array(frames.length).fill(realFrameMs);
  const stretchedDurationMs = frames.length * realFrameMs;

  // Compute coordinate bounds from static entities for camera sizing
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const e of initialEntities) {
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
  // Cap the upper invisible reach (polylines extend to y=-300 visually invisible)
  if (minY < 0) minY = 0;

  return {
    fps: FPS,
    durationMs: Math.round(stretchedDurationMs),
    frames,
    playerOrder: players.map((p) => p.playerToken),
    finishOrder,
    finishFrames,
    entities: initialEntities,
    goalY: stage.goalY,
    zoomY: stage.zoomY,
    bounds: { minX, maxX, minY, maxY },
    frameDurations,
    chargeRatios: chargeRatios ? ratios : undefined,
  };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

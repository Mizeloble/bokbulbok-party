// Ported from https://github.com/lazygyu/roulette/blob/main/src/physics-box2d.ts
// (MIT, © 2023 LazyGyu). Modified: every Math.random() call replaced with an
// injected seeded RNG so the sim is deterministic given the same seed.
import Box2DFactory from 'box2d-wasm';
import type { StageDef } from './maps';
import type { MapEntity, MapEntityState } from './MapEntity';

export type Rng = () => number; // returns [0,1)

// Cache the WASM bytes across simulations so we don't reload from disk every game.
let cachedWasmBinary: Uint8Array | null = null;
async function loadWasmBinary(): Promise<Uint8Array> {
  if (cachedWasmBinary) return cachedWasmBinary;
  const fs = await import('node:fs/promises');
  const mod = (await import('node:module')) as unknown as { createRequire: (p: string) => NodeRequire };
  const path = await import('node:path');
  const req = mod.createRequire(path.join(process.cwd(), 'package.json'));
  const pkgPath: string = req.resolve('box2d-wasm/dist/umd/Box2D.simd.js');
  const wasmPath = path.join(path.dirname(pkgPath), 'Box2D.simd.wasm');
  cachedWasmBinary = await fs.readFile(wasmPath);
  return cachedWasmBinary;
}

// Cache the instantiated Emscripten module across simulations. Previously every
// `init()` called `Box2DFactory()`, spinning up a fresh WASM module instance that
// was never freed — so each race leaked a whole module and a long-lived server
// would OOM (the fairness harness in scripts/ works around this by forking a
// child per N). Reuse one module and just create/destroy a b2World per sim
// (`dispose()`); the single-instance server runs sims serially on one event loop,
// so there's no concurrent-access hazard.
type Box2DModule = Awaited<ReturnType<typeof Box2DFactory>>;
let cachedModule: Box2DModule | null = null;
let modulePromise: Promise<Box2DModule> | null = null;
async function getBox2D(): Promise<Box2DModule> {
  if (cachedModule) return cachedModule;
  // Guard against concurrent first-callers racing two factory inits.
  if (!modulePromise) {
    modulePromise =
      typeof window === 'undefined'
        ? loadWasmBinary().then((wasmBinary) =>
            Box2DFactory({ wasmBinary } as unknown as Parameters<typeof Box2DFactory>[0]),
          )
        : Box2DFactory();
  }
  cachedModule = await modulePromise;
  return cachedModule;
}

export class Box2dPhysics {
  private rng: Rng;
  private Box2D!: Awaited<ReturnType<typeof Box2DFactory>>;
  private gravity!: Box2D.b2Vec2;
  private world!: Box2D.b2World;

  private marbleMap: { [id: number]: Box2D.b2Body } = {};
  private entities: ({ body: Box2D.b2Body } & MapEntityState)[] = [];

  private deleteCandidates: Box2D.b2Body[] = [];

  constructor(rng: Rng) {
    this.rng = rng;
  }

  async init(): Promise<void> {
    this.Box2D = await getBox2D();
    this.gravity = new this.Box2D.b2Vec2(0, 10);
    this.world = new this.Box2D.b2World(this.gravity);
  }

  clear(): void {
    this.clearEntities();
  }

  /** Free WASM-heap allocations owned by this sim. MUST be called when the sim is
   *  done (the module is shared/cached, so anything not freed accumulates). The
   *  b2World destructor frees all bodies/fixtures/shapes attached to it; `gravity`
   *  is a standalone vec we own. Idempotent. */
  dispose(): void {
    if (this.world) {
      this.free(this.world);
      this.world = undefined as unknown as Box2D.b2World;
    }
    if (this.gravity) {
      this.free(this.gravity);
      this.gravity = undefined as unknown as Box2D.b2Vec2;
    }
    this.marbleMap = {};
    this.entities = [];
    this.deleteCandidates = [];
  }

  /** Destroy embind objects via the module's free function. box2d-wasm copies
   *  defs/shapes/vecs into the bodies it builds, so transients can be freed right
   *  after they're consumed — otherwise each one leaks into the shared module. */
  private free(...objs: unknown[]): void {
    const B = this.Box2D as unknown as { destroy(o: unknown): void };
    for (const o of objs) if (o) B.destroy(o);
  }

  clearMarbles(): void {
    Object.values(this.marbleMap).forEach((body) => {
      this.world.DestroyBody(body);
    });
    this.marbleMap = {};
  }

  createStage(stage: StageDef): void {
    this.createEntities(stage.entities);
  }

  createEntities(entities?: MapEntity[]) {
    if (!entities) return;
    const bodyTypes = {
      static: this.Box2D.b2_staticBody,
      kinematic: this.Box2D.b2_kinematicBody,
    } as const;

    entities.forEach((entity) => {
      const bodyDef = new this.Box2D.b2BodyDef();
      bodyDef.set_type(bodyTypes[entity.type]);
      const body = this.world.CreateBody(bodyDef);

      const fixtureDef = new this.Box2D.b2FixtureDef();
      fixtureDef.set_density(entity.props.density);
      // Floor restitution at 0.3 so the many `restitution: 0` static pegs in maps.ts
      // don't form perfect stable-equilibrium pockets between two pegs (a major
      // cause of mid-race stalls). Values that explicitly set restitution > 0.3
      // (e.g. bouncy paddles at 1.5) keep their original feel.
      fixtureDef.set_restitution(Math.max(0.3, entity.props.restitution));
      // box2d default friction (0.2) is high enough that marbles can grip pegs
      // and rest on them — drop to 0.1 so contacts slide off naturally.
      fixtureDef.set_friction(0.1);

      let shape: Box2D.b2PolygonShape | Box2D.b2CircleShape | undefined;
      switch (entity.shape.type) {
        case 'box':
          shape = new this.Box2D.b2PolygonShape();
          shape.SetAsBox(entity.shape.width, entity.shape.height, undefined as unknown as Box2D.b2Vec2, entity.shape.rotation);
          fixtureDef.set_shape(shape);
          body.CreateFixture(fixtureDef);
          break;
        case 'polyline':
          for (let i = 0; i < entity.shape.points.length - 1; i++) {
            const p1 = entity.shape.points[i];
            const p2 = entity.shape.points[i + 1];
            const v1 = new this.Box2D.b2Vec2(p1[0], p1[1]);
            const v2 = new this.Box2D.b2Vec2(p2[0], p2[1]);
            const edge = new this.Box2D.b2EdgeShape();
            edge.SetTwoSided(v1, v2);
            body.CreateFixture(edge, 1);
            this.free(edge, v1, v2);
          }
          break;
        case 'circle':
          shape = new this.Box2D.b2CircleShape();
          shape.set_m_radius(entity.shape.radius);
          fixtureDef.set_shape(shape);
          body.CreateFixture(fixtureDef);
          break;
      }

      body.SetAngularVelocity(entity.props.angularVelocity);
      const xf = new this.Box2D.b2Vec2(entity.position.x, entity.position.y);
      body.SetTransform(xf, 0);
      this.free(bodyDef, fixtureDef, xf);
      if (shape) this.free(shape);
      this.entities.push({
        body,
        x: entity.position.x,
        y: entity.position.y,
        angle: 0,
        shape: entity.shape,
        life: entity.props.life ?? -1,
      });
    });
  }

  clearEntities() {
    this.entities.forEach((entity) => {
      this.world.DestroyBody(entity.body);
    });
    this.entities = [];
  }

  /**
   * `chargeRatio` ∈ [0,1] is a per-marble cheering boost from the pre-charge phase
   * (used by `marble-cheer`). At max ratio: radius -18%, density +35%. The renderer
   * draws an outer glow + a slightly smaller body proportional to ratio (see
   * scene.ts), so the "응원 받은 마블" cue is unmistakable visually as well as
   * mechanically. Untouched marbles (`marble`) pass `0` → identical to legacy
   * relative behavior; absolute physics tone is now glass-marble (restitution 0.3,
   * low friction, mild damping, CCD bullet) rather than the dead clay of stock
   * lazygyu defaults.
   */
  createMarble(id: number, x: number, y: number, chargeRatio = 0): void {
    const ratio = Math.max(0, Math.min(1, chargeRatio));
    const radius = 0.25 * (1 - 0.18 * ratio);
    const circleShape = new this.Box2D.b2CircleShape();
    circleShape.set_m_radius(radius);

    const bodyDef = new this.Box2D.b2BodyDef();
    bodyDef.set_type(this.Box2D.b2_dynamicBody);
    const spawnPos = new this.Box2D.b2Vec2(x, y);
    bodyDef.set_position(spawnPos);
    // Mild air drag so terminal speed doesn't run away on long drops.
    bodyDef.set_linearDamping(0.05);
    // Kill the "spinning forever in air" look — marbles taper their spin naturally.
    bodyDef.set_angularDamping(0.1);
    // CCD on: at 10+ m/s a marble can travel its own diameter in one substep,
    // which occasionally tunnelled through thin pegs.
    bodyDef.set_bullet(true);

    const body = this.world.CreateBody(bodyDef);

    // Seeded RNG instead of Math.random() so density (and therefore the result)
    // is reproducible. Order/count of rng() calls in this method must not change.
    const baseDensity = 1 + this.rng();
    const fix = new this.Box2D.b2FixtureDef();
    fix.set_shape(circleShape);
    fix.set_density(baseDensity * (1 + 0.35 * ratio));
    // Low friction so marbles slide off pegs instead of resting on them. Combines
    // with peg friction 0.1 via box2d's mix → ~0.07 effective.
    fix.set_friction(0.05);
    // Glass-marble bounce. Mixes by max() with peg restitution (0.3 floor) → 0.3.
    fix.set_restitution(0.3);
    body.CreateFixture(fix);

    body.SetAwake(false);
    body.SetEnabled(false);
    this.marbleMap[id] = body;
    this.free(circleShape, bodyDef, spawnPos, fix);
  }

  shakeMarble(id: number): void {
    const body = this.marbleMap[id];
    if (body) {
      // Bias the unstuck impulse downward (+Y is the goal direction in this map's
      // gravity) and keep magnitude small so we nudge the marble loose without
      // flicking it across the screen. rng() is still called twice in the same
      // order so determinism is preserved.
      const ix = this.rng() * 4 - 2;
      const iy = 2 + this.rng() * 3;
      const impulse = new this.Box2D.b2Vec2(ix, iy);
      body.ApplyLinearImpulseToCenter(impulse, true);
      this.free(impulse);
    }
  }

  // Used by the live tilt mode (`marble-tilt`) to apply a per-tick force vector
  // derived from device orientation. Pure marble (deterministic precompute) does
  // not call this — keeping it out of `step()` means determinism is preserved.
  applyForceToMarble(id: number, fx: number, fy: number): void {
    const body = this.marbleMap[id];
    if (!body) return;
    const v = new this.Box2D.b2Vec2(fx, fy);
    body.ApplyForceToCenter(v, true);
    this.free(v);
  }

  // Used by marble-tilt's boost (tap) mechanic to give a marble an instantaneous
  // velocity kick. Force is integrated over time; impulse changes velocity in one shot.
  applyImpulseToMarble(id: number, ix: number, iy: number): void {
    const body = this.marbleMap[id];
    if (!body) return;
    const v = new this.Box2D.b2Vec2(ix, iy);
    body.ApplyLinearImpulseToCenter(v, true);
    this.free(v);
  }

  hasMarble(id: number): boolean {
    return id in this.marbleMap;
  }

  removeMarble(id: number): void {
    const marble = this.marbleMap[id];
    if (marble) {
      this.world.DestroyBody(marble);
      delete this.marbleMap[id];
    }
  }

  getMarblePosition(id: number): { x: number; y: number; angle: number } {
    const marble = this.marbleMap[id];
    if (marble) {
      const pos = marble.GetPosition();
      return { x: pos.x, y: pos.y, angle: marble.GetAngle() };
    }
    return { x: 0, y: 0, angle: 0 };
  }

  getEntities(): MapEntityState[] {
    return this.entities.map((entity) => ({
      ...entity,
      angle: entity.body.GetAngle(),
    }));
  }

  start(): void {
    for (const key in this.marbleMap) {
      const marble = this.marbleMap[key];
      marble.SetAwake(true);
      marble.SetEnabled(true);
    }
  }

  step(deltaSeconds: number): void {
    this.deleteCandidates.forEach((body) => {
      this.world.DestroyBody(body);
    });
    this.deleteCandidates = [];

    // Bumped from (6, 2) → (8, 3): the start grid drops 4–12 marbles in one
    // tight band and contact resolution sometimes produced odd jitters there.
    // Server-side single-pass sim, so the extra iters are free in practice.
    this.world.Step(deltaSeconds, 8, 3);

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const entity = this.entities[i];
      if (entity.life > 0) {
        const edge = entity.body.GetContactList();
        if (edge.contact?.IsTouching()) {
          this.deleteCandidates.push(entity.body);
          this.entities.splice(i, 1);
        }
      }
    }
  }
}

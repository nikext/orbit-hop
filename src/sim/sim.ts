import {
  CHARGE_TICKS,
  COMBO_MAX,
  COMBO_WINDOW_S,
  DT,
  DUST_R,
  FLIGHT_TIMEOUT_S,
  FLOOR_BELOW_ANCHOR,
  GEN_AHEAD,
  HALF_W,
  LAUNCH_MAX,
  LAUNCH_MIN,
  NEAR_MISS_BAND,
  ORBIT_SPEED,
  ORBIT_W_MAX,
  ORBIT_W_MIN,
  POINTS_CAPTURE,
  POINTS_DUST,
  POINTS_NEAR_MISS,
  POINTS_SLINGSHOT,
  PROBE_R,
  RECYCLE_BELOW,
  SIDE_MARGIN,
  TICK_HZ,
} from './constants';
import { type Body, type Dust, Generator, bodyVX, bodyVY, bodyX, bodyY, pulseActive } from './world';

export type ProbeMode = 'orbit' | 'flight' | 'dead';
export type DeathCause = 'crash' | 'rock' | 'hole' | 'out' | 'fall' | 'lost';

export type SimEvent =
  | { type: 'launch'; x: number; y: number; charge: number }
  | { type: 'capture'; x: number; y: number; bodyId: number; points: number; combo: number; fast: boolean }
  | { type: 'near'; x: number; y: number; points: number }
  | { type: 'dust'; x: number; y: number; points: number }
  | { type: 'slingshot'; x: number; y: number; points: number }
  | { type: 'death'; x: number; y: number; cause: DeathCause; vx: number; vy: number };

export interface RunStats {
  captures: number;
  nearMisses: number;
  dust: number;
  slingshots: number;
  maxCombo: number;
  /** Highest y reached, in world units. */
  height: number;
  /** Ticks since the first launch. */
  playTicks: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Launch speed for a charge level in 0..1. Slight ease-in so small holds stay controllable. */
export function launchSpeed(charge: number): number {
  const c = clamp(charge, 0, 1);
  return LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * (0.35 * c + 0.65 * c * c);
}

/**
 * The deterministic headless simulation. Advance it with `step(held)` at a
 * fixed 120 Hz. Given the same seed and the same per-tick `held` values it
 * produces exactly the same run. It never touches the DOM.
 */
export class Sim {
  readonly seed: number;
  gen!: Generator;
  bodies: Body[] = [];
  dust: Dust[] = [];
  tick = 0;

  // Probe state.
  mode: ProbeMode = 'orbit';
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  anchor!: Body;
  prevAnchorId = -1;
  orbitAngle = -Math.PI / 2;
  orbitR = 0;
  orbitDir = 1;
  orbitW = 0;
  holding = false;
  holdTicks = 0;
  flightTicks = 0;
  launches = 0;
  /** Ids of bodies the probe is currently skimming (near-miss candidates). */
  skims: number[] = [];
  /** Id of the black hole whose ring the probe is inside, or -1. */
  ringHole = -1;

  floor = 0;
  score = 0;
  combo = 1;
  deathCause: DeathCause | null = null;
  stats: RunStats = { captures: 0, nearMisses: 0, dust: 0, slingshots: 0, maxCombo: 1, height: 0, playTicks: 0 };

  /** Events produced by the last step(s). The owner drains it. Bounded by `clearEvents`. */
  events: SimEvent[] = [];
  recordEvents = true;

  constructor(seed: number, from?: Sim) {
    this.seed = seed >>> 0;
    if (from) {
      // Clone path: same field order as a fresh sim, so V8 keeps one object shape.
      this.gen = from.gen.clone();
      this.bodies = from.bodies.slice();
      this.dust = from.dust.slice();
      this.tick = from.tick;
      this.mode = from.mode;
      this.x = from.x;
      this.y = from.y;
      this.vx = from.vx;
      this.vy = from.vy;
      this.anchor = from.anchor;
      this.prevAnchorId = from.prevAnchorId;
      this.orbitAngle = from.orbitAngle;
      this.orbitR = from.orbitR;
      this.orbitDir = from.orbitDir;
      this.orbitW = from.orbitW;
      this.holding = from.holding;
      this.holdTicks = from.holdTicks;
      this.flightTicks = from.flightTicks;
      this.launches = from.launches;
      this.skims = from.skims.slice();
      this.ringHole = from.ringHole;
      this.floor = from.floor;
      this.score = from.score;
      this.combo = from.combo;
      this.deathCause = from.deathCause;
      this.stats = { ...from.stats };
      this.recordEvents = from.recordEvents;
      return;
    }
    this.gen = new Generator(this.seed);
    this.gen.nextRow(this.bodies, this.dust);
    const home = this.bodies[0]!;
    this.anchor = home;
    this.orbitR = home.r + 26;
    this.orbitDir = 1;
    this.orbitW = this.orbitDir * clamp(ORBIT_SPEED / this.orbitR, ORBIT_W_MIN, ORBIT_W_MAX);
    this.floor = home.cy - FLOOR_BELOW_ANCHOR;
    this.placeOnOrbit();
    this.generate();
  }

  get time(): number {
    return this.tick / TICK_HZ;
  }

  get charge(): number {
    return this.holding ? Math.min(1, this.holdTicks / CHARGE_TICKS) : 0;
  }

  get started(): boolean {
    return this.launches > 0 || this.holding;
  }

  clone(): Sim {
    return new Sim(this.seed, this);
  }

  clearEvents(): void {
    this.events.length = 0;
  }

  private emit(e: SimEvent): void {
    if (this.recordEvents && this.events.length < 64) this.events.push(e);
  }

  /** Body lookup by id among live bodies. */
  body(id: number): Body | undefined {
    for (const b of this.bodies) if (b.id === id) return b;
    return undefined;
  }

  private generate(): void {
    const target = this.floor + GEN_AHEAD;
    while (this.gen.lastY < target) this.gen.nextRow(this.bodies, this.dust);
    // Recycle everything well below the floor (but never the current anchor).
    const cut = this.floor - RECYCLE_BELOW;
    let n = 0;
    for (const b of this.bodies) {
      if (b.cy + b.r + b.orbitR >= cut || b === this.anchor) this.bodies[n++] = b;
    }
    this.bodies.length = n;
    n = 0;
    for (const p of this.dust) if (p.y >= cut) this.dust[n++] = p;
    this.dust.length = n;
  }

  private placeOnOrbit(): void {
    const t = this.time;
    const a = this.anchor;
    this.x = bodyX(a, t) + this.orbitR * Math.cos(this.orbitAngle);
    this.y = bodyY(a, t) + this.orbitR * Math.sin(this.orbitAngle);
  }

  /** Velocity the probe would leave the orbit with, for a given charge. */
  launchVelocity(charge: number, out: { vx: number; vy: number }): void {
    const s = launchSpeed(charge);
    const tx = -Math.sin(this.orbitAngle) * this.orbitDir;
    const ty = Math.cos(this.orbitAngle) * this.orbitDir;
    out.vx = tx * s + bodyVX(this.anchor, this.time);
    out.vy = ty * s + bodyVY(this.anchor, this.time);
  }

  /** Advance one fixed tick. `held` is whether the launch input is down this tick. */
  step(held: boolean): void {
    if (this.mode === 'dead') {
      this.tick++;
      return;
    }
    this.tick++;
    if (this.launches > 0) this.stats.playTicks++;

    if (this.mode === 'orbit') this.stepOrbit(held);
    else this.stepFlight();
  }

  private stepOrbit(held: boolean): void {
    // Ease the orbit radius toward a comfortable height above the surface.
    const a = this.anchor;
    const target = a.r + Math.min(26, (a.capR - a.r) * 0.75) + 4;
    this.orbitR += (target - this.orbitR) * 0.02;
    this.orbitAngle += this.orbitW * DT;
    if (this.orbitAngle > Math.PI) this.orbitAngle -= Math.PI * 2;
    else if (this.orbitAngle < -Math.PI) this.orbitAngle += Math.PI * 2;
    this.placeOnOrbit();

    if (held) {
      if (!this.holding) {
        this.holding = true;
        this.holdTicks = 0;
      }
      this.holdTicks++;
      return;
    }
    if (this.holding) this.launch();
  }

  private launch(): void {
    const charge = this.charge;
    const v = { vx: 0, vy: 0 };
    this.launchVelocity(charge, v);
    this.vx = v.vx;
    this.vy = v.vy;
    this.holding = false;
    this.holdTicks = 0;
    this.mode = 'flight';
    this.prevAnchorId = this.anchor.id;
    this.flightTicks = 0;
    this.launches++;
    this.skims.length = 0;
    this.ringHole = -1;
    this.emit({ type: 'launch', x: this.x, y: this.y, charge });
  }

  /** Gravity acceleration at (x, y) at time t. */
  accel(x: number, y: number, t: number, out: { ax: number; ay: number }): void {
    let ax = 0;
    let ay = 0;
    for (const b of this.bodies) {
      if (b.gm <= 0) continue;
      const ady = b.cy - y;
      if (ady > b.reach || -ady > b.reach) continue;
      const dx = bodyX(b, t) - x;
      const dy = bodyY(b, t) - y;
      const d2 = dx * dx + dy * dy;
      const r2 = b.range * b.range;
      if (d2 >= r2) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const fall = 1 - d2 / r2;
      const f = (b.gm / Math.max(d2, b.r * b.r)) * fall * fall;
      ax += (f * dx) / d;
      ay += (f * dy) / d;
    }
    out.ax = ax;
    out.ay = ay;
  }

  private readonly acc = { ax: 0, ay: 0 };

  private stepFlight(): void {
    const t = this.time;
    this.accel(this.x, this.y, t, this.acc);
    this.vx += this.acc.ax * DT;
    this.vy += this.acc.ay * DT;
    this.x += this.vx * DT;
    this.y += this.vy * DT;
    this.flightTicks++;

    const x = this.x;
    const y = this.y;
    for (const b of this.bodies) {
      const ady = b.cy - y;
      if (ady > b.reach || -ady > b.reach) continue;
      const bx = bodyX(b, t);
      const by = bodyY(b, t);
      const dx = x - bx;
      const dy = y - by;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (b.capR > 0 && b.id !== this.prevAnchorId && d < b.capR && pulseActive(b, t)) {
        this.capture(b, d, Math.atan2(dy, dx), bx, by);
        return;
      }
      if (d < b.r + PROBE_R) {
        this.die(b.kind === 'rock' ? 'rock' : b.kind === 'hole' ? 'hole' : 'crash');
        return;
      }
      // Near misses: skimming a body you can't capture right now.
      if (b.kind !== 'hole') {
        const gap = d - b.r - PROBE_R;
        const idx = this.skims.indexOf(b.id);
        if (gap < NEAR_MISS_BAND) {
          if (idx < 0 && this.skims.length < 8) this.skims.push(b.id);
        } else if (idx >= 0 && gap > NEAR_MISS_BAND + 6) {
          this.skims.splice(idx, 1);
          this.score += POINTS_NEAR_MISS;
          this.stats.nearMisses++;
          this.emit({ type: 'near', x, y, points: POINTS_NEAR_MISS });
        }
      } else {
        if (d < b.ringR) {
          this.ringHole = b.id;
        } else if (this.ringHole === b.id && d > b.ringR + 4) {
          this.ringHole = -1;
          this.score += POINTS_SLINGSHOT;
          this.stats.slingshots++;
          this.emit({ type: 'slingshot', x, y, points: POINTS_SLINGSHOT });
        }
      }
    }

    for (let i = 0; i < this.dust.length; i++) {
      const p = this.dust[i]!;
      const dy = y - p.y;
      if (dy > DUST_R || dy < -DUST_R) continue;
      const dx = x - p.x;
      if (dx * dx + dy * dy < DUST_R * DUST_R) {
        this.dust.splice(i, 1);
        i--;
        this.score += POINTS_DUST;
        this.stats.dust++;
        this.emit({ type: 'dust', x: p.x, y: p.y, points: POINTS_DUST });
      }
    }

    if (y > this.stats.height) this.stats.height = y;
    if (Math.abs(x) > HALF_W + SIDE_MARGIN) this.die('out');
    else if (y < this.floor) this.die('fall');
    else if (this.flightTicks > FLIGHT_TIMEOUT_S * TICK_HZ) this.die('lost');
  }

  private capture(b: Body, d: number, angle: number, bx: number, by: number): void {
    const relVx = this.vx - bodyVX(b, this.time);
    const relVy = this.vy - bodyVY(b, this.time);
    const cross = (this.x - bx) * relVy - (this.y - by) * relVx;
    this.mode = 'orbit';
    this.anchor = b;
    this.orbitDir = cross >= 0 ? 1 : -1;
    this.orbitR = Math.max(d, b.r + 12);
    this.orbitAngle = angle;
    this.orbitW = this.orbitDir * clamp(ORBIT_SPEED / this.orbitR, ORBIT_W_MIN, ORBIT_W_MAX);
    this.vx = 0;
    this.vy = 0;

    const fast = this.flightTicks <= COMBO_WINDOW_S * TICK_HZ;
    if (!fast) this.combo = 1;
    const points = POINTS_CAPTURE * this.combo;
    this.score += points;
    this.stats.captures++;
    if (this.combo > this.stats.maxCombo) this.stats.maxCombo = this.combo;
    this.emit({ type: 'capture', x: this.x, y: this.y, bodyId: b.id, points, combo: this.combo, fast });
    if (fast) this.combo = Math.min(COMBO_MAX, this.combo + 1);

    // Skims in progress at the moment of capture still count.
    this.skims.length = 0;

    const newFloor = b.cy - FLOOR_BELOW_ANCHOR;
    if (newFloor > this.floor) this.floor = newFloor;
    this.generate();
  }

  private die(cause: DeathCause): void {
    this.mode = 'dead';
    this.deathCause = cause;
    this.emit({ type: 'death', x: this.x, y: this.y, cause, vx: this.vx, vy: this.vy });
  }

  /** Height in "km" shown to the player. */
  get distance(): number {
    return Math.max(0, Math.floor(this.stats.height / 10));
  }

  /**
   * Predict the flight path for the current charge without mutating the sim.
   * Writes up to `maxPoints` (x, y) pairs into `out` every `every` ticks and
   * returns how many points were written. Stops at the first capture or crash.
   */
  predict(charge: number, ticks: number, every: number, out: Float32Array): number {
    const v = { vx: 0, vy: 0 };
    this.launchVelocity(charge, v);
    let x = this.x;
    let y = this.y;
    let vx = v.vx;
    let vy = v.vy;
    const acc = { ax: 0, ay: 0 };
    let n = 0;
    const maxPoints = out.length >> 1;
    for (let i = 1; i <= ticks; i++) {
      const t = this.time + i * DT;
      this.accel(x, y, t, acc);
      vx += acc.ax * DT;
      vy += acc.ay * DT;
      x += vx * DT;
      y += vy * DT;
      let stop = false;
      for (const b of this.bodies) {
        if (b.kind === 'rock') continue;
        const dx = x - bodyX(b, t);
        const dy = y - bodyY(b, t);
        const d2 = dx * dx + dy * dy;
        const rr = b.r + PROBE_R;
        if (d2 < rr * rr) stop = true;
      }
      if (i % every === 0 && n < maxPoints) {
        out[n * 2] = x;
        out[n * 2 + 1] = y;
        n++;
      }
      if (stop) break;
    }
    return n;
  }
}

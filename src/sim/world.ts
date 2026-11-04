import { G_K, HALF_W } from './constants';
import { Rng } from './rng';

export type BodyKind = 'planet' | 'giant' | 'moon' | 'pulsar' | 'hole' | 'rock';

/**
 * A body in the world. Bodies are immutable after generation; anything that
 * moves (moons, rocks) or blinks (pulsars) is a pure function of sim time, so
 * the world can be shared between a sim and its clones.
 */
export interface Body {
  readonly id: number;
  readonly kind: BodyKind;
  /** Generation row this body belongs to (difficulty grows with it). */
  readonly row: number;
  /** Anchor centre: a moon circles it, a rock streams horizontally through it. */
  readonly cx: number;
  readonly cy: number;
  /** Surface radius. */
  readonly r: number;
  readonly gm: number;
  /** Gravity is faded out to zero at this distance. */
  readonly range: number;
  /** Capture radius (0 = can't be captured). */
  readonly capR: number;
  /** Moons: orbit radius around (cx, cy), angular speed and phase. */
  readonly orbitR: number;
  readonly orbitW: number;
  readonly phase: number;
  /** Rocks: horizontal speed in units/s. */
  readonly speed: number;
  /** Pulsars: blink period (s) and the fraction of it the capture zone is on. */
  readonly pulsePeriod: number;
  readonly pulseOn: number;
  /** Black holes: radius of the slingshot ring. */
  readonly ringR: number;
  /** Cosmetic seed and hue for the renderer. */
  readonly look: number;
  readonly hue: number;
  /** Parent body id for moons, -1 otherwise. */
  readonly parent: number;
  /** Vertical distance from cy beyond which this body can't affect the probe. */
  readonly reach: number;
}

export interface Dust {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export const ROCK_SPAN = HALF_W + 70;

export function bodyX(b: Body, t: number): number {
  if (b.kind === 'moon') return b.cx + b.orbitR * Math.cos(b.phase + b.orbitW * t);
  if (b.kind === 'rock') return wrapRock(b.cx + b.speed * t);
  return b.cx;
}

export function bodyY(b: Body, t: number): number {
  if (b.kind === 'moon') return b.cy + b.orbitR * Math.sin(b.phase + b.orbitW * t);
  return b.cy;
}

export function bodyVX(b: Body, t: number): number {
  if (b.kind === 'moon') return -b.orbitR * b.orbitW * Math.sin(b.phase + b.orbitW * t);
  if (b.kind === 'rock') return b.speed;
  return 0;
}

export function bodyVY(b: Body, t: number): number {
  if (b.kind === 'moon') return b.orbitR * b.orbitW * Math.cos(b.phase + b.orbitW * t);
  return 0;
}

function wrapRock(x: number): number {
  const s2 = ROCK_SPAN * 2;
  return ((((x + ROCK_SPAN) % s2) + s2) % s2) - ROCK_SPAN;
}

/** 0..1 phase within the pulsar's blink cycle. */
export function pulsePhase(b: Body, t: number): number {
  const p = (t + b.phase) / b.pulsePeriod;
  return p - Math.floor(p);
}

export function pulseActive(b: Body, t: number): boolean {
  return b.kind !== 'pulsar' || pulsePhase(b, t) < b.pulseOn;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Difficulty 0..1 for a generation row. Rows 0-3 are a gentle on-ramp. */
export function difficulty(row: number): number {
  return clamp((row - 3) / 36, 0, 1);
}

/** Row thresholds at which each feature starts appearing. */
export const UNLOCK = {
  moon: 5,
  giant: 8,
  belt: 11,
  pulsar: 15,
  hole: 20,
} as const;

/**
 * Procedural generator for the endless column. Each call to `nextRow`
 * appends one "row" (a main planet plus optional moon, belt, black hole and
 * stardust). It is a value-type: clone it with the RNG to branch the world.
 */
export class Generator {
  rng: Rng;
  row = 0;
  nextId = 1;
  lastX = 0;
  lastY = 0;
  /** Spatial extent of the previous main planet (for spacing). */
  lastExt = 0;
  lastR = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  clone(): Generator {
    const g = new Generator(0);
    g.rng = this.rng.clone();
    g.row = this.row;
    g.nextId = this.nextId;
    g.lastX = this.lastX;
    g.lastY = this.lastY;
    g.lastExt = this.lastExt;
    g.lastR = this.lastR;
    return g;
  }

  private make(p: Partial<Body> & Pick<Body, 'kind' | 'cx' | 'cy' | 'r'>): Body {
    const rng = this.rng;
    return {
      id: this.nextId++,
      row: this.row,
      gm: 0,
      range: 0,
      capR: 0,
      orbitR: 0,
      orbitW: 0,
      phase: 0,
      speed: 0,
      pulsePeriod: 1,
      pulseOn: 1,
      ringR: 0,
      look: Math.floor(rng.next() * 0x7fffffff),
      hue: rng.next(),
      parent: -1,
      reach: 0,
      ...p,
    };
  }

  private add(list: Body[], p: Partial<Body> & Pick<Body, 'kind' | 'cx' | 'cy' | 'r'>): Body {
    const b = this.make(p);
    const reach = Math.max(b.range, b.capR, b.r + 40, b.ringR + 12) + b.orbitR;
    const out = { ...b, reach };
    list.push(out);
    return out;
  }

  /** Appends the next row's bodies and dust. */
  nextRow(bodies: Body[], dust: Dust[]): void {
    const rng = this.rng;
    const row = this.row;
    const d = difficulty(row);

    if (row === 0) {
      const r = 36;
      const home = this.add(bodies, {
        kind: 'planet',
        cx: 0,
        cy: 0,
        r,
        gm: G_K * r * r,
        range: r * 6,
        capR: r + 44,
      });
      this.lastX = 0;
      this.lastY = 0;
      this.lastExt = home.capR;
      this.lastR = r;
      this.row++;
      return;
    }

    // Decide this row's features up front so spacing can account for them.
    const giant = row >= UNLOCK.giant && rng.chance(lerp(0.14, 0.2, d));
    const pulsar = !giant && row >= UNLOCK.pulsar && rng.chance(lerp(0.15, 0.22, d));
    const moon = !giant && row >= UNLOCK.moon && rng.chance(0.28);
    const belt = row >= UNLOCK.belt && rng.chance(lerp(0.25, 0.4, d));
    const hole = !belt && row >= UNLOCK.hole && rng.chance(lerp(0.12, 0.2, d));

    let r: number;
    let capPad: number;
    if (giant) {
      r = rng.range(46, 56);
      capPad = lerp(54, 40, d) + rng.range(-3, 3);
    } else {
      r = row < 6 ? rng.range(30, 36) : rng.range(lerp(26, 20, d), lerp(36, 31, d));
      capPad = lerp(38, 22, d) + rng.range(-3, 3);
      // The first few hops are deliberately generous.
      if (row <= 4) capPad += (5 - row) * 3;
    }
    const capR = r + capPad;

    let moonR = 0;
    let moonOrbit = 0;
    if (moon) {
      moonR = rng.range(9, 12);
      // Keep the moon's capture zone clear of the parent's, so there is room to fly out.
      moonOrbit = capR + moonR + 22 + rng.range(10, 18);
    }
    const ext = moon ? moonOrbit + moonR + 22 : capR;

    // Horizontal placement: keep the whole thing (including a moon's orbit) in the column.
    const xLim = Math.max(0, HALF_W - (moon ? moonOrbit - 6 : r + 22));
    const maxDx = lerp(110, 200, d);
    let x = clamp(this.lastX + rng.range(-maxDx, maxDx), -xLim, xLim);
    // Avoid long runs of straight-up hops: nudge away if nearly vertical.
    if (Math.abs(x - this.lastX) < 30 && row > 2) {
      x = clamp(x + (x >= 0 ? -1 : 1) * rng.range(50, 90), -xLim, xLim);
    }

    // Vertical spacing: the gap between capture zones grows with difficulty.
    const clear = (row <= 3 ? 58 : lerp(78, 125, d)) + rng.range(0, 30) + (belt ? 70 : 0) + (hole ? 90 : 0);
    const need = this.lastExt + ext + clear;
    const dx = x - this.lastX;
    const dy = Math.sqrt(Math.max(need * need - dx * dx, 0));
    const y = this.lastY + Math.max(dy, need * 0.62);

    const kind = giant ? 'giant' : pulsar ? 'pulsar' : 'planet';
    const main = this.add(bodies, {
      kind,
      cx: x,
      cy: y,
      r,
      gm: G_K * r * r * (giant ? 1.35 : 1),
      range: giant ? r * 5 : r * 6,
      capR,
      pulsePeriod: pulsar ? rng.range(1.9, 2.5) : 1,
      pulseOn: pulsar ? 0.56 : 1,
      phase: pulsar ? rng.range(0, 3) : 0,
    });

    if (moon) {
      this.add(bodies, {
          kind: 'moon',
          cx: x,
          cy: y,
          r: moonR,
          gm: G_K * moonR * moonR * 0.6,
          range: moonR * 6,
          capR: moonR + 22,
          orbitR: moonOrbit,
          orbitW: rng.sign() * rng.range(0.45, 0.75),
          phase: rng.range(0, Math.PI * 2),
          parent: main.id,
        });
    }

    const midY = (this.lastY + this.lastExt + (y - ext)) / 2;

    if (belt) {
      const n = d > 0.55 ? 4 : 3;
      const dir = rng.sign();
      const speed = dir * rng.range(lerp(32, 46, d), lerp(46, 64, d));
      const off = rng.range(0, ROCK_SPAN * 2);
      for (let i = 0; i < n; i++) {
        this.add(bodies, {
            kind: 'rock',
            cx: -ROCK_SPAN + ((off + (i * ROCK_SPAN * 2) / n) % (ROCK_SPAN * 2)),
            cy: midY + rng.range(-10, 10),
            r: rng.range(9, 13),
            speed,
          });
      }
    }

    if (hole) {
      const side = (this.lastX + x) / 2 > 0 ? -1 : 1;
      const hx = side * rng.range(HALF_W - 70, HALF_W - 45);
      const hr = 11;
      this.add(bodies, {
          kind: 'hole',
          cx: hx,
          cy: midY,
          r: hr,
          gm: 520000,
          range: 230,
          ringR: 52,
        });
      // A dust pair along the slingshot path rewards the risky line.
      dust.push({ id: this.nextId++, x: hx - side * 62, y: midY - 30 });
      dust.push({ id: this.nextId++, x: hx - side * 62, y: midY + 30 });
    }

    // Stardust along an arc between the planets: off the straight line, so it
    // rewards a curvier, more ambitious trajectory.
    if (row >= 2 && rng.chance(0.75)) {
      const mx = (this.lastX + x) / 2;
      const my = (this.lastY + y) / 2;
      const lx = x - this.lastX;
      const ly = y - this.lastY;
      const len = Math.hypot(lx, ly) || 1;
      const bulge = rng.sign() * rng.range(30, 70);
      const cxp = mx + (-ly / len) * bulge;
      const cyp = my + (lx / len) * bulge;
      for (const tt of [0.38, 0.5, 0.62]) {
        const u = 1 - tt;
        const px = clamp(u * u * this.lastX + 2 * u * tt * cxp + tt * tt * x, -HALF_W + 12, HALF_W - 12);
        const py = u * u * this.lastY + 2 * u * tt * cyp + tt * tt * y;
        if (Math.hypot(px - x, py - y) < ext + 12) continue;
        if (Math.hypot(px - this.lastX, py - this.lastY) < this.lastR + 16) continue;
        dust.push({ id: this.nextId++, x: px, y: py });
      }
    }

    this.lastX = x;
    this.lastY = y;
    this.lastExt = ext;
    this.lastR = r;
    this.row++;
  }
}

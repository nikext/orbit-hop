import { CHARGE_TICKS, TICK_HZ } from './constants';
import { Rng } from './rng';
import { Sim } from './sim';

/**
 * Headless bots. They search over (wait, hold) pairs: how long to keep
 * orbiting before pressing, and how long to hold. That covers every launch a
 * player can make from an orbit: release angle and charge.
 */

export interface SearchGrid {
  waitStep: number;
  holdStep: number;
  waits: number;
  holds: number;
  /** For each cell (w * holds + h): id of the body captured (upward or sideways), or -1. */
  target: Int32Array;
  /** cy of the captured body (NaN on failure). */
  targetY: Float64Array;
  /** cy of the body the search started from. */
  startY: number;
}

export interface SearchOptions {
  waitStep?: number;
  holdStep?: number;
  /** Give up on a flight after this many ticks. */
  maxFlightTicks?: number;
}

/** Ticks for one full revolution of the current orbit. */
export function orbitPeriodTicks(sim: Sim): number {
  return Math.ceil(((Math.PI * 2) / Math.abs(sim.orbitW)) * TICK_HZ);
}

/** Runs a single plan on a clone. Returns the clone after the flight resolves. */
export function runPlan(sim: Sim, wait: number, hold: number, maxFlightTicks = 4 * TICK_HZ): Sim {
  const c = sim.clone();
  c.recordEvents = false;
  for (let i = 0; i < wait; i++) c.step(false);
  for (let i = 0; i < hold; i++) c.step(true);
  c.step(false);
  const floorish = sim.anchor.cy - 110;
  for (let i = 0; i < maxFlightTicks && c.mode === 'flight'; i++) {
    c.step(false);
    // Early out: falling well below the start never ends in an upward capture.
    if (c.y < floorish && c.vy < 0) break;
  }
  return c;
}

/** True if a resolved clone ended up orbiting a body above where it started. */
export function wentUp(start: Sim, end: Sim): boolean {
  return end.mode === 'orbit' && end.anchor.id !== start.anchor.id && end.anchor.cy > start.anchor.cy + 20;
}

/**
 * True if a resolved clone moved to a different body without going down,
 * e.g. from a moon to its parent planet. Useful when no upward hop exists
 * from the current orbit.
 */
export function wentSideways(start: Sim, end: Sim): boolean {
  return end.mode === 'orbit' && end.anchor.id !== start.anchor.id && end.anchor.cy >= start.anchor.cy - 1;
}

export function search(sim: Sim, opts: SearchOptions = {}): SearchGrid {
  const waitStep = opts.waitStep ?? 6;
  const holdStep = opts.holdStep ?? 4;
  const maxFlight = opts.maxFlightTicks ?? 3 * TICK_HZ;
  const period = orbitPeriodTicks(sim);
  const waits = Math.ceil(period / waitStep);
  const holds = Math.floor((CHARGE_TICKS + 8) / holdStep);
  const target = new Int32Array(waits * holds).fill(-1);
  const targetY = new Float64Array(waits * holds).fill(NaN);

  const base = sim.clone();
  base.recordEvents = false;
  for (let w = 0; w < waits; w++) {
    if (w > 0) for (let i = 0; i < waitStep; i++) base.step(false);
    // Hold incrementally: one clone keeps holding, and each checkpoint releases a copy.
    const holder = base.clone();
    for (let h = 0; h < holds; h++) {
      const n = h === 0 ? 1 : holdStep;
      for (let i = 0; i < n; i++) holder.step(true);
      const end = runPlan(holder, 0, 0, maxFlight);
      if (wentSideways(sim, end)) {
        target[w * holds + h] = end.anchor.id;
        targetY[w * holds + h] = end.anchor.cy;
      }
    }
  }
  return { waitStep, holdStep, waits, holds, target, targetY, startY: sim.anchor.cy };
}

export interface BotProfile {
  /** Std-dev of press timing error, ticks. */
  pressNoise: number;
  /** Std-dev of release timing error, ticks. */
  releaseNoise: number;
  /** Minimum time a player spends in orbit before pressing, ticks. */
  minWait: number;
  /** Half-size of the neighbourhood used to judge how forgiving a plan is. */
  robustW: number;
  robustH: number;
}

/** Roughly a first-session human on a phone. */
export const NEW_PLAYER: BotProfile = {
  pressNoise: 6,
  releaseNoise: 6,
  minWait: 30,
  robustW: 2,
  robustH: 2,
};

/** An expert who still has human timing. */
export const GOOD_PLAYER: BotProfile = {
  pressNoise: 3,
  releaseNoise: 3,
  minWait: 18,
  robustW: 1,
  robustH: 1,
};

function gauss(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-9);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface Choice {
  wait: number;
  hold: number;
  robustness: number;
}

/**
 * Picks the most forgiving plan that reaches the nearest reachable upward
 * body, as a sensible human would. Returns null if nothing goes up.
 */
export function choose(grid: SearchGrid, profile: BotProfile, rng: Rng): Choice | null {
  const { waits, holds, target, targetY, startY } = grid;
  // Prefer the nearest body above; fall back to a sideways move if nothing above is reachable.
  let bestY = Infinity;
  let anyY = Infinity;
  for (let i = 0; i < target.length; i++) {
    if (target[i]! < 0) continue;
    const y = targetY[i]!;
    if (y > startY + 20 && y < bestY) bestY = y;
    if (y < anyY) anyY = y;
  }
  const upOnly = bestY !== Infinity;
  if (!upOnly) bestY = anyY;
  if (bestY === Infinity) return null;

  let best: Choice | null = null;
  let bestScore = -Infinity;
  for (let w = 0; w < waits; w++) {
    for (let h = 0; h < holds; h++) {
      const i = w * holds + h;
      if (target[i]! < 0) continue;
      if (upOnly && targetY[i]! <= startY + 20) continue;
      // Count successful neighbours (wrapping in wait: the orbit is periodic).
      let ok = 0;
      let tot = 0;
      for (let dw = -profile.robustW; dw <= profile.robustW; dw++) {
        const ww = (w + dw + waits) % waits;
        for (let dh = -profile.robustH; dh <= profile.robustH; dh++) {
          const hh = h + dh;
          tot++;
          if (hh < 0 || hh >= holds) continue;
          if (target[ww * holds + hh]! >= 0) ok++;
        }
      }
      const robustness = ok / tot;
      const nearest = targetY[i]! <= bestY + 1 ? 0.15 : 0;
      const score = robustness + nearest + rng.next() * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = { wait: w * grid.waitStep, hold: 1 + h * grid.holdStep, robustness };
      }
    }
  }
  return best;
}

export interface BotRun {
  seed: number;
  /** Sim seconds until death (or until the cap). */
  time: number;
  score: number;
  captures: number;
  died: boolean;
  cause: string | null;
  height: number;
  stuck: boolean;
}

/**
 * Plays one run with a human-like bot: search, choose a forgiving plan,
 * execute it with timing noise. Stops at death or after `maxSeconds`.
 */
export function playHuman(seed: number, profile: BotProfile, maxSeconds = 240, noiseSeed = 1): BotRun {
  const sim = new Sim(seed);
  sim.recordEvents = false;
  const rng = new Rng(noiseSeed ^ seed);
  let stuck = false;
  while (sim.mode !== 'dead' && sim.time < maxSeconds) {
    const grid = search(sim);
    const pick = choose(grid, profile, rng);
    if (!pick) {
      stuck = true;
      break;
    }
    // Shift a full orbit later if the pick is too soon for a human to react.
    const period = orbitPeriodTicks(sim);
    let wait = pick.wait;
    while (wait < profile.minWait) wait += period;
    wait = Math.max(0, Math.round(wait + gauss(rng) * profile.pressNoise));
    const hold = Math.max(1, Math.round(pick.hold + gauss(rng) * profile.releaseNoise));
    for (let i = 0; i < wait; i++) sim.step(false);
    for (let i = 0; i < hold; i++) sim.step(true);
    sim.step(false);
    while (sim.mode === 'flight') sim.step(false);
  }
  return {
    seed,
    time: sim.time,
    score: sim.score,
    captures: sim.stats.captures,
    died: sim.mode === 'dead',
    cause: sim.deathCause,
    height: sim.stats.height,
    stuck,
  };
}

/**
 * The reachability check: a perfect bot follows the column for `hops`
 * captures. Returns the row index of the first unreachable gap, or -1.
 */
export function checkReachable(seed: number, hops: number): { failedAtRow: number; hops: number } {
  const sim = new Sim(seed);
  sim.recordEvents = false;
  let sideways = false;
  for (let k = 0; k < hops; k++) {
    const grid = search(sim, { waitStep: 4, holdStep: 3 });
    const pick = choose(grid, { pressNoise: 0, releaseNoise: 0, minWait: 0, robustW: 0, robustH: 0 }, new Rng(k));
    if (!pick) return { failedAtRow: sim.anchor.row, hops: k };
    const end = runPlan(sim, pick.wait, pick.hold);
    if (!wentSideways(sim, end)) return { failedAtRow: sim.anchor.row, hops: k };
    // Two sideways moves in a row means we're bouncing around one row: a dead end.
    if (!wentUp(sim, end)) {
      if (sideways) return { failedAtRow: sim.anchor.row, hops: k };
      sideways = true;
    } else sideways = false;
    // Continue from the resolved state.
    Object.assign(sim, end);
  }
  return { failedAtRow: -1, hops };
}

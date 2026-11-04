import { CHARGE_TICKS, POINTS_CAPTURE, TICK_HZ } from './constants';
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
  /** Ticks skipped before the first wait cell. */
  startWait: number;
}

export interface SearchOptions {
  waitStep?: number;
  holdStep?: number;
  /** Give up on a flight after this many ticks. */
  maxFlightTicks?: number;
  /** Only consider pressing after this many ticks (a human's reaction time). */
  startWait?: number;
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
  const startWait = opts.startWait ?? 0;
  for (let i = 0; i < startWait; i++) base.step(false);
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
  return { waitStep, holdStep, waits, holds, target, targetY, startY: sim.anchor.cy, startWait };
}

export interface BotProfile {
  /** Std-dev of press timing error, ticks (changes the charge). */
  pressNoise: number;
  /** Std-dev of release timing error, ticks (changes direction and charge). */
  releaseNoise: number;
  /** Minimum time a player spends in orbit before pressing, ticks. */
  minWait: number;
  /** How many std-devs of press / release error the player guards against when picking a line. */
  robustW: number;
  robustH: number;
  /** How much the player trades safety for an earlier launch (combo chasing). 0 = never hurries. */
  hurry?: number;
}

/**
 * Roughly a first-session human on a phone: ~65 ms timing jitter on both
 * press and release, a reaction delay before pressing, and only a rough
 * sense of which line is forgiving.
 */
export const NEW_PLAYER: BotProfile = {
  pressNoise: 8,
  releaseNoise: 8,
  minWait: 36,
  robustW: 1,
  robustH: 1,
};

/** A practised player who goes for combos: takes the earliest line that is still fairly safe. */
export const COMBO_CHASER: BotProfile = {
  pressNoise: 4,
  releaseNoise: 4,
  minWait: 18,
  robustW: 2,
  robustH: 2,
  hurry: 1.2,
};

/** A practised player: ~35 ms jitter, and picks the most forgiving lines. */
export const GOOD_PLAYER: BotProfile = {
  pressNoise: 4,
  releaseNoise: 4,
  minWait: 18,
  robustW: 2,
  robustH: 2,
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
      // How often does this plan still work under the player's timing noise?
      // Press noise shifts the press (and so the charge); release noise shifts the release.
      let ok = 0;
      let tot = 0;
      const a = profile.pressNoise * profile.robustW;
      const r = profile.releaseNoise * profile.robustH;
      const wait = w * grid.waitStep;
      const hold = h * grid.holdStep;
      for (const dp of a > 0 ? [-a, 0, a] : [0]) {
        for (const dr of r > 0 ? [-r, -r / 2, 0, r / 2, r] : [0]) {
          tot++;
          const ww = Math.round((wait + dp) / grid.waitStep);
          const hh = Math.round((hold + dr - dp) / grid.holdStep);
          if (ww < 0 || ww >= waits || hh < 0 || hh >= holds) continue;
          if (target[ww * holds + hh]! >= 0) ok++;
        }
      }
      const robustness = ok / tot;
      const nearest = targetY[i]! <= bestY + 1 ? 0.15 : 0;
      const hurry = (profile.hurry ?? 0) * (w / Math.max(1, waits));
      const score = robustness + nearest - hurry + rng.next() * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = { wait: grid.startWait + w * grid.waitStep, hold: 1 + h * grid.holdStep, robustness };
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
  /** Captures scored with a multiplier of x2 or more. */
  comboCaptures: number;
  /** Points from captures above the base x1 (what combos added). */
  comboBonus: number;
  maxCombo: number;
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
  let comboCaptures = 0;
  let comboBonus = 0;
  while (sim.mode !== 'dead' && sim.time < maxSeconds) {
    const grid = search(sim, { startWait: profile.minWait });
    const pick = choose(grid, profile, rng);
    if (!pick) {
      stuck = true;
      break;
    }
    // Players time the release against the preview (direction), and the
    // press only sets how much charge has built up by then.
    const press = Math.max(0, Math.round(pick.wait + gauss(rng) * profile.pressNoise));
    const release = Math.round(pick.wait + pick.hold + gauss(rng) * profile.releaseNoise);
    const wait = press;
    const hold = Math.max(1, release - press);
    const comboBefore = sim.combo;
    const capsBefore = sim.stats.captures;
    for (let i = 0; i < wait; i++) sim.step(false);
    for (let i = 0; i < hold; i++) sim.step(true);
    sim.step(false);
    while (sim.mode === 'flight') sim.step(false);
    // A fast capture leaves the combo at x2 or more; the multiplier it scored with is the one before.
    if (sim.stats.captures > capsBefore && sim.combo >= 2 && comboBefore >= 2) {
      comboCaptures++;
      comboBonus += POINTS_CAPTURE * (comboBefore - 1);
    }
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
    comboCaptures,
    comboBonus,
    maxCombo: sim.stats.maxCombo,
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

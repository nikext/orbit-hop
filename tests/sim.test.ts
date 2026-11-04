import { describe, expect, it } from 'vitest';
import { Sim, launchSpeed } from '../src/sim/sim';
import { Rng, hashString } from '../src/sim/rng';
import { checkReachable, playHuman, NEW_PLAYER, runPlan, search, choose, wentUp } from '../src/sim/bot';
import { LAUNCH_MAX, LAUNCH_MIN } from '../src/sim/constants';

/** A fixed, seed-independent input script: alternating waits and holds. */
function scripted(sim: Sim, ticks: number, scriptSeed = 7): void {
  const rng = new Rng(scriptSeed);
  let left = 0;
  let held = false;
  for (let i = 0; i < ticks; i++) {
    if (left <= 0) {
      held = !held;
      left = held ? rng.int(10, 100) : rng.int(20, 200);
    }
    left--;
    sim.step(held);
  }
}

function fingerprint(sim: Sim) {
  return {
    tick: sim.tick,
    score: sim.score,
    mode: sim.mode,
    x: sim.x,
    y: sim.y,
    captures: sim.stats.captures,
    bodies: sim.bodies.map((b) => b.id).join(','),
  };
}

describe('rng', () => {
  it('is deterministic and in range', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('hashes strings stably', () => {
    expect(hashString('2026-11-04')).toBe(hashString('2026-11-04'));
    expect(hashString('2026-11-04')).not.toBe(hashString('2026-11-05'));
  });
});

describe('sim determinism', () => {
  it('same seed and inputs give the same run', () => {
    for (const seed of [1, 42, 9001]) {
      const a = new Sim(seed);
      const b = new Sim(seed);
      scripted(a, 6000);
      scripted(b, 6000);
      expect(fingerprint(a)).toEqual(fingerprint(b));
    }
  });

  it('bot runs are reproducible, including the score', () => {
    const a = playHuman(5, NEW_PLAYER, 60);
    const b = playHuman(5, NEW_PLAYER, 60);
    expect(a).toEqual(b);
    expect(a.captures).toBeGreaterThan(0);
  });

  it('a clone evolves exactly like the original', () => {
    const a = new Sim(77);
    scripted(a, 900);
    const b = a.clone();
    scripted(a, 3000, 99);
    scripted(b, 3000, 99);
    expect(fingerprint(a)).toEqual(fingerprint(b));
  });

  it('different seeds give different worlds', () => {
    const a = new Sim(1);
    const b = new Sim(2);
    expect(a.bodies.map((x) => x.cx)).not.toEqual(b.bodies.map((x) => x.cx));
  });
});

describe('sim rules', () => {
  it('launch speed spans the configured range', () => {
    expect(launchSpeed(0)).toBe(LAUNCH_MIN);
    expect(launchSpeed(1)).toBeCloseTo(LAUNCH_MAX);
    expect(launchSpeed(0.5)).toBeGreaterThan(LAUNCH_MIN);
  });

  it('starts in orbit around the home planet and stays there without input', () => {
    const s = new Sim(3);
    for (let i = 0; i < 1200; i++) s.step(false);
    expect(s.mode).toBe('orbit');
    expect(s.anchor.id).toBe(s.bodies[0]!.id);
    expect(s.score).toBe(0);
  });

  it('a tap with no charge falls back and dies', () => {
    const s = new Sim(3);
    s.step(true);
    s.step(false);
    expect(s.mode).toBe('flight');
    for (let i = 0; i < 1200 && s.mode === 'flight'; i++) s.step(false);
    expect(s.mode).toBe('dead');
  });

  it('a good hop scores a capture and the next fast one doubles', () => {
    const s = new Sim(11);
    const events: string[] = [];
    for (let hop = 0; hop < 2; hop++) {
      const pick = choose(search(s), { pressNoise: 0, releaseNoise: 0, minWait: 0, robustW: 1, robustH: 1 }, new Rng(1));
      expect(pick).not.toBeNull();
      const end = runPlan(s, pick!.wait, pick!.hold);
      expect(wentUp(s, end)).toBe(true);
      for (let i = 0; i < pick!.wait; i++) s.step(false);
      for (let i = 0; i < pick!.hold; i++) s.step(true);
      s.step(false);
      while (s.mode === 'flight') s.step(false);
      for (const e of s.events) events.push(e.type === 'capture' ? `capture:${e.points}` : e.type);
      s.clearEvents();
    }
    const caps = events.filter((e) => e.startsWith('capture'));
    expect(caps.length).toBe(2);
    expect(caps[0]).toBe('capture:100');
    expect(caps[1]).toBe('capture:200');
  });

  it('keeps world arrays bounded on long runs', () => {
    const s = new Sim(8);
    let maxBodies = 0;
    let maxDust = 0;
    for (let hop = 0; hop < 40 && s.mode !== 'dead'; hop++) {
      const pick = choose(search(s), { pressNoise: 0, releaseNoise: 0, minWait: 0, robustW: 1, robustH: 1 }, new Rng(hop));
      if (!pick) break;
      for (let i = 0; i < pick.wait; i++) s.step(false);
      for (let i = 0; i < pick.hold; i++) s.step(true);
      s.step(false);
      while (s.mode === 'flight') s.step(false);
      s.clearEvents();
      maxBodies = Math.max(maxBodies, s.bodies.length);
      maxDust = Math.max(maxDust, s.dust.length);
    }
    expect(s.stats.captures).toBeGreaterThan(20);
    expect(maxBodies).toBeLessThan(60);
    expect(maxDust).toBeLessThan(60);
  });
});

describe('generation', () => {
  it('has no impossible gaps: a search bot always reaches the next planet', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = checkReachable(seed * 7919, 40);
      expect({ seed, ...r }).toEqual({ seed, failedAtRow: -1, hops: 40 });
    }
  }, 120_000);
});

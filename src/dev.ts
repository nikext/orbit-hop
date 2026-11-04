/**
 * Dev-only URL flags. This module is only imported when DEV_FLAGS is true
 * (vite dev server, or a build with VITE_DEVFLAGS=1), so none of it ships
 * in the Playables bundle.
 *
 *   ?seed=42            endless run with a fixed seed
 *   ?mode=daily         start in daily mode
 *   ?autoplay           a search bot plays
 *   ?t=12               fast-forward 12 s of play before the shot
 *   ?shot=title|charge|flight|capture|over|pause
 *                       reach that state deterministically, freeze, and set
 *                       window.__shotReady = true (used by npm run shots)
 *   ?lang=de            force a UI language
 */
import { GOOD_PLAYER, choose, search } from './sim/bot';
import { Rng } from './sim/rng';
import type { Sim } from './sim/sim';
import type { Mode } from './platform/save';
import type { Screen } from './render/ui';
import type { Platform } from './platform/yt';

export interface DevHooks {
  readonly sim: Sim;
  readonly screen: Screen;
  newRun(m: Mode, seed?: number): void;
  setScreen(s: Screen): void;
  setHeldOverride(fn: ((s: Sim) => boolean) | null): void;
  setVirtualDt(dt: number): void;
  advance(dt: number): void;
  render(): void;
  stopLoop(): void;
  pause(): void;
  resume(): void;
  platform: Platform;
}

declare global {
  interface Window {
    __shotReady?: boolean;
    __shotInfo?: Record<string, unknown>;
  }
}

function autopilot(rng: Rng): { held: (s: Sim) => boolean; forceDie: () => void } {
  let plan: { start: number; wait: number; hold: number; anchor: number; sim: Sim } | null = null;
  let die = false;
  return {
    forceDie: () => {
      die = true;
      plan = null;
    },
    held(sim: Sim): boolean {
      if (sim.mode !== 'orbit') {
        plan = null;
        return false;
      }
      if (!plan || plan.anchor !== sim.anchor.id || plan.sim !== sim) {
        if (die) plan = { start: sim.tick, wait: 6, hold: 1, anchor: sim.anchor.id, sim };
        else {
          const pick = choose(search(sim), GOOD_PLAYER, rng);
          plan = { start: sim.tick, wait: pick ? Math.max(pick.wait, 0) : 30, hold: pick ? pick.hold : 40, anchor: sim.anchor.id, sim };
        }
      }
      const k = sim.tick - plan.start;
      return k >= plan.wait && k < plan.wait + plan.hold;
    },
  };
}

export function start(params: URLSearchParams, h: DevHooks): void {
  const seedParam = params.get('seed');
  const mode: Mode = params.get('mode') === 'daily' ? 'daily' : 'endless';
  if (seedParam !== null || params.has('mode')) h.newRun(mode, seedParam !== null ? Number(seedParam) >>> 0 : undefined);

  const shot = params.get('shot');
  const tTarget = Number(params.get('t') ?? '0') || 0;
  const pilot = autopilot(new Rng(Number(seedParam ?? 1)));

  if (params.has('autoplay')) {
    h.setScreen('play');
    h.setHeldOverride(pilot.held);
  }
  if (!shot) return;

  const FRAME = 1 / 60;
  h.setVirtualDt(FRAME);
  const until = (cond: () => boolean, maxFrames = 60 * 200) => {
    for (let i = 0; i < maxFrames && !cond(); i++) h.advance(FRAME);
  };
  const frames = (n: number) => until(() => false, n);

  switch (shot) {
    case 'title':
      frames(50);
      break;
    case 'charge': {
      until(() => h.sim.time >= tTarget && h.sim.mode === 'orbit');
      until(() => h.sim.holding && h.sim.holdTicks >= 55);
      break;
    }
    case 'flight':
      until(() => h.sim.time >= tTarget);
      until(() => h.sim.mode === 'flight' && h.sim.flightTicks >= 34);
      break;
    case 'capture': {
      until(() => h.sim.time >= tTarget);
      const caps = h.sim.stats.captures;
      until(() => h.sim.stats.captures > caps);
      frames(4);
      break;
    }
    case 'over':
      until(() => h.sim.time >= tTarget);
      pilot.forceDie();
      until(() => h.screen === 'over');
      frames(70);
      break;
    case 'pause':
      frames(30);
      h.pause();
      h.resume();
      break;
  }
  h.render();
  h.stopLoop();
  window.__shotInfo = {
    screen: h.screen,
    time: h.sim.time,
    score: h.sim.score,
    mode: h.sim.mode,
    captures: h.sim.stats.captures,
    loaded: h.platform.debug.loaded,
    ready: h.platform.debug.ready,
  };
  window.__shotReady = true;
}

import { Synth } from './audio/synth';
import { Input } from './platform/input';
import { getLang, pickLang, setLang, t } from './platform/i18n';
import {
  type Mode,
  dailyNumber,
  dailyResult,
  defaultSave,
  parseSave,
  recordRun,
  serializeSave,
  utcDateKey,
} from './platform/save';
import { createPlatform } from './platform/yt';
import { Camera } from './render/camera';
import { DUST, GOLD, PROBE_GLOW, UI } from './render/palette';
import { PKind } from './render/particles';
import { WorldRenderer } from './render/renderer';
import { FONT, type RunResult, type Screen, Ui } from './render/ui';
import { COMBO_WINDOW_S, DT, TICK_HZ } from './sim/constants';
import { hashString } from './sim/rng';
import { Sim, type SimEvent } from './sim/sim';
import { planetColors } from './render/palette';

const DEV_FLAGS = import.meta.env.DEV || import.meta.env.VITE_DEVFLAGS === '1';

const CAPTURE_DILATION_S = 0.12;
const CAPTURE_DILATION_SCALE = 0.3;
const DEATH_TO_OVER_S = 0.85;
const RESTART_LOCKOUT_S = 0.35;
const MAX_STEPS_PER_FRAME = 16;
const MAX_DPR = 2;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const g = canvas.getContext('2d', { alpha: false })!;

const platform = createPlatform();
const synth = new Synth();
const camera = new Camera();
const world = new WorldRenderer();
const ui = new Ui();

let save = defaultSave();
let mode: Mode = 'endless';
let dailyN = dailyNumber(new Date());
let practice = false;
let sim = new Sim(1);
let screen: Screen = 'title';
let screenT = 0;
let result: RunResult | null = null;
let gameOvers = 0;

let paused = false;
let resumable = false;
let ready = false;

let acc = 0;
let realTime = 0;
let dilation = 0;
let prevX = sim.x;
let prevY = sim.y;
let lastFrame = 0;
let rafId = 0;
let charging = false;
let reducedMotion = false;
let safeTop = 0;
let safeBottom = 0;
let cssW = 1;
let cssH = 1;

/** Dev-only: drives the input each tick instead of the player. */
let heldOverride: ((s: Sim) => boolean) | null = null;
/** Dev-only: fixed frame time for reproducible screenshots. */
let virtualDt = 0;
/** Dev-only: stop the loop entirely (for screenshots). */
let frozen = false;

// --- Layout -----------------------------------------------------------------

const safeProbe = document.createElement('div');
safeProbe.style.cssText =
  'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
  'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
document.body.appendChild(safeProbe);

function resize(): void {
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
  cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  world.dpr = dpr;
  camera.resize(cssW, cssH);
  const cs = getComputedStyle(safeProbe);
  safeTop = parseFloat(cs.paddingTop) || 0;
  safeBottom = parseFloat(cs.paddingBottom) || 0;
  if (paused || !rafId) render(1);
}

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
try {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = mq.matches;
  mq.addEventListener?.('change', () => (reducedMotion = mq.matches));
} catch {
  /* optional */
}

// --- Runs -------------------------------------------------------------------

function seedFor(m: Mode): number {
  if (m === 'daily') return hashString(`orbit-hop-daily-${utcDateKey(new Date())}`);
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

function newRun(m: Mode, seed = seedFor(m)): void {
  mode = m;
  dailyN = dailyNumber(new Date());
  practice = m === 'daily' && dailyResult(save, dailyN) !== undefined;
  sim = new Sim(seed);
  prevX = sim.x;
  prevY = sim.y;
  acc = 0;
  dilation = 0;
  charging = false;
  result = null;
  input.reset();
  world.clearEffects();
  ui.resetScore();
  camera.follow(sim.floor, -1);
}

function setScreen(s: Screen): void {
  screen = s;
  screenT = 0;
}

function persist(): void {
  void platform.saveData(serializeSave(save));
}

function finishRun(): void {
  const st = sim.stats;
  const rec = recordRun(save, {
    mode,
    day: dailyN,
    score: sim.score,
    hops: st.captures,
    dust: st.dust,
    seconds: Math.round(st.playTicks / TICK_HZ),
  });
  save.settings.mode = mode;
  if (rec.scored && sim.score > 0) platform.sendScore(sim.score);
  persist();
  result = {
    score: sim.score,
    newBest: rec.newBest,
    best: save.best,
    captures: st.captures,
    dust: st.dust,
    maxCombo: st.maxCombo,
    practice,
    dailyScore: mode === 'daily' ? (rec.daily?.score ?? null) : null,
  };
  if (rec.newBest) synth.newBest();
  gameOvers++;
}

function switchMode(m: Mode): void {
  if (m === mode && screen === 'title') return;
  save.settings.mode = m;
  persist();
  newRun(m);
}

// --- Input ------------------------------------------------------------------

const input = new Input(canvas, {
  onGesture() {
    if (!paused) synth.unlock();
  },
  onDown(x, y) {
    if (!ready) return 'consumed';
    if (paused) {
      if (resumable) unpause();
      return 'consumed';
    }
    if (screen === 'title' || screen === 'over') {
      const chip = x !== null && y !== null ? ui.hitChip(x, y) : null;
      if (chip) {
        switchMode(chip);
        if (screen === 'over') setScreen('play');
        return 'consumed';
      }
    }
    if (screen === 'title') {
      setScreen('play');
      return 'game';
    }
    if (screen === 'over') {
      if (screenT < RESTART_LOCKOUT_S) return 'consumed';
      newRun(mode);
      setScreen('play');
      return 'consumed';
    }
    if (screen === 'dying') return 'consumed';
    return 'game';
  },
  onEscape() {
    if (paused && resumable) unpause();
  },
  onModeKey(dir) {
    if (!ready || paused) return;
    if (screen === 'title' || (screen === 'over' && screenT >= RESTART_LOCKOUT_S)) {
      const m: Mode = dir < 0 ? 'daily' : 'endless';
      switchMode(m === mode ? (mode === 'daily' ? 'endless' : 'daily') : m);
      if (screen === 'over') setScreen('play');
    }
  },
});

// --- Pause ------------------------------------------------------------------

function pause(): void {
  if (paused) return;
  paused = true;
  resumable = false;
  if (sim.holding) sim.cancelHold();
  charging = false;
  input.reset();
  synth.chargeStop();
  synth.setPaused(true);
  if (ready) persist();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  render(1);
}

function onPlatformResume(): void {
  if (!paused) return;
  resumable = true;
  // Rendering may resume (for the overlay), but the sim stays frozen until a tap.
  startLoop();
}

function unpause(): void {
  paused = false;
  resumable = false;
  synth.setPaused(false);
  synth.unlock();
  lastFrame = performance.now();
  startLoop();
}

// --- Events -> effects --------------------------------------------------------

function onEvent(e: SimEvent): void {
  switch (e.type) {
    case 'launch': {
      synth.launch(e.charge);
      const vx = -sim.vx * 0.25;
      const vy = -sim.vy * 0.25;
      for (let i = 0; i < 10; i++) world.particles.spawn(PKind.Spark, e.x, e.y, vx + (world.particles.rand() - 0.5) * 80, vy + (world.particles.rand() - 0.5) * 80, 0.35, 2.2, PROBE_GLOW, 3);
      break;
    }
    case 'capture': {
      const b = sim.body(e.bodyId);
      const color = b ? planetColors(b.kind, b.hue).glow : PROBE_GLOW;
      dilation = CAPTURE_DILATION_S;
      camera.addShake(2.5 + Math.min(e.combo, 8) * 0.6);
      camera.punch = 1;
      world.rings.spawn(e.x, e.y, 4, 46 + e.combo * 4, 0.45, color, 4);
      if (b) world.rings.spawn(b.cx, b.cy, b.r, b.capR + 10, 0.6, color, 2.5);
      world.particles.burst(e.x, e.y, 18 + e.combo * 3, 170, color, 0.55, 2.6);
      world.floaters.spawn(e.x, e.y, `+${e.points}`, e.combo >= 2 ? GOLD : UI, 20 + Math.min(e.combo, 8), e.combo >= 2 ? `x${e.combo}` : '');
      synth.capture(e.combo);
      break;
    }
    case 'near':
      world.particles.burst(e.x, e.y, 10, 120, '#ffffff', 0.35, 1.8);
      world.floaters.spawn(e.x, e.y, `+${e.points}`, '#bff8ff', 16, t('near'));
      camera.addShake(1.5);
      synth.near();
      break;
    case 'dust':
      world.particles.burst(e.x, e.y, 8, 90, DUST, 0.4, 2);
      world.floaters.spawn(e.x, e.y, `+${e.points}`, DUST, 13, '', 0.6);
      synth.dust();
      break;
    case 'slingshot':
      world.rings.spawn(e.x, e.y, 6, 70, 0.6, GOLD, 4);
      world.particles.burst(e.x, e.y, 24, 200, GOLD, 0.6, 2.6);
      world.floaters.spawn(e.x, e.y, `+${e.points}`, GOLD, 22, t('slingshot'));
      camera.addShake(4);
      synth.slingshot();
      break;
    case 'death': {
      camera.addShake(11);
      dilation = 0.25;
      world.rings.spawn(e.x, e.y, 2, 60, 0.5, '#ffffff', 5);
      world.particles.burst(e.x, e.y, 26, 260, '#eaffff', 0.9, 3.2, PKind.Shard, e.vx * 0.2, e.vy * 0.2);
      world.particles.burst(e.x, e.y, 30, 200, PROBE_GLOW, 0.8, 2.6, PKind.Spark, e.vx * 0.15, e.vy * 0.15);
      world.particles.burst(e.x, e.y, 14, 120, '#ff8c6e', 1.1, 3, PKind.Ember);
      synth.death();
      setScreen('dying');
      finishRun();
      break;
    }
  }
}

// --- Loop -------------------------------------------------------------------

function update(dt: number): void {
  realTime += dt;
  screenT += dt;
  let scale = 1;
  if (dilation > 0) {
    dilation -= dt;
    scale = screen === 'dying' ? 0.45 : CAPTURE_DILATION_SCALE;
  }

  if (screen === 'title' || screen === 'play' || screen === 'dying') {
    acc += dt * scale;
    let steps = 0;
    while (acc >= DT && steps < MAX_STEPS_PER_FRAME) {
      const wasHolding = sim.holding;
      prevX = sim.x;
      prevY = sim.y;
      const held = heldOverride ? heldOverride(sim) : screen === 'title' ? false : input.nextHeld();
      sim.step(held);
      if (!wasHolding && sim.holding) synth.chargeStart();
      for (const e of sim.events) onEvent(e);
      sim.clearEvents();
      acc -= DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;
  }
  if (screen === 'dying' && screenT >= DEATH_TO_OVER_S) {
    setScreen('over');
    void platform.maybeInterstitial(gameOvers);
  }

  charging = sim.holding && sim.mode === 'orbit';
  if (charging) synth.chargeUpdate(sim.charge);
  if (sim.mode !== 'dead') world.pushTrail(sim.x, sim.y);

  const fx = dt * (dilation > 0 ? 0.5 : 1);
  world.particles.update(fx);
  world.rings.update(fx);
  world.floaters.update(dt);
  camera.follow(sim.floor, dt);
  camera.update(dt, reducedMotion);
  ui.update(dt, sim.score);
  synth.update(dt);
}

function render(alpha: number): void {
  const dpr = world.dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const a = Math.max(0, Math.min(1, alpha));
  const px = prevX + (sim.x - prevX) * a;
  const py = prevY + (sim.y - prevY) * a;
  world.draw(g, camera, {
    sim,
    px,
    py,
    time: (sim.tick - 1 + a) / TICK_HZ,
    realTime,
    charging,
    charge: sim.charge,
    showProbe: sim.mode !== 'dead',
    hint: screen === 'title' ? 1 : screen === 'play' && !sim.started ? Math.max(0, 1 - screenT / 4) : 0,
    reducedMotion,
  });
  world.floaters.draw(g, (x) => camera.sx(x), (y) => camera.sy(y), Math.max(0.8, Math.min(1.4, Math.min(cssW, cssH) / 420)), FONT);
  ui.draw(g, cssW, cssH, {
    screen,
    mode,
    dailyN,
    practice,
    score: sim.score,
    combo: sim.combo,
    comboLeft: 1 - (sim.hopTicks + a) / (COMBO_WINDOW_S * TICK_HZ),
    best: save.best,
    screenT,
    realTime,
    result,
    paused,
    resumable,
    idle: !sim.started,
    safeTop,
    safeBottom,
    reducedMotion,
  });
}

function frame(now: number): void {
  rafId = 0;
  if (frozen || (paused && !resumable)) return;
  rafId = requestAnimationFrame(frame);
  let dt = virtualDt || Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (!paused) update(dt);
  else {
    realTime += dt;
    dt = 0;
  }
  render(acc / DT);
}

function startLoop(): void {
  if (rafId) return;
  lastFrame = performance.now();
  rafId = requestAnimationFrame(frame);
}

// --- Boot -------------------------------------------------------------------

function drawSplash(): void {
  const dpr = world.dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  world.stars.draw(g, cssW, cssH, 0, 0, true);
  g.fillStyle = 'rgba(238,243,255,0.85)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const size = Math.min(48, cssW * 0.1);
  g.font = `900 ${size}px ${FONT}`;
  g.fillText('ORBIT HOP', cssW / 2, cssH * 0.42);
  // Loading dots: this frame is a splash, not an interactive screen.
  g.fillStyle = 'rgba(94,242,255,0.8)';
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.arc(cssW / 2 + (i - 1) * 14, cssH * 0.42 + size, 3, 0, Math.PI * 2);
    g.fill();
  }
}

async function boot(): Promise<void> {
  resize();
  drawSplash();
  platform.firstFrameReady();

  synth.setEnabled(platform.isAudioEnabled());
  platform.onAudioEnabledChange((on) => synth.setEnabled(on));
  platform.onPause(pause);
  platform.onResume(onPlatformResume);

  const [raw, lang] = await Promise.all([platform.loadData(), platform.getLanguage()]);
  save = parseSave(raw);
  let langTag = lang;
  let devParams: URLSearchParams | null = null;
  if (DEV_FLAGS) {
    devParams = new URLSearchParams(location.search);
    langTag = devParams.get('lang') ?? langTag;
  }
  setLang(pickLang(langTag));
  document.documentElement.lang = getLang();
  newRun(save.settings.mode);
  setScreen('title');
  ready = true;
  render(0);
  platform.gameReady();
  startLoop();

  if (DEV_FLAGS && devParams && devParams.toString()) {
    const dev = await import('./dev');
    dev.start(devParams, {
      get sim() {
        return sim;
      },
      get screen() {
        return screen;
      },
      newRun: (m: Mode, seed?: number) => newRun(m, seed),
      setScreen,
      setHeldOverride: (fn) => (heldOverride = fn),
      setVirtualDt: (dt) => (virtualDt = dt),
      advance: (dt) => update(dt),
      render: () => render(1),
      stopLoop: () => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        frozen = true;
      },
      pause,
      resume: onPlatformResume,
      platform,
    });
  }
}

window.addEventListener('error', () => platform.logError());
window.addEventListener('unhandledrejection', () => platform.logError());

void boot();

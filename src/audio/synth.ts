/**
 * Procedural WebAudio: every sound is synthesised at runtime. No audio files.
 *
 * The AudioContext is created on the first user gesture. Nothing plays while
 * YouTube's audio setting is off or the game is paused: the context is
 * suspended, the master gain is zeroed, and every play call checks first.
 */

/** Pentatonic scale degrees in semitones. */
const PENTA = [0, 2, 4, 7, 9];
const ROOT_HZ = 293.66; // D4

function pentaHz(step: number, root = ROOT_HZ): number {
  const oct = Math.floor(step / PENTA.length);
  const deg = PENTA[((step % PENTA.length) + PENTA.length) % PENTA.length]!;
  return root * Math.pow(2, oct + deg / 12);
}

type Ctx = AudioContext;

export class Synth {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private fx: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;
  private paused = false;
  private chargeOsc: OscillatorNode | null = null;
  private chargeOsc2: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneOscs: OscillatorNode[] = [];
  private droneTimer = 0;
  private droneStep = 0;
  private dustStep = 0;

  /** Call from a user gesture (pointerdown / keydown). Creates or resumes the context. */
  unlock(): void {
    if (!this.enabled || this.paused) return;
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  /** YouTube's audio setting (isAudioEnabled / onAudioEnabledChange). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.apply();
  }

  /** Game pause (onPause / onResume). */
  setPaused(p: boolean): void {
    this.paused = p;
    this.apply();
  }

  private apply(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const live = this.enabled && !this.paused;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setValueAtTime(live ? 0.7 : 0, ctx.currentTime);
    if (!live) {
      this.chargeStop();
      void ctx.suspend().catch(() => undefined);
    }
    // Resuming happens on the next user gesture via unlock().
  }

  private canPlay(): Ctx | null {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || this.paused || ctx.state !== 'running') return null;
    return ctx;
  }

  private build(ctx: Ctx): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = this.enabled && !this.paused ? 0.7 : 0;
    master.connect(comp);
    this.master = master;

    // A short feedback echo gives chimes some space.
    const fx = ctx.createGain();
    fx.gain.value = 0.28;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.19;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    fx.connect(delay);
    delay.connect(lp);
    lp.connect(fb);
    fb.connect(delay);
    lp.connect(master);
    this.fx = fx;

    const len = Math.floor(ctx.sampleRate * 1.0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    this.noise = buf;
    this.startDrone(ctx);
  }

  private tone(
    ctx: Ctx,
    type: OscillatorType,
    freq: number,
    t0: number,
    dur: number,
    peak: number,
    opts: { glideTo?: number; attack?: number; send?: number } = {},
  ): void {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (opts.glideTo) o.frequency.exponentialRampToValueAtTime(opts.glideTo, t0 + dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master!);
    if (opts.send && this.fx) {
      const s = ctx.createGain();
      s.gain.value = opts.send;
      g.connect(s);
      s.connect(this.fx);
    }
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noiseBurst(ctx: Ctx, t0: number, dur: number, peak: number, type: BiquadFilterType, f0: number, f1: number, q = 1): void {
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  // --- Game sounds -------------------------------------------------------

  chargeStart(): void {
    const ctx = this.canPlay();
    if (!ctx || this.chargeOsc) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(170, t);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(340, t);
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(this.master!);
    o.start(t);
    o2.start(t);
    this.chargeOsc = o;
    this.chargeOsc2 = o2;
    this.chargeGain = g;
  }

  /** Rising tone tracking the charge level (0..1). */
  chargeUpdate(charge: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.chargeOsc || !this.chargeOsc2) return;
    const f = 170 * Math.pow(2, charge * 1.6);
    this.chargeOsc.frequency.setTargetAtTime(f, ctx.currentTime, 0.02);
    this.chargeOsc2.frequency.setTargetAtTime(f * 2.005, ctx.currentTime, 0.02);
  }

  chargeStop(): void {
    const ctx = this.ctx;
    if (!ctx || !this.chargeOsc || !this.chargeGain) return;
    const t = ctx.currentTime;
    this.chargeGain.gain.cancelScheduledValues(t);
    this.chargeGain.gain.setTargetAtTime(0.0001, t, 0.015);
    this.chargeOsc.stop(t + 0.1);
    this.chargeOsc2?.stop(t + 0.1);
    this.chargeOsc = null;
    this.chargeOsc2 = null;
    this.chargeGain = null;
  }

  launch(charge: number): void {
    this.chargeStop();
    const ctx = this.canPlay();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(ctx, t, 0.28 + charge * 0.2, 0.22 + charge * 0.12, 'bandpass', 500 + charge * 400, 2600 + charge * 1800, 1.4);
    this.tone(ctx, 'sine', 220 + charge * 140, t, 0.16, 0.07, { glideTo: 520 + charge * 300 });
  }

  /** Pitched chime that climbs with the combo. */
  capture(combo: number): void {
    const ctx = this.canPlay();
    if (!ctx) return;
    const t = ctx.currentTime;
    const step = 2 + Math.min(combo, 9);
    const f = pentaHz(step);
    this.tone(ctx, 'sine', f, t, 0.7, 0.16, { send: 0.6 });
    this.tone(ctx, 'triangle', f * 2, t, 0.35, 0.04, { send: 0.4 });
    this.tone(ctx, 'sine', pentaHz(step + 2), t + 0.06, 0.55, 0.08, { send: 0.6 });
    if (combo >= 3) this.tone(ctx, 'sine', pentaHz(step + 5), t + 0.12, 0.5, 0.05, { send: 0.7 });
  }

  near(): void {
    const ctx = this.canPlay();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(ctx, 'sine', 1100, t, 0.12, 0.06, { glideTo: 1900 });
    this.noiseBurst(ctx, t, 0.15, 0.06, 'highpass', 3000, 6000, 0.7);
  }

  dust(): void {
    const ctx = this.canPlay();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.dustStep = (this.dustStep + 1) % 7;
    this.tone(ctx, 'sine', pentaHz(10 + this.dustStep), t, 0.14, 0.045, { send: 0.5 });
  }

  slingshot(): void {
    const ctx = this.canPlay();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) this.tone(ctx, 'triangle', pentaHz(5 + i * 2), t + i * 0.05, 0.3, 0.07, { send: 0.6 });
  }

  death(): void {
    this.chargeStop();
    const ctx = this.canPlay();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(ctx, t, 0.7, 0.35, 'lowpass', 2400, 120, 0.8);
    this.tone(ctx, 'sine', 140, t, 0.5, 0.25, { glideTo: 38 });
    this.tone(ctx, 'triangle', pentaHz(0, ROOT_HZ / 2), t + 0.08, 0.6, 0.05, { glideTo: 60 });
  }

  newBest(): void {
    const ctx = this.canPlay();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 5; i++) this.tone(ctx, 'sine', pentaHz(5 + i), t + i * 0.07, 0.5, 0.08, { send: 0.7 });
  }

  // --- Background drone --------------------------------------------------

  private startDrone(ctx: Ctx): void {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.045;
    filter.connect(g);
    g.connect(this.master!);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    const freqs = [ROOT_HZ / 4, (ROOT_HZ / 4) * 1.5, ROOT_HZ / 2];
    for (let i = 0; i < 3; i++) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = i === 2 ? 'triangle' : 'sawtooth';
        o.frequency.value = freqs[i]!;
        o.detune.value = det;
        o.connect(filter);
        o.start();
        this.droneOscs.push(o);
      }
    }
    this.droneFilter = filter;
  }

  /** Slowly drifts the drone's chord. Call once per frame with real dt. */
  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.droneFilter || this.paused) return;
    this.droneTimer -= dt;
    if (this.droneTimer > 0) return;
    this.droneTimer = 9 + Math.random() * 5;
    this.droneStep = (this.droneStep + 1 + Math.floor(Math.random() * 2)) % 4;
    const roots = [0, -2, 3, -4];
    const shift = Math.pow(2, roots[this.droneStep]! / 12);
    const base = [ROOT_HZ / 4, (ROOT_HZ / 4) * 1.5, ROOT_HZ / 2];
    this.droneOscs.forEach((o, i) => {
      o.frequency.setTargetAtTime(base[Math.floor(i / 2)]! * shift, ctx.currentTime, 2.5);
    });
  }
}

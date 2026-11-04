import { HALF_W, SIDE_MARGIN, PROBE_R } from '../sim/constants';
import type { Sim } from '../sim/sim';
import { type Body, ROCK_SPAN, bodyX, bodyY, pulseActive, pulsePhase } from '../sim/world';
import type { Camera } from './camera';
import { DANGER, DUST, PREVIEW, PROBE, PROBE_GLOW, ROCK_EDGE, ROCK_FILL, planetColors } from './palette';
import { Floaters, Particles, Rings } from './particles';
import { glow, planetSprite, rgba, rockShape, sparkleSprite } from './sprites';
import { Starfield } from './stars';

const TRAIL = 44;
const PREVIEW_TICKS = 72; // 0.6 s at 120 Hz
const PREVIEW_EVERY = 4;

export interface FrameInput {
  sim: Sim;
  /** Interpolated probe position. */
  px: number;
  py: number;
  /** Interpolated sim time for moving bodies. */
  time: number;
  /** Real time, for purely cosmetic animation. */
  realTime: number;
  charging: boolean;
  charge: number;
  showProbe: boolean;
  /** 0..1 strength of the "hold" hint ring around the probe. */
  hint: number;
  reducedMotion: boolean;
}

/** Draws the world: background, bodies, probe, preview, trail and effects. */
export class WorldRenderer {
  readonly particles = new Particles();
  readonly rings = new Rings();
  readonly floaters = new Floaters();
  readonly stars = new Starfield();
  private trail = new Float32Array(TRAIL * 2);
  private trailLen = 0;
  private trailHead = 0;
  private preview = new Float32Array((PREVIEW_TICKS / PREVIEW_EVERY) * 2);
  dpr = 1;

  resetTrail(): void {
    this.trailLen = 0;
  }

  pushTrail(x: number, y: number): void {
    this.trail[this.trailHead * 2] = x;
    this.trail[this.trailHead * 2 + 1] = y;
    this.trailHead = (this.trailHead + 1) % TRAIL;
    if (this.trailLen < TRAIL) this.trailLen++;
  }

  clearEffects(): void {
    this.particles.clear();
    this.rings.clear();
    this.floaters.clear();
    this.resetTrail();
  }

  draw(g: CanvasRenderingContext2D, cam: Camera, f: FrameInput): void {
    const sim = f.sim;
    const s = cam.s;
    const sx = (x: number) => cam.sx(x);
    const sy = (y: number) => cam.sy(y);

    this.stars.draw(g, cam.w, cam.h, cam.bottom * cam.scale, f.realTime, f.reducedMotion);
    this.drawBounds(g, cam);

    const top = cam.top + 120;
    const bottom = cam.bottom - 160;
    const t = f.time;
    const inFlight = sim.mode === 'flight';

    // Preview first, so we can highlight the zone it enters.
    let previewN = 0;
    let previewTarget = -1;
    if (f.charging && sim.mode === 'orbit') {
      previewN = sim.predict(f.charge, PREVIEW_TICKS, PREVIEW_EVERY, this.preview);
      previewTarget = this.findPreviewTarget(sim, previewN, t);
    }

    // Capture zones, moon paths, black hole rings.
    for (const b of sim.bodies) {
      if (b.cy + b.reach < bottom || b.cy - b.reach > top) continue;
      if (b.kind === 'moon') this.drawMoonPath(g, cam, b);
      if (b.capR > 0 && b !== sim.anchor) {
        const disabled = inFlight && b.id === sim.prevAnchorId;
        this.drawZone(g, cam, b, t, f.realTime, disabled, b.id === previewTarget);
      }
    }
    if (sim.mode !== 'dead' && sim.mode === 'orbit') this.drawOrbitPath(g, cam, sim, t);

    for (const b of sim.bodies) {
      if (b.cy + b.reach < bottom || b.cy - b.reach > top) continue;
      switch (b.kind) {
        case 'rock':
          this.drawRock(g, cam, b, t);
          break;
        case 'hole':
          this.drawHole(g, cam, b, f.realTime, f.reducedMotion);
          break;
        default:
          this.drawPlanet(g, cam, b, t, f.realTime);
      }
    }

    // Stardust.
    const sp = sparkleSprite();
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const d of sim.dust) {
      if (d.y < bottom || d.y > top) continue;
      const pulse = f.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(f.realTime * 5 + d.id);
      const r = 11 * s * pulse;
      g.drawImage(sp, sx(d.x) - r, sy(d.y) - r, r * 2, r * 2);
    }
    g.restore();

    if (previewN > 0) this.drawPreview(g, cam, f, previewN);
    this.drawTrail(g, cam);

    if (f.showProbe) this.drawProbe(g, cam, sim, f);

    this.rings.draw(g, sx, sy, s);
    this.particles.draw(g, sx, sy, s);
  }

  private findPreviewTarget(sim: Sim, n: number, t: number): number {
    for (let i = 0; i < n; i++) {
      const x = this.preview[i * 2]!;
      const y = this.preview[i * 2 + 1]!;
      for (const b of sim.bodies) {
        if (b.capR <= 0 || b === sim.anchor) continue;
        const dx = x - bodyX(b, t);
        const dy = y - bodyY(b, t);
        if (dx * dx + dy * dy < b.capR * b.capR) return b.id;
      }
    }
    return -1;
  }

  private drawBounds(g: CanvasRenderingContext2D, cam: Camera): void {
    const edge = HALF_W + SIDE_MARGIN;
    const lx = cam.sx(-edge);
    const rx = cam.sx(edge);
    // Darken outside the column.
    g.fillStyle = 'rgba(2,2,10,0.55)';
    if (lx > 0) g.fillRect(0, 0, lx, cam.h);
    if (rx < cam.w) g.fillRect(rx, 0, cam.w - rx, cam.h);
    // Edge lines: dashed, so they read as a boundary rather than an object.
    g.save();
    g.strokeStyle = 'rgba(140,160,255,0.22)';
    g.lineWidth = 1.5;
    g.setLineDash([6, 10]);
    g.lineDashOffset = -cam.bottom * cam.scale;
    for (const x of [lx, rx]) {
      if (x < -2 || x > cam.w + 2) continue;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, cam.h);
      g.stroke();
    }
    g.restore();
    // The floor: a faint red haze along the bottom edge, where the play area ends.
    // (The camera trails the floor, so the screen bottom is the floor once it settles.)
    {
      const fy = cam.h;
      const hh = 70 * cam.scale;
      const grad = g.createLinearGradient(0, fy - hh, 0, fy + 4);
      grad.addColorStop(0, rgba(DANGER, 0));
      grad.addColorStop(1, rgba(DANGER, 0.22));
      g.fillStyle = grad;
      g.fillRect(Math.max(0, lx), fy - hh, Math.min(cam.w, rx) - Math.max(0, lx), hh + 4);
    }
  }

  private drawMoonPath(g: CanvasRenderingContext2D, cam: Camera, b: Body): void {
    g.save();
    g.strokeStyle = 'rgba(200,212,255,0.12)';
    g.lineWidth = 1;
    g.setLineDash([2, 6]);
    g.beginPath();
    g.arc(cam.sx(b.cx), cam.sy(b.cy), b.orbitR * cam.s, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  private drawZone(g: CanvasRenderingContext2D, cam: Camera, b: Body, t: number, rt: number, disabled: boolean, targeted: boolean): void {
    const x = cam.sx(bodyX(b, t));
    const y = cam.sy(bodyY(b, t));
    const r = b.capR * cam.s;
    const c = planetColors(b.kind, b.hue);
    g.save();
    if (disabled) {
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.lineWidth = 1;
      g.setLineDash([2, 8]);
    } else if (b.kind === 'pulsar') {
      const on = pulseActive(b, t);
      if (on) {
        const ph = pulsePhase(b, t) / b.pulseOn;
        g.strokeStyle = rgba(c.glow, targeted ? 0.95 : 0.6);
        g.lineWidth = targeted ? 3 : 2;
        g.setLineDash([]);
        // A gentle inward breath while open (slow; no strobing).
        const k = 1 + 0.04 * Math.sin(ph * Math.PI);
        g.beginPath();
        g.arc(x, y, r * k, 0, Math.PI * 2);
        g.stroke();
        g.restore();
        return;
      }
      // Closed: sparse dots and a cross-hatch "shutter" so it's clear by shape too.
      g.strokeStyle = 'rgba(160,200,255,0.25)';
      g.lineWidth = 1.5;
      g.setLineDash([1.5, 9]);
    } else {
      g.strokeStyle = rgba(c.glow, targeted ? 0.9 : 0.34);
      g.lineWidth = targeted ? 2.6 : 1.4;
      g.setLineDash([7, 7]);
      g.lineDashOffset = -rt * 10;
    }
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    if (targeted && !disabled) {
      g.globalAlpha = 0.08;
      g.fillStyle = c.glow;
      g.fill();
    }
    g.restore();
  }

  private drawOrbitPath(g: CanvasRenderingContext2D, cam: Camera, sim: Sim, t: number): void {
    const a = sim.anchor;
    g.save();
    g.strokeStyle = 'rgba(160,240,255,0.16)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(cam.sx(bodyX(a, t)), cam.sy(bodyY(a, t)), sim.orbitR * cam.s, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  private drawPlanet(g: CanvasRenderingContext2D, cam: Camera, b: Body, t: number, rt: number): void {
    const x = cam.sx(bodyX(b, t));
    const y = cam.sy(bodyY(b, t));
    const s = cam.s;
    if (b.kind === 'pulsar') {
      // Rotating beams: a moving cue that doesn't depend on colour.
      const on = pulseActive(b, t);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.translate(x, y);
      g.rotate(rt * 0.9 + b.look);
      const len = b.r * 3.2 * s;
      for (let k = 0; k < 2; k++) {
        const grad = g.createLinearGradient(0, 0, len, 0);
        grad.addColorStop(0, `rgba(170,230,255,${on ? 0.45 : 0.12})`);
        grad.addColorStop(1, 'rgba(170,230,255,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, -b.r * 0.35 * s);
        g.lineTo(len, -b.r * 0.08 * s);
        g.lineTo(len, b.r * 0.08 * s);
        g.lineTo(0, b.r * 0.35 * s);
        g.fill();
        g.rotate(Math.PI);
      }
      g.restore();
    }
    if (b.kind === 'giant') {
      // Back half of a ring.
      this.drawGiantRing(g, x, y, b, s, true);
    }
    const { sprite, worldSize } = planetSprite(b, s * this.dpr);
    const size = worldSize * s;
    g.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    if (b.kind === 'giant') this.drawGiantRing(g, x, y, b, s, false);
  }

  private drawGiantRing(g: CanvasRenderingContext2D, x: number, y: number, b: Body, s: number, back: boolean): void {
    const c = planetColors(b.kind, b.hue);
    g.save();
    g.translate(x, y);
    g.rotate(-0.32 + (b.hue - 0.5) * 0.3);
    g.strokeStyle = rgba(c.light, back ? 0.25 : 0.55);
    g.lineWidth = Math.max(1, b.r * 0.09 * s);
    g.beginPath();
    g.ellipse(0, 0, b.r * 1.55 * s, b.r * 0.32 * s, 0, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI);
    g.stroke();
    g.restore();
  }

  private drawRock(g: CanvasRenderingContext2D, cam: Camera, b: Body, t: number): void {
    const wx = bodyX(b, t);
    const fade = Math.max(0, Math.min(1, (ROCK_SPAN - Math.abs(wx)) / 40));
    if (fade <= 0) return;
    const x = cam.sx(wx);
    const y = cam.sy(bodyY(b, t));
    const r = b.r * cam.s;
    const shape = rockShape(b.look);
    g.save();
    g.globalAlpha = fade;
    // Faint warning glow behind the rock.
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = fade * 0.35;
    g.drawImage(glow(DANGER), x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = fade;
    g.translate(x, y);
    g.rotate(t * (b.look % 2 ? 1.6 : -1.3));
    g.beginPath();
    for (let i = 0; i < shape.length; i += 2) {
      const px = shape[i]! * r;
      const py = shape[i + 1]! * r;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = ROCK_FILL;
    g.fill();
    g.strokeStyle = ROCK_EDGE;
    g.lineWidth = Math.max(1.2, r * 0.14);
    g.lineJoin = 'round';
    g.stroke();
    g.restore();
  }

  private drawHole(g: CanvasRenderingContext2D, cam: Camera, b: Body, rt: number, reducedMotion: boolean): void {
    const x = cam.sx(b.cx);
    const y = cam.sy(b.cy);
    const s = cam.s;
    const spin = reducedMotion ? 0 : rt;
    g.save();
    // Slingshot ring: rotating dashes with arrowheads pointing along the ring.
    g.strokeStyle = 'rgba(255,210,94,0.5)';
    g.lineWidth = 1.6;
    g.setLineDash([10, 8]);
    g.lineDashOffset = spin * 26;
    g.beginPath();
    g.arc(x, y, b.ringR * s, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    // Accretion disc: additive arcs swirling in.
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const rr = (b.r * 1.25 + (i / 9) * b.r * 1.8) * s;
      const a0 = spin * (3.4 - i * 0.25) + i * 1.7;
      g.strokeStyle = i % 2 ? 'rgba(255,140,90,0.38)' : 'rgba(190,120,255,0.34)';
      g.lineWidth = Math.max(1, (2.6 - i * 0.18) * s);
      g.beginPath();
      g.arc(x, y, rr, a0, a0 + 1.6 + (i % 3) * 0.5);
      g.stroke();
    }
    g.drawImage(glow('#b46bff'), x - b.r * 4 * s, y - b.r * 4 * s, b.r * 8 * s, b.r * 8 * s);
    g.globalCompositeOperation = 'source-over';
    // The hole itself: pure black with a bright photon ring.
    g.fillStyle = '#000000';
    g.beginPath();
    g.arc(x, y, b.r * s, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,230,200,0.9)';
    g.lineWidth = Math.max(1, 1.6 * s);
    g.stroke();
    g.restore();
  }

  private drawPreview(g: CanvasRenderingContext2D, cam: Camera, f: FrameInput, n: number): void {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = PREVIEW;
    const base = 0.35 + f.charge * 0.5;
    for (let i = 0; i < n; i++) {
      const k = 1 - i / n;
      g.globalAlpha = base * k;
      const r = (1.2 + 1.6 * k) * cam.s;
      g.beginPath();
      g.arc(cam.sx(this.preview[i * 2]!), cam.sy(this.preview[i * 2 + 1]!), Math.max(1, r), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private drawTrail(g: CanvasRenderingContext2D, cam: Camera): void {
    if (this.trailLen < 2) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    let prevX = 0;
    let prevY = 0;
    for (let k = 0; k < this.trailLen; k++) {
      const idx = (this.trailHead - this.trailLen + k + TRAIL) % TRAIL;
      const x = cam.sx(this.trail[idx * 2]!);
      const y = cam.sy(this.trail[idx * 2 + 1]!);
      if (k > 0) {
        const a = k / this.trailLen;
        g.strokeStyle = rgba(PROBE_GLOW, a * 0.55);
        g.lineWidth = Math.max(1, a * 4 * cam.s);
        g.beginPath();
        g.moveTo(prevX, prevY);
        g.lineTo(x, y);
        g.stroke();
      }
      prevX = x;
      prevY = y;
    }
    g.restore();
  }

  private drawProbe(g: CanvasRenderingContext2D, cam: Camera, sim: Sim, f: FrameInput): void {
    const x = cam.sx(f.px);
    const y = cam.sy(f.py);
    const s = cam.s;
    // Squash while charging (compress along the launch direction), stretch with speed in flight.
    let ang = 0;
    let sxk = 1;
    let syk = 1;
    if (sim.mode === 'orbit') {
      ang = -(sim.orbitAngle + (Math.PI / 2) * sim.orbitDir);
      const c = f.charging ? f.charge : 0;
      sxk = 1 - 0.38 * c;
      syk = 1 + 0.3 * c;
    } else if (sim.mode === 'flight') {
      ang = -Math.atan2(sim.vy, sim.vx);
      const sp = Math.hypot(sim.vx, sim.vy);
      sxk = 1 + Math.min(0.7, sp / 900);
      syk = 1 / sxk;
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gl = (18 + (f.charging ? f.charge * 10 : 0)) * s;
    g.drawImage(glow(PROBE_GLOW), x - gl, y - gl, gl * 2, gl * 2);
    g.restore();

    // Hint ring on the title / before the first hop.
    if (f.hint > 0.01) {
      const ph = (f.realTime * 0.9) % 1;
      g.save();
      g.strokeStyle = rgba(PROBE_GLOW, f.hint * (1 - ph) * 0.8);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, (10 + ph * 26) * s, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.scale(sxk, syk);
    g.fillStyle = PROBE;
    g.beginPath();
    g.arc(0, 0, (PROBE_R + 0.5) * s, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // Charge arc.
    if (f.charging && sim.mode === 'orbit') {
      const full = f.charge >= 1;
      g.save();
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.15)';
      g.lineWidth = 3 * s;
      g.beginPath();
      g.arc(x, y, 13 * s, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = full ? DUST : PROBE_GLOW;
      g.lineWidth = (full ? 3.6 : 3) * s;
      g.beginPath();
      g.arc(x, y, 13 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, f.charge));
      g.stroke();
      g.restore();
    }
  }
}

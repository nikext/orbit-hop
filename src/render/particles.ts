import { glow } from './sprites';

/**
 * Fixed-size particle pool (struct of arrays). Nothing is allocated per
 * particle, and the oldest particle is overwritten when the pool is full.
 */
const MAX = 600;

export const PKind = { Spark: 0, Shard: 1, Ember: 2 } as const;
export type PKind = (typeof PKind)[keyof typeof PKind];

export class Particles {
  readonly x = new Float32Array(MAX);
  readonly y = new Float32Array(MAX);
  readonly vx = new Float32Array(MAX);
  readonly vy = new Float32Array(MAX);
  readonly life = new Float32Array(MAX);
  readonly maxLife = new Float32Array(MAX);
  readonly size = new Float32Array(MAX);
  readonly rot = new Float32Array(MAX);
  readonly spin = new Float32Array(MAX);
  readonly drag = new Float32Array(MAX);
  readonly kind = new Uint8Array(MAX);
  readonly color: string[] = new Array<string>(MAX).fill('#ffffff');
  private next = 0;
  private seed = 7;

  rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  spawn(kind: PKind, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, drag = 1.5): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.kind[i] = kind;
    this.color[i] = color;
    this.rot[i] = this.rand() * Math.PI * 2;
    this.spin[i] = (this.rand() - 0.5) * 14;
    this.drag[i] = drag;
  }

  burst(x: number, y: number, n: number, speed: number, color: string, life = 0.6, size = 3, kind: PKind = PKind.Spark, baseVx = 0, baseVy = 0): void {
    for (let k = 0; k < n; k++) {
      const a = this.rand() * Math.PI * 2;
      const s = speed * (0.3 + this.rand() * 0.7);
      this.spawn(kind, x, y, baseVx + Math.cos(a) * s, baseVy + Math.sin(a) * s, life * (0.6 + this.rand() * 0.6), size * (0.6 + this.rand() * 0.8), color);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      const d = Math.exp(-this.drag[i]! * dt);
      this.vx[i]! *= d;
      this.vy[i]! *= d;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.rot[i]! += this.spin[i]! * dt;
    }
  }

  clear(): void {
    this.life.fill(0);
  }

  /** Draw in world space using the camera mapping functions. */
  draw(g: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, scale: number): void {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < MAX; i++) {
      const life = this.life[i]!;
      if (life <= 0) continue;
      const t = life / this.maxLife[i]!;
      const x = sx(this.x[i]!);
      const y = sy(this.y[i]!);
      const s = this.size[i]! * scale;
      const kind = this.kind[i]!;
      if (kind === PKind.Shard) {
        g.globalAlpha = Math.min(1, t * 1.6);
        g.fillStyle = this.color[i]!;
        g.save();
        g.translate(x, y);
        g.rotate(this.rot[i]!);
        g.beginPath();
        g.moveTo(-s, -s * 0.5);
        g.lineTo(s, 0);
        g.lineTo(-s * 0.4, s * 0.6);
        g.closePath();
        g.fill();
        g.restore();
      } else {
        g.globalAlpha = t * t;
        const r = s * (kind === PKind.Ember ? 3.5 : 2.6) * (0.5 + 0.5 * t);
        g.drawImage(glow(this.color[i]!), x - r, y - r, r * 2, r * 2);
      }
    }
    g.restore();
  }
}

/** Expanding shockwave rings (capture bursts). Small fixed pool. */
export class Rings {
  private readonly n = 12;
  readonly x = new Float32Array(this.n);
  readonly y = new Float32Array(this.n);
  readonly r0 = new Float32Array(this.n);
  readonly r1 = new Float32Array(this.n);
  readonly life = new Float32Array(this.n);
  readonly maxLife = new Float32Array(this.n);
  readonly width = new Float32Array(this.n);
  readonly color: string[] = new Array<string>(this.n).fill('#fff');
  private next = 0;

  spawn(x: number, y: number, r0: number, r1: number, life: number, color: string, width = 3): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.x[i] = x;
    this.y[i] = y;
    this.r0[i] = r0;
    this.r1[i] = r1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.color[i] = color;
    this.width[i] = width;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) if (this.life[i]! > 0) this.life[i]! -= dt;
  }

  clear(): void {
    this.life.fill(0);
  }

  draw(g: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, scale: number): void {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i]!;
      if (life <= 0) continue;
      const t = 1 - life / this.maxLife[i]!;
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      const r = (this.r0[i]! + (this.r1[i]! - this.r0[i]!) * e) * scale;
      g.globalAlpha = (1 - t) * 0.9;
      g.strokeStyle = this.color[i]!;
      g.lineWidth = Math.max(1, this.width[i]! * (1 - t) * scale + 0.5);
      g.beginPath();
      g.arc(sx(this.x[i]!), sy(this.y[i]!), r, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }
}

/** Floating score texts. Small fixed pool. */
export class Floaters {
  private readonly n = 10;
  readonly x = new Float32Array(this.n);
  readonly y = new Float32Array(this.n);
  readonly life = new Float32Array(this.n);
  readonly maxLife = new Float32Array(this.n);
  readonly size = new Float32Array(this.n);
  readonly text: string[] = new Array<string>(this.n).fill('');
  readonly sub: string[] = new Array<string>(this.n).fill('');
  readonly color: string[] = new Array<string>(this.n).fill('#fff');
  private next = 0;

  spawn(x: number, y: number, text: string, color: string, size = 18, sub = '', life = 0.9): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.x[i] = x;
    this.y[i] = y;
    this.text[i] = text;
    this.sub[i] = sub;
    this.color[i] = color;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) if (this.life[i]! > 0) this.life[i]! -= dt;
  }

  clear(): void {
    this.life.fill(0);
  }

  private readonly pt = { x: 0, y: 0 };

  /** Draws in screen space, upright; `toScreen` maps a world point to screen CSS pixels. */
  draw(g: CanvasRenderingContext2D, toScreen: (x: number, y: number, out: { x: number; y: number }) => void, ui: number, font: string): void {
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i]!;
      if (life <= 0) continue;
      const t = 1 - life / this.maxLife[i]!;
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.55 : 1.15 - Math.min(0.15, (t - 0.15) * 0.6);
      toScreen(this.x[i]!, this.y[i]!, this.pt);
      const x = this.pt.x;
      const y = this.pt.y - (20 + t * 34) * ui;
      g.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      const size = this.size[i]! * ui * pop;
      g.font = `800 ${size.toFixed(1)}px ${font}`;
      g.lineWidth = Math.max(2, size * 0.16);
      g.strokeStyle = 'rgba(5,6,20,0.75)';
      g.strokeText(this.text[i]!, x, y);
      g.fillStyle = this.color[i]!;
      g.fillText(this.text[i]!, x, y);
      if (this.sub[i]) {
        const s2 = size * 0.5;
        g.font = `700 ${s2.toFixed(1)}px ${font}`;
        g.lineWidth = Math.max(2, s2 * 0.2);
        g.strokeText(this.sub[i]!, x, y + size * 0.78);
        g.fillText(this.sub[i]!, x, y + size * 0.78);
      }
    }
    g.restore();
  }
}

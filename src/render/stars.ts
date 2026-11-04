import { Rng } from '../sim/rng';
import { BG_BOTTOM, BG_TOP } from './palette';
import { glow } from './sprites';

interface Layer {
  /** Parallax factor relative to world scroll. */
  factor: number;
  xs: Float32Array;
  ys: Float32Array;
  size: Float32Array;
  tw: Float32Array;
  color: string;
}

/**
 * Three-layer parallax starfield plus a few soft nebula clouds. Star
 * positions are normalised (0..1) so they adapt to any screen size.
 */
export class Starfield {
  private layers: Layer[] = [];
  private nebulae: { x: number; y: number; r: number; color: string; factor: number }[] = [];
  private bgGrad: CanvasGradient | null = null;
  private bgH = 0;

  constructor(seed = 99) {
    const rng = new Rng(seed);
    const specs = [
      { factor: 0.06, n: 90, size: [0.5, 1.1], color: '#9fb4ff' },
      { factor: 0.16, n: 55, size: [0.8, 1.6], color: '#d8e4ff' },
      { factor: 0.34, n: 26, size: [1.2, 2.2], color: '#ffffff' },
    ];
    for (const sp of specs) {
      const L: Layer = {
        factor: sp.factor,
        xs: new Float32Array(sp.n),
        ys: new Float32Array(sp.n),
        size: new Float32Array(sp.n),
        tw: new Float32Array(sp.n),
        color: sp.color,
      };
      for (let i = 0; i < sp.n; i++) {
        L.xs[i] = rng.next();
        L.ys[i] = rng.next();
        L.size[i] = rng.range(sp.size[0]!, sp.size[1]!);
        L.tw[i] = rng.range(0, Math.PI * 2);
      }
      this.layers.push(L);
    }
    const nebColors = ['#3b1c7a', '#0f4a6e', '#5a1550', '#14325e'];
    for (let i = 0; i < 5; i++) {
      this.nebulae.push({
        x: rng.next(),
        y: rng.next(),
        r: rng.range(0.35, 0.7),
        color: nebColors[i % nebColors.length]!,
        factor: rng.range(0.03, 0.08),
      });
    }
  }

  /**
   * @param scroll world-y of the camera bottom times the camera scale (px)
   * @param time seconds, for twinkle
   */
  draw(g: CanvasRenderingContext2D, w: number, h: number, scroll: number, time: number, reducedMotion: boolean): void {
    if (!this.bgGrad || this.bgH !== h) {
      this.bgGrad = g.createLinearGradient(0, 0, 0, h);
      this.bgGrad.addColorStop(0, BG_TOP);
      this.bgGrad.addColorStop(1, BG_BOTTOM);
      this.bgH = h;
    }
    g.fillStyle = this.bgGrad;
    g.fillRect(0, 0, w, h);

    const span = Math.max(w, h);
    g.save();
    g.globalCompositeOperation = 'lighter';
    // Nebulae wrap over a tall virtual tile.
    const tileN = span * 2.2;
    for (const n of this.nebulae) {
      const r = n.r * span;
      let y = (n.y * tileN + scroll * n.factor) % tileN;
      if (y < 0) y += tileN;
      y = h - y + r;
      g.globalAlpha = 0.5;
      g.drawImage(glow(n.color), n.x * w - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;

    const tile = h + 40;
    for (const L of this.layers) {
      const off = scroll * L.factor;
      g.fillStyle = L.color;
      for (let i = 0; i < L.xs.length; i++) {
        let y = (L.ys[i]! * tile + off) % tile;
        if (y < 0) y += tile;
        const sy = h + 20 - y;
        const sx = L.xs[i]! * w;
        const tw = reducedMotion ? 0.8 : 0.65 + 0.35 * Math.sin(time * (1.2 + (i % 5) * 0.3) + L.tw[i]!);
        const s = L.size[i]!;
        g.globalAlpha = tw;
        if (s > 1.7) {
          g.drawImage(glow(L.color), sx - s * 3, sy - s * 3, s * 6, s * 6);
        } else {
          g.fillRect(sx - s / 2, sy - s / 2, s, s);
        }
      }
    }
    g.restore();
  }
}

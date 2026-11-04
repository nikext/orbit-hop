import type { Body } from '../sim/world';
import { Rng } from '../sim/rng';
import { planetColors } from './palette';

/**
 * Procedural sprites, rendered once into offscreen canvases. Glows are
 * radial gradients; planets get seeded bands, craters and an atmosphere.
 */

export type Sprite = HTMLCanvasElement;

function canvas(w: number, h: number): Sprite {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function ctx2d(c: Sprite): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  return g;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const glowCache = new Map<string, Sprite>();

/** Soft additive glow, 128px; draw it scaled. */
export function glow(color: string): Sprite {
  let s = glowCache.get(color);
  if (s) return s;
  s = canvas(128, 128);
  const g = ctx2d(s);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, rgba(color, 1));
  grad.addColorStop(0.18, rgba(color, 0.55));
  grad.addColorStop(0.45, rgba(color, 0.16));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowCache.set(color, s);
  return s;
}

/** Four-point sparkle used for stardust. */
let sparkle: Sprite | null = null;
export function sparkleSprite(): Sprite {
  if (sparkle) return sparkle;
  const s = canvas(64, 64);
  const g = ctx2d(s);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,180,0.9)');
  grad.addColorStop(0.25, 'rgba(255,210,94,0.35)');
  grad.addColorStop(1, 'rgba(255,210,94,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff6d0';
  g.beginPath();
  g.moveTo(32, 6);
  g.quadraticCurveTo(35, 29, 58, 32);
  g.quadraticCurveTo(35, 35, 32, 58);
  g.quadraticCurveTo(29, 35, 6, 32);
  g.quadraticCurveTo(29, 29, 32, 6);
  g.fill();
  sparkle = s;
  return s;
}

const PLANET_CACHE_MAX = 48;
const planetCache = new Map<string, Sprite>();

/**
 * Planet texture with atmosphere halo, at `pxPerUnit` resolution. The sprite
 * is (r + halo) * 2 world units wide, centred on the planet.
 */
export function planetSprite(b: Body, pxPerUnit: number): { sprite: Sprite; worldSize: number } {
  const bucket = Math.max(0.5, Math.round(pxPerUnit * 4) / 4);
  const halo = b.kind === 'giant' ? b.r * 0.55 : b.kind === 'moon' ? b.r * 0.5 : b.r * 0.7;
  const worldSize = (b.r + halo) * 2;
  const key = `${b.id}@${bucket}`;
  let s = planetCache.get(key);
  if (s) {
    // Refresh LRU order.
    planetCache.delete(key);
    planetCache.set(key, s);
    return { sprite: s, worldSize };
  }
  const px = Math.min(512, worldSize * bucket);
  s = canvas(px, px);
  const g = ctx2d(s);
  const k = px / worldSize;
  g.scale(k, k);
  g.translate(worldSize / 2, worldSize / 2);
  drawPlanet(g, b, halo);
  planetCache.set(key, s);
  while (planetCache.size > PLANET_CACHE_MAX) {
    const first = planetCache.keys().next().value as string;
    planetCache.delete(first);
  }
  return { sprite: s, worldSize };
}

function drawPlanet(g: CanvasRenderingContext2D, b: Body, halo: number): void {
  const c = planetColors(b.kind, b.hue);
  const r = b.r;
  const rng = new Rng(b.look);

  // Atmosphere halo.
  const atm = g.createRadialGradient(0, 0, r * 0.85, 0, 0, r + halo);
  atm.addColorStop(0, rgba(c.glow, 0.5));
  atm.addColorStop(0.35, rgba(c.glow, 0.16));
  atm.addColorStop(1, rgba(c.glow, 0));
  g.fillStyle = atm;
  g.beginPath();
  g.arc(0, 0, r + halo, 0, Math.PI * 2);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.clip();

  // Base disc.
  const base = g.createLinearGradient(-r, -r, r, r);
  base.addColorStop(0, c.light);
  base.addColorStop(0.35, c.base);
  base.addColorStop(1, c.dark);
  g.fillStyle = base;
  g.fillRect(-r, -r, r * 2, r * 2);

  // Bands: wavy horizontal stripes, tilted a little.
  const tilt = rng.range(-0.35, 0.35);
  g.rotate(tilt);
  const bands = b.kind === 'giant' ? rng.int(6, 9) : b.kind === 'moon' ? 0 : rng.int(2, 5);
  for (let i = 0; i < bands; i++) {
    const y = rng.range(-r, r);
    const hgt = rng.range(r * 0.06, r * (b.kind === 'giant' ? 0.22 : 0.16));
    const amp = rng.range(0, r * 0.06);
    const freq = rng.range(2, 5) / r;
    const ph = rng.range(0, 6.28);
    g.fillStyle = rng.chance(0.5) ? rgba(c.light, rng.range(0.12, 0.3)) : rgba(c.dark, rng.range(0.18, 0.4));
    g.beginPath();
    for (let x = -r; x <= r; x += r / 10) g.lineTo(x, y + Math.sin(x * freq + ph) * amp);
    for (let x = r; x >= -r; x -= r / 10) g.lineTo(x, y + hgt + Math.sin(x * freq + ph + 0.6) * amp);
    g.closePath();
    g.fill();
  }
  g.rotate(-tilt);

  // Craters (rocky worlds and moons) or storm spots (giants).
  if (b.kind === 'giant') {
    const sx = rng.range(-r * 0.4, r * 0.4);
    const sy = rng.range(-r * 0.3, r * 0.4);
    g.fillStyle = rgba(c.dark, 0.45);
    g.beginPath();
    g.ellipse(sx, sy, r * 0.2, r * 0.11, tilt, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba(c.light, 0.35);
    g.lineWidth = r * 0.025;
    g.stroke();
  } else if (b.kind !== 'pulsar') {
    const n = b.kind === 'moon' ? rng.int(4, 7) : rng.int(2, 6);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * r * 0.8;
      const cr = rng.range(r * 0.07, r * 0.2);
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      g.fillStyle = rgba(c.dark, 0.38);
      g.beginPath();
      g.arc(x, y, cr, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = rgba(c.light, 0.3);
      g.lineWidth = cr * 0.25;
      g.beginPath();
      g.arc(x, y, cr, Math.PI * 0.9, Math.PI * 1.7);
      g.stroke();
    }
  }

  // Terminator: shade the far side for a spherical look.
  const shade = g.createRadialGradient(-r * 0.45, -r * 0.5, r * 0.15, -r * 0.1, -r * 0.1, r * 1.45);
  shade.addColorStop(0, 'rgba(255,255,255,0.18)');
  shade.addColorStop(0.5, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(3,2,15,0.72)');
  g.fillStyle = shade;
  g.fillRect(-r, -r, r * 2, r * 2);
  g.restore();

  // Rim light.
  g.strokeStyle = rgba(c.light, 0.55);
  g.lineWidth = Math.max(0.6, r * 0.04);
  g.beginPath();
  g.arc(0, 0, r - g.lineWidth / 2, Math.PI * 0.95, Math.PI * 1.75);
  g.stroke();
}

/** Jagged rock outline, unit radius, seeded. Shape (not colour) marks hazards. */
const rockCache = new Map<number, Float32Array>();
export function rockShape(look: number): Float32Array {
  let s = rockCache.get(look);
  if (s) return s;
  const rng = new Rng(look);
  const n = 9;
  s = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const d = i % 2 === 0 ? rng.range(0.95, 1.2) : rng.range(0.62, 0.8);
    s[i * 2] = Math.cos(a) * d;
    s[i * 2 + 1] = Math.sin(a) * d;
  }
  if (rockCache.size > 64) rockCache.clear();
  rockCache.set(look, s);
  return s;
}

export function clearSpriteCaches(): void {
  planetCache.clear();
}

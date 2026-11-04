import { describe, expect, it } from 'vitest';
import { Camera, SIDEWAYS_ASPECT } from '../src/render/camera';
import { HALF_W, SIDE_MARGIN } from '../src/sim/constants';

/** Records the matrix a camera sets, and applies it to a view point. */
function transformOf(cam: Camera, dpr = 1) {
  let m = [1, 0, 0, 1, 0, 0];
  const g = { setTransform: (...a: number[]) => (m = a) } as unknown as CanvasRenderingContext2D;
  cam.worldTransform(g, dpr);
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
  return { m, apply: (x: number, y: number) => ({ x: (a * x + c * y + e) / dpr, y: (b * x + d * y + f) / dpr }) };
}

function cam(w: number, h: number): Camera {
  const c = new Camera();
  c.resize(w, h);
  c.bottom = 1000;
  return c;
}

describe('camera layout', () => {
  it('keeps portrait and square screens upright', () => {
    for (const [w, h] of [
      [390, 844],
      [800, 800],
      [Math.floor(700 * SIDEWAYS_ASPECT), 700],
    ] as const) {
      const c = cam(w, h);
      expect(c.sideways).toBe(false);
      expect([c.w, c.h]).toEqual([w, h]);
    }
  });

  it('lays the column on its side on landscape screens', () => {
    for (const [w, h] of [
      [844, 390],
      [1280, 720],
      [667, 375],
    ] as const) {
      const c = cam(w, h);
      expect(c.sideways).toBe(true);
      expect([c.w, c.h]).toEqual([h, w]);
    }
  });

  it('gives landscape phones bigger planets and more of the route ahead than an upright column would', () => {
    const side = cam(844, 390);
    // What the upright layout gave at this size: the column squeezed to fit the height.
    const uprightScale = Math.min(844 / ((HALF_W + SIDE_MARGIN) * 2 + 24), 390 / 580);
    expect(side.scale).toBeGreaterThan(uprightScale * 1.15);
    const ahead = side.top - side.bottom;
    expect(ahead).toBeGreaterThan(580 * 1.5);
    // The whole column (with its side margins) still fits across the screen height.
    const edge = HALF_W + SIDE_MARGIN;
    expect(side.sx(-edge)).toBeGreaterThanOrEqual(0);
    expect(side.sx(edge)).toBeLessThanOrEqual(side.w);
  });

  it('toScreen matches the canvas transform, and forward points right when sideways', () => {
    for (const [w, h] of [
      [844, 390],
      [390, 844],
      [1280, 720],
      [800, 800],
    ] as const) {
      const c = cam(w, h);
      const t = transformOf(c, 2);
      const out = { x: 0, y: 0 };
      for (const [x, y] of [
        [0, 1100],
        [-150, 1300],
        [120, 1250],
      ] as const) {
        c.toScreen(x, y, out);
        const p = t.apply(c.sx(x), c.sy(y));
        expect(out.x).toBeCloseTo(p.x, 6);
        expect(out.y).toBeCloseTo(p.y, 6);
      }
      const near = { x: 0, y: 0 };
      const far = { x: 0, y: 0 };
      c.toScreen(0, 1100, near);
      c.toScreen(0, 1400, far);
      if (c.sideways) {
        expect(far.x).toBeGreaterThan(near.x);
        expect(far.y).toBeCloseTo(near.y, 6);
      } else {
        expect(far.y).toBeLessThan(near.y);
      }
    }
  });

  it('turns without mirroring, so orbits keep their direction', () => {
    const { m } = transformOf(cam(844, 390));
    const [a, b, c, d] = m as [number, number, number, number];
    expect(a * d - b * c).toBeGreaterThan(0);
  });
});

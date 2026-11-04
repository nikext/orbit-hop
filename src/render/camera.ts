import { FLOOR_BELOW_ANCHOR, HALF_W, SIDE_MARGIN } from '../sim/constants';

/** Minimum world height kept visible, so landscape screens still see what's ahead. */
const MIN_VIEW_H = 640;
const VIEW_W = (HALF_W + SIDE_MARGIN) * 2 + 24;

/**
 * Maps world units (y up) to CSS pixels (y down). The bottom of the screen
 * tracks the sim's floor, so falling off the bottom is literally falling out
 * of the play area. Works at any aspect ratio: the column always fits
 * horizontally, and a minimum world height is always visible.
 */
export class Camera {
  w = 1;
  h = 1;
  scale = 1;
  /** World y at the bottom edge of the screen. */
  bottom = -FLOOR_BELOW_ANCHOR;
  shakeX = 0;
  shakeY = 0;
  private shake = 0;
  private shakeSeed = 1;
  /** Short zoom punch on capture. */
  punch = 0;

  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.scale = Math.min(this.w / VIEW_W, this.h / MIN_VIEW_H);
  }

  /** Smoothly follow the floor. Snaps if it's far away (e.g. a restart). */
  follow(floor: number, dt: number): void {
    const target = floor;
    const d = target - this.bottom;
    if (Math.abs(d) > 2000 || dt <= 0) this.bottom = target;
    else this.bottom += d * (1 - Math.exp(-dt * 4.2));
  }

  addShake(amount: number): void {
    this.shake = Math.min(14, Math.max(this.shake, amount));
  }

  update(dt: number, reducedMotion: boolean): void {
    this.shake *= Math.exp(-dt * 9);
    if (this.shake < 0.05 || reducedMotion) this.shake = 0;
    this.shakeSeed = (this.shakeSeed * 16807) % 2147483647;
    const a = (this.shakeSeed / 2147483647) * Math.PI * 2;
    this.shakeX = Math.cos(a) * this.shake;
    this.shakeY = Math.sin(a) * this.shake;
    this.punch *= Math.exp(-dt * 10);
  }

  /** Effective scale including the capture zoom punch. */
  get s(): number {
    return this.scale * (1 + this.punch * 0.025);
  }

  sx(x: number): number {
    return this.w / 2 + x * this.s + this.shakeX;
  }

  sy(y: number): number {
    // Zoom punch is centred on the middle of the screen.
    const base = this.h - (y - this.bottom) * this.scale;
    return this.h / 2 + (base - this.h / 2) * (1 + this.punch * 0.025) + this.shakeY;
  }

  /** World y visible at the top edge. */
  get top(): number {
    return this.bottom + this.h / this.scale;
  }
}

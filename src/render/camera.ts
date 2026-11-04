import { FLOOR_BELOW_ANCHOR, HALF_W, SIDE_MARGIN } from '../sim/constants';

/** Minimum world height kept visible, so wide screens still see what's ahead. */
const MIN_VIEW_H = 580;
const VIEW_W = (HALF_W + SIDE_MARGIN) * 2 + 24;
/**
 * Screens wider than this (w / h) lay the column on its side: "forward" points
 * right and the column fills the screen height, instead of a narrow upright
 * column in the middle. Square-ish screens keep the upright view, so a window
 * resized around 1:1 doesn't flip back and forth.
 */
export const SIDEWAYS_ASPECT = 1.2;

/**
 * Maps world units (y up) to CSS pixels (y down). The bottom of the view
 * tracks the sim's floor, so falling off the bottom is literally falling out
 * of the play area. Works at any aspect ratio: the column always fits across
 * the view, and a minimum world height is always visible ahead.
 *
 * On landscape screens the view is turned sideways. `w`, `h`, `sx` and `sy`
 * then describe an upright *view* (w = screen height, h = screen width), and
 * `worldTransform` turns that view a quarter turn onto the screen, so the
 * world renderer never needs to know. Anything that must stay upright on
 * screen (text) maps points with `toScreen` and draws untransformed.
 */
export class Camera {
  /** View size in CSS pixels (upright, before the sideways turn). */
  w = 1;
  h = 1;
  /** Screen size in CSS pixels. */
  screenW = 1;
  screenH = 1;
  /** The view is laid on its side: world "up" points right on screen. */
  sideways = false;
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
    this.screenW = Math.max(1, w);
    this.screenH = Math.max(1, h);
    this.sideways = this.screenW > this.screenH * SIDEWAYS_ASPECT;
    this.w = this.sideways ? this.screenH : this.screenW;
    this.h = this.sideways ? this.screenW : this.screenH;
    this.scale = Math.min(this.w / VIEW_W, this.h / MIN_VIEW_H);
  }

  /**
   * Canvas transform for drawing the world in view coordinates.
   * Sideways: view (vx, vy) lands on screen (screenW - vy, vx), a quarter turn
   * with no mirroring, so orbits keep their direction.
   */
  worldTransform(g: CanvasRenderingContext2D, dpr: number): void {
    if (this.sideways) g.setTransform(0, dpr, -dpr, 0, this.screenW * dpr, 0);
    else g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** World point to screen CSS pixels (for upright overlays like floating scores). */
  toScreen(x: number, y: number, out: { x: number; y: number }): void {
    const vx = this.sx(x);
    const vy = this.sy(y);
    if (this.sideways) {
      out.x = this.screenW - vy;
      out.y = vx;
    } else {
      out.x = vx;
      out.y = vy;
    }
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

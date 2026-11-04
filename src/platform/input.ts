/**
 * One-button input from touch, mouse and keyboard.
 *
 * Presses and releases are queued as edges and the sim consumes one edge per
 * tick, so even a tap that starts and ends within a single frame registers
 * as a press followed by a release. The `onDown` hook lets the UI claim a
 * press (mode chip, restart, pause overlay) before it reaches the game.
 */

export type DownResult = 'game' | 'consumed';

export interface InputHooks {
  /** A press started. Coordinates are CSS pixels, or null for keyboard. */
  onDown(x: number | null, y: number | null): DownResult;
  /** Any user gesture (for unlocking audio). */
  onGesture(): void;
  /** Esc: dismiss an overlay. Never prevented. */
  onEscape(): void;
  /** Left / right / M: switch mode where a mode chip is shown. */
  onModeKey(dir: -1 | 1): void;
}

const MAX_QUEUE = 16;
const GAME_KEYS = new Set(['Space', 'Enter', 'NumpadEnter', 'ArrowUp', 'KeyW']);

export class Input {
  private queue: boolean[] = [];
  /** Logical state of the game button (after the last queued edge). */
  private down = false;
  private pointerId: number | null = null;
  private keysDown = new Set<string>();
  /** Last held value handed to the sim. */
  private held = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly hooks: InputHooks,
  ) {
    el.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** The held value for the next sim tick. Consumes at most one queued edge. */
  nextHeld(): boolean {
    const e = this.queue.shift();
    if (e !== undefined) this.held = e;
    return this.held;
  }

  /** True if the game button is currently down (including queued edges). */
  get isDown(): boolean {
    return this.down;
  }

  /** Forget all input (pause, restart). */
  reset(): void {
    this.queue.length = 0;
    this.down = false;
    this.held = false;
    this.pointerId = null;
    this.keysDown.clear();
  }

  private push(v: boolean): void {
    if (this.down === v) return;
    this.down = v;
    if (this.queue.length < MAX_QUEUE) this.queue.push(v);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    this.el.focus({ preventScroll: true });
    this.hooks.onGesture();
    if (this.pointerId !== null) return; // ignore extra fingers
    const rect = this.el.getBoundingClientRect();
    const res = this.hooks.onDown(e.clientX - rect.left, e.clientY - rect.top);
    if (res === 'game') {
      this.pointerId = e.pointerId;
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {
        /* not fatal */
      }
      this.push(true);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (this.keysDown.size === 0) this.push(false);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' || e.key === 'Escape') {
      // Never preventDefault on Esc (certification requirement).
      this.hooks.onEscape();
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyM') {
      this.hooks.onGesture();
      this.hooks.onModeKey(e.code === 'ArrowLeft' ? -1 : 1);
      e.preventDefault();
      return;
    }
    if (!GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    if (e.repeat || this.keysDown.has(e.code)) return;
    this.hooks.onGesture();
    if (this.keysDown.size === 0 && this.pointerId === null) {
      const res = this.hooks.onDown(null, null);
      if (res !== 'game') return;
    }
    this.keysDown.add(e.code);
    this.push(true);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.keysDown.delete(e.code)) return;
    e.preventDefault();
    if (this.keysDown.size === 0 && this.pointerId === null) this.push(false);
  };

  private onBlur = (): void => {
    this.keysDown.clear();
    if (this.pointerId === null) this.push(false);
  };
}

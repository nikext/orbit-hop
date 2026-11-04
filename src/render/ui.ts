import { t, fmtNumber } from '../platform/i18n';
import type { Mode } from '../platform/save';
import { ACCENT, GOLD, UI, UI_DIM } from './palette';

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export type Screen = 'title' | 'play' | 'dying' | 'over';

export interface RunResult {
  score: number;
  newBest: boolean;
  best: number;
  captures: number;
  dust: number;
  maxCombo: number;
  practice: boolean;
  /** Daily mode: today's scored result. */
  dailyScore: number | null;
}

export interface UiState {
  screen: Screen;
  mode: Mode;
  dailyN: number;
  practice: boolean;
  score: number;
  /** Multiplier the next fast capture will get. */
  combo: number;
  best: number;
  /** Seconds since the current screen was entered. */
  screenT: number;
  realTime: number;
  result: RunResult | null;
  paused: boolean;
  /** Paused, but the platform has resumed: waiting for a tap. */
  resumable: boolean;
  /** Before the first launch of a run. */
  idle: boolean;
  safeTop: number;
  safeBottom: number;
  reducedMotion: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Draws HUD and overlays in CSS pixels, and remembers where the mode chip is for hit testing. */
export class Ui {
  private chip: { daily: Rect; endless: Rect } | null = null;
  /** Score display eases toward the real score for a satisfying count-up. */
  private shownScore = 0;
  private bump = 0;

  hitChip(x: number, y: number): Mode | null {
    if (!this.chip) return null;
    const pad = 8;
    for (const m of ['daily', 'endless'] as const) {
      const r = this.chip[m];
      if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) return m;
    }
    return null;
  }

  resetScore(): void {
    this.shownScore = 0;
  }

  update(dt: number, score: number): void {
    if (score < this.shownScore) this.shownScore = score;
    if (score > this.shownScore) {
      const before = Math.floor(this.shownScore);
      this.shownScore = Math.min(score, this.shownScore + Math.max(60, (score - this.shownScore) * 10) * dt);
      if (Math.floor(this.shownScore) !== before) this.bump = 1;
    }
    this.bump = Math.max(0, this.bump - dt * 5);
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, s: UiState): void {
    const u = clamp(Math.min(w, h) / 420, 0.72, 1.5);
    this.chip = null;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    if (s.paused) {
      // Paused: only the pause overlay, so nothing else competes with it.
      this.drawPause(g, w, h, u, s);
    } else {
      if (s.screen === 'title') this.drawTitle(g, w, h, u, s);
      else this.drawHud(g, w, h, u, s);
      if (s.screen === 'over' && s.result) this.drawOver(g, w, h, u, s, s.result);
    }
    g.restore();
  }

  private text(g: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, weight: number, color: string, glowColor?: string): void {
    g.font = `${weight} ${size.toFixed(1)}px ${FONT}`;
    if (glowColor) {
      g.shadowColor = glowColor;
      g.shadowBlur = size * 0.5;
    }
    g.fillStyle = color;
    g.fillText(str, x, y);
    g.shadowBlur = 0;
  }

  /** Shrinks the font until the string fits `maxW`. */
  private fit(g: CanvasRenderingContext2D, str: string, size: number, weight: number, maxW: number): number {
    g.font = `${weight} ${size.toFixed(1)}px ${FONT}`;
    const m = g.measureText(str).width;
    return m > maxW ? size * (maxW / m) : size;
  }

  private drawTitle(g: CanvasRenderingContext2D, w: number, h: number, u: number, s: UiState): void {
    const landscape = w > h * 1.15;
    const fadeIn = clamp(s.screenT * 2.5, 0, 1);
    g.globalAlpha = fadeIn;
    const top = s.safeTop + (landscape ? Math.max(40 * u, h * 0.13) : Math.max(70 * u, h * 0.16));
    const size = this.fit(g, t('title'), Math.min(54 * u, w * 0.115), 900, w - 48);
    // Soft dark backdrop so the wordmark reads over planets.
    const bg = g.createRadialGradient(w / 2, top + size * 0.6, 0, w / 2, top + size * 0.6, Math.max(size * 4, 160 * u));
    bg.addColorStop(0, 'rgba(5,6,18,0.55)');
    bg.addColorStop(1, 'rgba(5,6,18,0)');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, top + size * 5);
    g.save();
    try {
      (g as unknown as { letterSpacing: string }).letterSpacing = `${(size * 0.08).toFixed(1)}px`;
    } catch {
      /* older browsers: no letter spacing */
    }
    this.text(g, t('title'), w / 2, top, size, 900, '#ffffff', ACCENT);
    g.restore();

    const chipY = top + size * 0.62 + 18 * u;
    this.drawChip(g, w / 2, chipY, u, s);
    if (s.best > 0) this.text(g, t('best', { n: s.best }), w / 2, chipY + 54 * u, 14 * u, 600, UI_DIM);

    // How to play: one line, plus the pulsing ring around the probe drawn by the world renderer.
    const pulse = s.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(s.realTime * 3);
    const hint = `${t('hold')} · ${t('release')}`;
    const hs = this.fit(g, hint, 17 * u, 700, w - 40);
    g.globalAlpha = fadeIn * pulse;
    this.text(g, hint, w / 2, h - s.safeBottom - Math.max(34 * u, h * 0.06), hs, 700, UI, 'rgba(94,242,255,0.6)');
    g.globalAlpha = 1;
  }

  private drawChip(g: CanvasRenderingContext2D, cx: number, cy: number, u: number, s: UiState): void {
    const labels = { daily: t('daily', { n: s.dailyN }), endless: t('endless') };
    const fs = 14 * u;
    g.font = `700 ${fs.toFixed(1)}px ${FONT}`;
    const segW = Math.max(g.measureText(labels.daily).width, g.measureText(labels.endless).width) + 30 * u;
    const hh = 38 * u;
    const x0 = cx - segW;
    const y0 = cy - hh / 2;
    // Track.
    g.fillStyle = 'rgba(12,16,40,0.78)';
    g.strokeStyle = 'rgba(160,190,255,0.35)';
    g.lineWidth = 1.2;
    roundRect(g, x0, y0, segW * 2, hh, hh / 2);
    g.fill();
    g.stroke();
    const rects = {
      daily: { x: x0, y: y0, w: segW, h: hh },
      endless: { x: x0 + segW, y: y0, w: segW, h: hh },
    };
    for (const m of ['daily', 'endless'] as const) {
      const r = rects[m];
      const on = s.mode === m;
      if (on) {
        g.fillStyle = 'rgba(94,242,255,0.2)';
        g.strokeStyle = 'rgba(94,242,255,0.9)';
        g.lineWidth = 1.6;
        roundRect(g, r.x + 3, r.y + 3, r.w - 6, r.h - 6, (r.h - 6) / 2);
        g.fill();
        g.stroke();
      }
      this.text(g, labels[m], r.x + r.w / 2, r.y + r.h / 2 + 1, fs, on ? 800 : 600, on ? '#ffffff' : UI_DIM);
    }
    this.chip = rects;
  }

  private drawHud(g: CanvasRenderingContext2D, w: number, _h: number, u: number, s: UiState): void {
    if (s.screen === 'over') return;
    const y = s.safeTop + 34 * u;
    const size = 34 * u * (1 + this.bump * 0.08);
    this.text(g, fmtNumber(Math.floor(this.shownScore)), w / 2, y, size, 800, '#ffffff', 'rgba(94,242,255,0.5)');
    const label = s.mode === 'daily' ? (s.practice ? `${t('daily', { n: s.dailyN })} · ${t('practice')}` : t('daily', { n: s.dailyN })) : '';
    let ly = y + 28 * u;
    if (label) {
      this.text(g, label, w / 2, ly, 12 * u, 600, UI_DIM);
      ly += 24 * u;
    }
    if (s.combo >= 2 && !s.idle) {
      const str = `x${s.combo}`;
      const fs = 16 * u;
      g.font = `800 ${fs}px ${FONT}`;
      const pw = g.measureText(str).width + 22 * u;
      const ph = 26 * u;
      g.fillStyle = 'rgba(255,210,94,0.16)';
      g.strokeStyle = 'rgba(255,210,94,0.85)';
      g.lineWidth = 1.5;
      roundRect(g, w / 2 - pw / 2, ly - ph / 2, pw, ph, ph / 2);
      g.fill();
      g.stroke();
      this.text(g, str, w / 2, ly + 1, fs, 800, GOLD);
    }
    if (s.idle && s.screen === 'play') {
      const a = clamp(1 - (s.screenT - 2.5) / 1.5, 0, 1) * 0.85;
      if (a > 0) {
        g.globalAlpha = a;
        const hint = `${t('hold')} · ${t('release')}`;
        const hs = this.fit(g, hint, 15 * u, 700, w - 40);
        this.text(g, hint, w / 2, _h - s.safeBottom - Math.max(30 * u, _h * 0.05), hs, 700, UI);
        g.globalAlpha = 1;
      }
    }
  }

  private drawOver(g: CanvasRenderingContext2D, w: number, h: number, u: number, s: UiState, r: RunResult): void {
    const k = clamp(s.screenT * 4, 0, 1);
    const ease = 1 - (1 - k) * (1 - k);
    g.globalAlpha = ease;
    g.fillStyle = 'rgba(4,5,16,0.55)';
    g.fillRect(0, 0, w, h);

    const landscape = w > h * 1.15;
    const pw = Math.min(w - 32, 360 * u);
    const lineH = 22 * u;
    const big = 58 * u;
    const ph = 34 * u + big + lineH * 3.2 + (r.dailyScore !== null ? lineH : 0);
    const chipH = 38 * u;
    const retryH = 26 * u;
    const total = ph + 16 * u + chipH + 18 * u + retryH;
    let y0 = Math.max(s.safeTop + 12 * u, (h - total) / 2 - (landscape ? 0 : h * 0.04));
    y0 += (1 - ease) * 20 * u;
    const x0 = (w - pw) / 2;

    g.fillStyle = 'rgba(14,18,44,0.86)';
    g.strokeStyle = 'rgba(140,170,255,0.28)';
    g.lineWidth = 1.2;
    roundRect(g, x0, y0, pw, ph, 18 * u);
    g.fill();
    g.stroke();

    let y = y0 + 22 * u;
    const modeLabel = s.mode === 'daily' ? (r.practice ? `${t('daily', { n: s.dailyN })} · ${t('practice')}` : t('daily', { n: s.dailyN })) : t('endless');
    this.text(g, modeLabel.toUpperCase(), w / 2, y, 12 * u, 700, UI_DIM);
    y += big * 0.72;
    this.text(g, fmtNumber(r.score), w / 2, y, big, 900, '#ffffff', 'rgba(94,242,255,0.55)');
    y += big * 0.62;
    if (r.newBest) {
      const pulse = s.reducedMotion ? 1 : 1 + 0.05 * Math.sin(s.realTime * 6);
      this.text(g, t('newBest'), w / 2, y, 18 * u * pulse, 800, GOLD, 'rgba(255,210,94,0.7)');
    } else {
      this.text(g, t('best', { n: r.best }), w / 2, y, 15 * u, 600, UI_DIM);
    }
    y += lineH * 1.15;
    const stats = [t('planets', { n: r.captures }), t('stardust', { n: r.dust })];
    if (r.maxCombo >= 2) stats.push(t('combo', { n: r.maxCombo }));
    const statStr = stats.join('  ·  ');
    this.text(g, statStr, w / 2, y, this.fit(g, statStr, 13 * u, 600, pw - 24), 600, UI);
    y += lineH;
    if (r.dailyScore !== null) {
      this.text(g, t('todayScored', { n: r.dailyScore }), w / 2, y, 13 * u, 600, ACCENT);
      y += lineH;
    }

    const chipY = y0 + ph + 16 * u + chipH / 2;
    this.drawChip(g, w / 2, chipY, u, s);

    if (s.screenT > 0.35) {
      const pulse = s.reducedMotion ? 1 : 0.65 + 0.35 * Math.sin(s.realTime * 4);
      g.globalAlpha = ease * pulse;
      this.text(g, t('retry'), w / 2, chipY + chipH / 2 + 18 * u + retryH / 2, 17 * u, 800, UI, 'rgba(94,242,255,0.6)');
    }
    g.globalAlpha = 1;
  }

  private drawPause(g: CanvasRenderingContext2D, w: number, h: number, u: number, s: UiState): void {
    g.fillStyle = 'rgba(3,4,12,0.8)';
    g.fillRect(0, 0, w, h);
    // Pause glyph built from two bars (no text needed).
    const bw = 10 * u;
    const bh = 34 * u;
    g.fillStyle = 'rgba(238,243,255,0.9)';
    roundRect(g, w / 2 - bw * 1.6, h / 2 - 52 * u - bh / 2, bw, bh, 3 * u);
    g.fill();
    roundRect(g, w / 2 + bw * 0.6, h / 2 - 52 * u - bh / 2, bw, bh, 3 * u);
    g.fill();
    this.text(g, t('paused'), w / 2, h / 2, 26 * u, 800, '#ffffff');
    if (s.resumable) {
      const pulse = s.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(s.realTime * 4);
      g.globalAlpha = pulse;
      this.text(g, t('tapContinue'), w / 2, h / 2 + 40 * u, 17 * u, 700, ACCENT);
      g.globalAlpha = 1;
    }
  }
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

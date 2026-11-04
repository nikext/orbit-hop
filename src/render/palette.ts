/** Neon-on-deep-space palette. Hazards also differ by shape and motion, never only by colour. */

export const BG_TOP = '#070818';
export const BG_BOTTOM = '#120a2a';
export const PROBE = '#eaffff';
export const PROBE_GLOW = '#5ef2ff';
export const PREVIEW = '#bff8ff';
export const DUST = '#ffe27a';
export const DANGER = '#ff4d6d';
export const ROCK_FILL = '#6b5a55';
export const ROCK_EDGE = '#ffb199';
export const UI = '#eef3ff';
export const UI_DIM = 'rgba(238,243,255,0.62)';
export const ACCENT = '#5ef2ff';
export const GOLD = '#ffd25e';

export interface PlanetColors {
  base: string;
  dark: string;
  light: string;
  glow: string;
}

export const PLANET_COLORS: PlanetColors[] = [
  { base: '#36d6c3', dark: '#0b4f5c', light: '#c4fff3', glow: '#3dffe0' },
  { base: '#9a6bff', dark: '#2f1873', light: '#e4d6ff', glow: '#a77dff' },
  { base: '#ff5fa2', dark: '#6d1240', light: '#ffd3e8', glow: '#ff6fb0' },
  { base: '#ffad4a', dark: '#7a3d08', light: '#ffe7c4', glow: '#ffbc5e' },
  { base: '#8fe85a', dark: '#2f5a12', light: '#e6ffd1', glow: '#a4ff6b' },
  { base: '#ff7b5c', dark: '#6e2213', light: '#ffd9cf', glow: '#ff8c6e' },
  { base: '#5aa8ff', dark: '#14306e', light: '#d5e9ff', glow: '#6cb6ff' },
];

export const GIANT_COLORS: PlanetColors[] = [
  { base: '#e8a35e', dark: '#6b3410', light: '#ffe4c0', glow: '#ffb46a' },
  { base: '#c27bff', dark: '#3d1470', light: '#efd9ff', glow: '#cf8cff' },
  { base: '#ff8f7a', dark: '#6b1f18', light: '#ffe0d8', glow: '#ff9e8a' },
];

export const MOON_COLORS: PlanetColors = { base: '#a9b4cc', dark: '#3a4258', light: '#eef2ff', glow: '#c8d4ff' };
export const PULSAR_COLORS: PlanetColors = { base: '#d9f4ff', dark: '#3c6c8f', light: '#ffffff', glow: '#9fe6ff' };

export function planetColors(kind: string, hue: number): PlanetColors {
  if (kind === 'moon') return MOON_COLORS;
  if (kind === 'pulsar') return PULSAR_COLORS;
  const list = kind === 'giant' ? GIANT_COLORS : PLANET_COLORS;
  return list[Math.floor(hue * list.length) % list.length]!;
}

/**
 * Versioned save data. Serialised as a small JSON string (always well under
 * 2 KB) and stored via the platform adapter: YouTube cloud save inside
 * Playables, localStorage outside. Parsing never throws: an empty, corrupt or
 * unknown save becomes a fresh one, and older versions are migrated.
 */

export const SAVE_VERSION = 1;
export const DAILY_KEEP = 14;
export const SAVE_MAX_BYTES = 2048;

export type Mode = 'daily' | 'endless';

export interface DailyResult {
  /** Daily number (see dailyNumber). */
  day: number;
  /** The scored (first) attempt of that day. */
  score: number;
  /** Best of all attempts that day, including practice. */
  best: number;
}

export interface SaveData {
  v: typeof SAVE_VERSION;
  /** Highest score ever sent with sendScore (scored runs only). */
  best: number;
  /** Best endless score. */
  bestEndless: number;
  daily: DailyResult[];
  stats: { runs: number; hops: number; dust: number; seconds: number };
  settings: { mode: Mode };
}

export function defaultSave(): SaveData {
  return {
    v: SAVE_VERSION,
    best: 0,
    bestEndless: 0,
    daily: [],
    stats: { runs: 0, hops: 0, dust: 0, seconds: 0 },
    settings: { mode: 'endless' },
  };
}

const MAX_INT = 2_000_000_000;

function int(v: unknown, lo = 0, hi = MAX_INT): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Parse any string (or nothing) into valid, current-version save data. */
export function parseSave(raw: string | null | undefined): SaveData {
  const out = defaultSave();
  if (!raw) return out;
  let data: Record<string, unknown>;
  try {
    data = obj(JSON.parse(raw));
  } catch {
    return out;
  }
  const version = int(data.v, 0, 1000);
  // v0: the prototype only stored { best }. Anything newer than we know is read best-effort.
  if (version === 0) {
    out.best = int(data.best);
    out.bestEndless = out.best;
    return out;
  }

  out.best = int(data.best);
  out.bestEndless = int(data.bestEndless);
  if (Array.isArray(data.daily)) {
    const seen = new Set<number>();
    for (const d of data.daily) {
      const o = obj(d);
      const day = int(o.day, 0, 1_000_000);
      if (!day || seen.has(day)) continue;
      seen.add(day);
      const score = int(o.score);
      out.daily.push({ day, score, best: Math.max(score, int(o.best)) });
    }
    out.daily.sort((a, b) => a.day - b.day);
    out.daily = out.daily.slice(-DAILY_KEEP);
  }
  const s = obj(data.stats);
  out.stats = { runs: int(s.runs), hops: int(s.hops), dust: int(s.dust), seconds: int(s.seconds) };
  const set = obj(data.settings);
  out.settings.mode = set.mode === 'daily' ? 'daily' : 'endless';
  // Keep "best" consistent with everything we know was scored.
  for (const d of out.daily) out.best = Math.max(out.best, d.score);
  out.best = Math.max(out.best, out.bestEndless);
  return out;
}

export function serializeSave(data: SaveData): string {
  const trimmed: SaveData = { ...data, daily: data.daily.slice(-DAILY_KEEP) };
  return JSON.stringify(trimmed);
}

export function dailyResult(data: SaveData, day: number): DailyResult | undefined {
  return data.daily.find((d) => d.day === day);
}

export interface RunOutcome {
  mode: Mode;
  day: number;
  score: number;
  hops: number;
  dust: number;
  seconds: number;
}

export interface Recorded {
  /** Whether this run counts (endless, or the first daily attempt). */
  scored: boolean;
  newBest: boolean;
  /** For daily runs: the day's scored result after recording. */
  daily?: DailyResult;
}

/** Applies a finished run to the save. Mutates `data`. */
export function recordRun(data: SaveData, run: RunOutcome): Recorded {
  data.stats.runs = int(data.stats.runs + 1);
  data.stats.hops = int(data.stats.hops + run.hops);
  data.stats.dust = int(data.stats.dust + run.dust);
  data.stats.seconds = int(data.stats.seconds + run.seconds);
  const score = int(run.score);

  let scored = false;
  let daily: DailyResult | undefined;
  if (run.mode === 'endless') {
    scored = true;
    if (score > data.bestEndless) data.bestEndless = score;
  } else {
    daily = dailyResult(data, run.day);
    if (!daily) {
      scored = true;
      daily = { day: run.day, score, best: score };
      data.daily.push(daily);
      data.daily.sort((a, b) => a.day - b.day);
      data.daily = data.daily.slice(-DAILY_KEEP);
    } else if (score > daily.best) {
      daily.best = score;
    }
  }
  const newBest = scored && score > data.best;
  if (newBest) data.best = score;
  return { scored, newBest, daily };
}

/** Day 1 of the daily orbit. */
const DAILY_EPOCH_UTC = Date.UTC(2026, 10, 1);

/** UTC date string used as the daily seed, e.g. "2026-11-04". */
export function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** "Daily #N": 1 on the epoch day, counting up by one per UTC day. */
export function dailyNumber(now: Date): number {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(1, Math.floor((day - DAILY_EPOCH_UTC) / 86_400_000) + 1);
}

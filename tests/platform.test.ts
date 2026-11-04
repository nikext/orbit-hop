import { describe, expect, it, vi } from 'vitest';
import {
  SAVE_MAX_BYTES,
  dailyNumber,
  defaultSave,
  parseSave,
  recordRun,
  serializeSave,
  utcDateKey,
} from '../src/platform/save';
import { STORAGE_KEY, createPlatform } from '../src/platform/yt';
import { pickLang, setLang, t } from '../src/platform/i18n';

describe('save schema', () => {
  it('round-trips', () => {
    const s = defaultSave();
    recordRun(s, { mode: 'endless', day: 4, score: 1234, hops: 9, dust: 3, seconds: 40 });
    recordRun(s, { mode: 'daily', day: 4, score: 800, hops: 5, dust: 1, seconds: 20 });
    s.settings.mode = 'daily';
    expect(parseSave(serializeSave(s))).toEqual(s);
  });

  it('migrates empty, corrupt and hostile input to a valid save', () => {
    for (const raw of [null, undefined, '', '{', 'null', '[]', '42', '"x"', '{"v":1,"best":"lots","daily":"no"}']) {
      const s = parseSave(raw as string);
      expect(s.v).toBe(1);
      expect(s.best).toBe(0);
      expect(Array.isArray(s.daily)).toBe(true);
    }
    const weird = parseSave(JSON.stringify({ v: 1, best: -5, bestEndless: 1e99, stats: { runs: NaN }, settings: { mode: 'evil' } }));
    expect(weird.best).toBeGreaterThanOrEqual(0);
    expect(weird.stats.runs).toBe(0);
    expect(weird.settings.mode).toBe('endless');
  });

  it('migrates a v0 save', () => {
    const s = parseSave('{"best":4200}');
    expect(s.v).toBe(1);
    expect(s.best).toBe(4200);
    expect(s.bestEndless).toBe(4200);
  });

  it('only the first daily attempt is scored', () => {
    const s = defaultSave();
    const a = recordRun(s, { mode: 'daily', day: 10, score: 500, hops: 1, dust: 0, seconds: 5 });
    const b = recordRun(s, { mode: 'daily', day: 10, score: 900, hops: 1, dust: 0, seconds: 5 });
    expect(a.scored).toBe(true);
    expect(b.scored).toBe(false);
    expect(s.daily[0]).toEqual({ day: 10, score: 500, best: 900 });
    expect(s.best).toBe(500);
  });

  it('best always equals the highest scored run', () => {
    const s = defaultSave();
    recordRun(s, { mode: 'endless', day: 1, score: 300, hops: 0, dust: 0, seconds: 0 });
    const r = recordRun(s, { mode: 'daily', day: 1, score: 700, hops: 0, dust: 0, seconds: 0 });
    expect(r.newBest).toBe(true);
    expect(s.best).toBe(700);
    expect(s.bestEndless).toBe(300);
  });

  it('stays under 2 KB even when full', () => {
    const s = defaultSave();
    for (let d = 1; d < 400; d++) recordRun(s, { mode: 'daily', day: d, score: 1_999_999_999, hops: 1e9, dust: 1e9, seconds: 1e9 });
    recordRun(s, { mode: 'endless', day: 1, score: 1_999_999_999, hops: 1e9, dust: 1e9, seconds: 1e9 });
    const str = serializeSave(s);
    expect(str.length).toBeLessThan(SAVE_MAX_BYTES);
    expect(s.daily.length).toBe(14);
  });

  it('numbers dailies from the epoch in UTC', () => {
    expect(dailyNumber(new Date(Date.UTC(2026, 10, 1, 0, 0)))).toBe(1);
    expect(dailyNumber(new Date(Date.UTC(2026, 10, 4, 23, 59)))).toBe(4);
    expect(utcDateKey(new Date(Date.UTC(2026, 10, 4, 23, 59)))).toBe('2026-11-04');
  });
});

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('platform adapter fallback (ytgame undefined)', () => {
  it('uses storage for saves, and loads before saving', async () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{"v":1,"best":5}');
    const p = createPlatform({ ytgame: undefined, storage, browserLanguage: 'de-CH', doc: null });
    expect(p.inPlayables).toBe(false);
    // Save first: the adapter must still load before it writes.
    const saving = p.saveData('{"v":1,"best":6}');
    expect(await p.loadData()).toBe('{"v":1,"best":5}');
    await saving;
    expect(storage.m.get(STORAGE_KEY)).toBe('{"v":1,"best":6}');
    expect(p.debug.loaded).toBe(true);
  });

  it('falls back for language, audio, score and readiness without throwing', async () => {
    const p = createPlatform({ ytgame: undefined, storage: null, browserLanguage: 'fr-FR', doc: null });
    expect(await p.getLanguage()).toBe('fr-FR');
    expect(p.isAudioEnabled()).toBe(true);
    p.gameReady();
    expect(p.debug.firstFrame).toBe(true);
    expect(p.debug.ready).toBe(true);
    p.sendScore(12.7);
    expect(p.debug.scores).toEqual([12]);
    expect(await p.loadData()).toBe('');
    await expect(p.saveData('x')).resolves.toBeUndefined();
    await expect(p.maybeInterstitial(3)).resolves.toBeUndefined();
  });

  it('treats a loaded SDK outside Playables as the fallback', async () => {
    const fake = { IN_PLAYABLES_ENV: false } as unknown as typeof ytgame;
    const p = createPlatform({ ytgame: fake, storage: null, browserLanguage: 'it', doc: null });
    expect(p.inPlayables).toBe(false);
    expect(await p.getLanguage()).toBe('it');
  });

  it('pauses on visibilitychange outside Playables', () => {
    let handler: (() => void) | null = null;
    const doc = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (_: string, h: () => void) => {
        handler = h;
      },
    };
    const p = createPlatform({ ytgame: undefined, storage: null, doc: doc as unknown as Document });
    const onPause = vi.fn();
    const onResume = vi.fn();
    p.onPause(onPause);
    p.onResume(onResume);
    doc.visibilityState = 'hidden';
    handler!();
    expect(onPause).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'visible';
    handler!();
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe('platform adapter inside Playables', () => {
  function fakeYt() {
    const calls: string[] = [];
    let loaded = false;
    const yt = {
      IN_PLAYABLES_ENV: true,
      SDK_VERSION: 'test',
      game: {
        firstFrameReady: () => calls.push('firstFrameReady'),
        gameReady: () => calls.push('gameReady'),
        loadData: async () => {
          calls.push('loadData');
          loaded = true;
          return '{"v":1,"best":9}';
        },
        saveData: async (s: string) => {
          if (!loaded) throw new Error('saveData before loadData');
          calls.push(`saveData:${s}`);
        },
      },
      engagement: { sendScore: async (s: { value: number }) => void calls.push(`score:${s.value}`) },
      system: {
        getLanguage: async () => 'es-419',
        isAudioEnabled: () => false,
        onAudioEnabledChange: () => () => undefined,
        onPause: () => () => undefined,
        onResume: () => () => undefined,
      },
      ads: { requestInterstitialAd: async () => void calls.push('ad') },
      health: { logError: () => undefined, logWarning: () => undefined },
    };
    return { yt: yt as unknown as typeof ytgame, calls };
  }

  it('calls firstFrameReady before gameReady, once each', () => {
    const { yt, calls } = fakeYt();
    const p = createPlatform({ ytgame: yt, storage: null });
    p.gameReady();
    p.firstFrameReady();
    p.gameReady();
    expect(calls).toEqual(['firstFrameReady', 'gameReady']);
  });

  it('awaits loadData before saveData and never uses storage', async () => {
    const { yt, calls } = fakeYt();
    const storage = memoryStorage();
    const p = createPlatform({ ytgame: yt, storage });
    await p.saveData('{"v":1}');
    expect(calls).toEqual(['loadData', 'saveData:{"v":1}']);
    expect(storage.m.size).toBe(0);
  });

  it('sends integer scores, reads language and audio state, no ads in v1', async () => {
    const { yt, calls } = fakeYt();
    const p = createPlatform({ ytgame: yt, storage: null });
    p.sendScore(1500.9);
    expect(await p.getLanguage()).toBe('es-419');
    expect(p.isAudioEnabled()).toBe(false);
    await p.maybeInterstitial(3);
    await Promise.resolve();
    expect(calls).toEqual(['score:1500']);
  });
});

describe('i18n', () => {
  it('picks supported languages from BCP-47 tags', () => {
    expect(pickLang('de-CH')).toBe('de');
    expect(pickLang('es-419')).toBe('es');
    expect(pickLang('FR')).toBe('fr');
    expect(pickLang('ja-JP')).toBe('en');
    expect(pickLang('')).toBe('en');
  });
  it('interpolates', () => {
    setLang('en');
    expect(t('daily', { n: 4 })).toBe('Daily #4');
    setLang('de');
    expect(t('best', { n: 1200 })).toMatch(/^Rekord 1.?200$/);
    setLang('en');
  });
});

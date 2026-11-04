/**
 * Thin adapter over the YouTube Playables SDK (`ytgame`). Every SDK call in
 * the game goes through here. Outside Playables (local dev, the GitHub Pages
 * demo) it falls back to localStorage for saves, the browser language for
 * the locale, and page visibility for pause/resume.
 *
 * Inside Playables it never touches localStorage, navigator.language or the
 * Page Visibility API (all disallowed by the certification requirements).
 */

/** Ads are out of scope for v1. The hook exists so v2 can switch it on. */
export const ADS_ENABLED = false;
export const INTERSTITIAL_EVERY = 3;

export const STORAGE_KEY = 'orbit-hop-save-v1';

type Yt = typeof ytgame;

export interface PlatformEnv {
  ytgame?: Yt | undefined;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Browser language, used only outside Playables. */
  browserLanguage?: string;
  /** Document-like object for the visibility fallback, used only outside Playables. */
  doc?: Pick<Document, 'addEventListener' | 'visibilityState'> | null;
}

export interface Platform {
  readonly inPlayables: boolean;
  firstFrameReady(): void;
  gameReady(): void;
  /** Loads the save string ('' if none). Safe to call more than once; loads once. */
  loadData(): Promise<string>;
  /** Saves after loadData has completed (awaits it if needed). Never rejects. */
  saveData(data: string): Promise<void>;
  sendScore(value: number): void;
  getLanguage(): Promise<string>;
  isAudioEnabled(): boolean;
  onAudioEnabledChange(cb: (enabled: boolean) => void): void;
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;
  /** Called on every game over; shows an interstitial every Nth time if ads are enabled. */
  maybeInterstitial(gameOverCount: number): Promise<void>;
  logError(): void;
  /** Introspection for tests and dev builds. */
  readonly debug: { firstFrame: boolean; ready: boolean; loaded: boolean; scores: number[]; saves: number };
}

function detectYt(): Yt | undefined {
  return typeof ytgame !== 'undefined' ? ytgame : undefined;
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function createPlatform(env: PlatformEnv = {}): Platform {
  const yt = 'ytgame' in env ? env.ytgame : detectYt();
  const inPlayables = !!(yt && yt.IN_PLAYABLES_ENV);
  const debug = { firstFrame: false, ready: false, loaded: false, scores: [] as number[], saves: 0 };

  let loadPromise: Promise<string> | null = null;
  let saveChain: Promise<void> = Promise.resolve();

  const loadOnce = (): Promise<string> => {
    if (loadPromise) return loadPromise;
    if (inPlayables) {
      loadPromise = yt!.game
        .loadData()
        .then((s) => (typeof s === 'string' ? s : ''))
        .catch(() => '');
    } else {
      const storage = 'storage' in env ? env.storage : safeStorage();
      let s = '';
      try {
        s = storage?.getItem(STORAGE_KEY) ?? '';
      } catch {
        s = '';
      }
      loadPromise = Promise.resolve(s);
    }
    loadPromise = loadPromise.then((s) => {
      debug.loaded = true;
      return s;
    });
    return loadPromise;
  };

  const pauseCbs: (() => void)[] = [];
  const resumeCbs: (() => void)[] = [];
  let visibilityHooked = false;
  const hookVisibility = () => {
    if (inPlayables || visibilityHooked) return;
    const doc = 'doc' in env ? env.doc : typeof document !== 'undefined' ? document : null;
    if (!doc) return;
    visibilityHooked = true;
    doc.addEventListener('visibilitychange', () => {
      const list = doc.visibilityState === 'hidden' ? pauseCbs : resumeCbs;
      for (const cb of list) cb();
    });
  };

  return {
    inPlayables,
    debug,

    firstFrameReady() {
      if (debug.firstFrame) return;
      debug.firstFrame = true;
      if (inPlayables) yt!.game.firstFrameReady();
    },

    gameReady() {
      if (debug.ready) return;
      this.firstFrameReady();
      debug.ready = true;
      if (inPlayables) yt!.game.gameReady();
    },

    loadData: loadOnce,

    saveData(data: string) {
      // The SDK rejects saveData before loadData has succeeded, so always chain after it.
      saveChain = saveChain
        .then(() => loadOnce())
        .then(async () => {
          debug.saves++;
          if (inPlayables) {
            await yt!.game.saveData(data);
          } else {
            const storage = 'storage' in env ? env.storage : safeStorage();
            storage?.setItem(STORAGE_KEY, data);
          }
        })
        .catch(() => undefined);
      return saveChain;
    },

    sendScore(value: number) {
      const v = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)));
      if (!Number.isFinite(v)) return;
      debug.scores.push(v);
      if (debug.scores.length > 16) debug.scores.shift();
      if (inPlayables) yt!.engagement.sendScore({ value: v }).catch(() => undefined);
    },

    async getLanguage() {
      if (inPlayables) {
        try {
          return await yt!.system.getLanguage();
        } catch {
          return 'en';
        }
      }
      if (env.browserLanguage !== undefined) return env.browserLanguage;
      return typeof navigator !== 'undefined' ? navigator.language || 'en' : 'en';
    },

    isAudioEnabled() {
      if (!inPlayables) return true;
      try {
        return yt!.system.isAudioEnabled();
      } catch {
        return false;
      }
    },

    onAudioEnabledChange(cb) {
      if (inPlayables) yt!.system.onAudioEnabledChange(cb);
    },

    onPause(cb) {
      if (inPlayables) yt!.system.onPause(cb);
      else {
        pauseCbs.push(cb);
        hookVisibility();
      }
    },

    onResume(cb) {
      if (inPlayables) yt!.system.onResume(cb);
      else {
        resumeCbs.push(cb);
        hookVisibility();
      }
    },

    async maybeInterstitial(gameOverCount: number) {
      if (!ADS_ENABLED || !inPlayables) return;
      if (gameOverCount <= 0 || gameOverCount % INTERSTITIAL_EVERY !== 0) return;
      try {
        await yt!.ads.requestInterstitialAd();
      } catch {
        /* no ad is fine */
      }
    },

    logError() {
      if (inPlayables) {
        try {
          yt!.health.logError();
        } catch {
          /* best effort */
        }
      }
    },
  };
}

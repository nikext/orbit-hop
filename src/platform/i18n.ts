/** UI strings. The game has very little text; everything else is shape and motion. */

const en = {
  title: 'ORBIT HOP',
  hold: 'Hold to charge',
  release: 'release to hop',
  daily: 'Daily #{n}',
  endless: 'Endless',
  best: 'Best {n}',
  newBest: 'New best!',
  practice: 'Practice',
  todayScored: "Today's score {n}",
  retry: 'Tap to retry',
  paused: 'Paused',
  tapContinue: 'Tap to continue',
  near: 'Near miss',
  slingshot: 'Slingshot!',
  planets: '{n} planets',
  stardust: '{n} stardust',
  combo: 'x{n} combo',
  mode: 'Mode',
} as const;

export type StringKey = keyof typeof en;
type Table = Record<StringKey, string>;

const de: Table = {
  title: 'ORBIT HOP',
  hold: 'Halten zum Aufladen',
  release: 'loslassen zum Springen',
  daily: 'Täglich #{n}',
  endless: 'Endlos',
  best: 'Rekord {n}',
  newBest: 'Neuer Rekord!',
  practice: 'Training',
  todayScored: 'Heute gewertet {n}',
  retry: 'Tippen für neuen Versuch',
  paused: 'Pausiert',
  tapContinue: 'Tippen zum Fortsetzen',
  near: 'Knapp!',
  slingshot: 'Schleuder!',
  planets: '{n} Planeten',
  stardust: '{n} Sternenstaub',
  combo: 'x{n} Kombo',
  mode: 'Modus',
};

const fr: Table = {
  title: 'ORBIT HOP',
  hold: 'Maintiens pour charger',
  release: 'relâche pour sauter',
  daily: 'Défi #{n}',
  endless: 'Infini',
  best: 'Record {n}',
  newBest: 'Nouveau record !',
  practice: 'Entraînement',
  todayScored: 'Score du jour {n}',
  retry: 'Touche pour rejouer',
  paused: 'Pause',
  tapContinue: 'Touche pour continuer',
  near: 'De justesse',
  slingshot: 'Fronde !',
  planets: '{n} planètes',
  stardust: '{n} poussières',
  combo: 'combo x{n}',
  mode: 'Mode',
};

const it: Table = {
  title: 'ORBIT HOP',
  hold: 'Tieni premuto per caricare',
  release: 'rilascia per saltare',
  daily: 'Sfida #{n}',
  endless: 'Infinita',
  best: 'Record {n}',
  newBest: 'Nuovo record!',
  practice: 'Allenamento',
  todayScored: 'Punteggio di oggi {n}',
  retry: 'Tocca per riprovare',
  paused: 'In pausa',
  tapContinue: 'Tocca per continuare',
  near: 'Per un pelo',
  slingshot: 'Fionda!',
  planets: '{n} pianeti',
  stardust: '{n} polvere di stelle',
  combo: 'combo x{n}',
  mode: 'Modalità',
};

const es: Table = {
  title: 'ORBIT HOP',
  hold: 'Mantén para cargar',
  release: 'suelta para saltar',
  daily: 'Diario #{n}',
  endless: 'Infinito',
  best: 'Récord {n}',
  newBest: '¡Nuevo récord!',
  practice: 'Práctica',
  todayScored: 'Puntuación de hoy {n}',
  retry: 'Toca para reintentar',
  paused: 'En pausa',
  tapContinue: 'Toca para continuar',
  near: 'Por poco',
  slingshot: '¡Honda!',
  planets: '{n} planetas',
  stardust: '{n} polvo estelar',
  combo: 'combo x{n}',
  mode: 'Modo',
};

export const LANGS = { en, de, fr, it, es } as const;
export type Lang = keyof typeof LANGS;

/** Maps a BCP-47 tag like "de-CH" or "es-419" to a supported language, defaulting to English. */
export function pickLang(tag: string | null | undefined): Lang {
  const base = (tag ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return base in LANGS ? (base as Lang) : 'en';
}

let current: Lang = 'en';
let numberFormat: Intl.NumberFormat | null = null;
const locales: Record<Lang, string> = { en: 'en-US', de: 'de-CH', fr: 'fr-FR', it: 'it-IT', es: 'es-ES' };

export function setLang(lang: Lang): void {
  current = lang;
  numberFormat = null;
}

export function getLang(): Lang {
  return current;
}

export function fmtNumber(n: number): string {
  try {
    numberFormat ??= new Intl.NumberFormat(locales[current]);
    return numberFormat.format(n);
  } catch {
    return String(n);
  }
}

export function t(key: StringKey, vars?: Record<string, string | number>): string {
  let s: string = LANGS[current][key] ?? en[key];
  if (vars) {
    for (const k in vars) {
      const v = vars[k]!;
      s = s.replace(`{${k}}`, typeof v === 'number' ? fmtNumber(v) : v);
    }
  }
  return s;
}

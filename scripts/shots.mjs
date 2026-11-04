/**
 * Playwright screenshots of every key state at four viewport sizes, plus a
 * smoke test of the production build (no console errors, no network
 * requests except the Playables SDK script).
 *
 *   npm run shots                 # all sizes and states -> shots/
 *   npm run shots -- --only 390x844
 *
 * Uses the Vite dev server (dev flags are only available there) and
 * `vite preview` for the production smoke test (run `npm run build` first,
 * or it's skipped).
 */
import { chromium } from '@playwright/test';
import { createServer, preview } from 'vite';
import { existsSync, mkdirSync } from 'node:fs';

const SIZES = [
  [390, 844],
  [844, 390],
  [1280, 720],
  [800, 800],
];
const STATES = [
  ['title', '?shot=title'],
  ['charge', '?seed=42&autoplay&t=12&shot=charge'],
  ['flight', '?seed=42&autoplay&t=12&shot=flight'],
  ['capture', '?seed=42&autoplay&t=12&shot=capture'],
  ['over', '?seed=42&autoplay&t=12&shot=over'],
  ['pause', '?shot=pause'],
  ['late', '?seed=7&autoplay&t=75&shot=flight'],
  ['later', '?seed=11&autoplay&t=140&shot=charge'],
  ['title-de', '?shot=title&lang=de'],
];

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const SDK = 'https://www.youtube.com/game_api/v1';

mkdirSync('shots', { recursive: true });

const server = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: false, host: '127.0.0.1' } });
await server.listen();
const base = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const problems = [];

const OFFLINE_SDK = 'window.ytgame={IN_PLAYABLES_ENV:false,SDK_VERSION:"shots"};';

/**
 * A stand-in for the Playables SDK that records every call, so the
 * integration can be checked end to end against the production build.
 */
const FAKE_PLAYABLES_SDK = `(() => {
  const calls = (window.__ytCalls = []);
  const cbs = (window.__ytCbs = { pause: [], resume: [], audio: [] });
  let loaded = false;
  window.ytgame = {
    IN_PLAYABLES_ENV: true,
    SDK_VERSION: 'fake',
    game: {
      firstFrameReady() { calls.push('firstFrameReady'); },
      gameReady() { calls.push('gameReady'); },
      loadData() { calls.push('loadData'); loaded = true; return Promise.resolve(''); },
      saveData(s) {
        if (!loaded) { calls.push('saveData-before-load'); return Promise.reject(undefined); }
        calls.push('saveData:' + s.length);
        window.__lastSave = s;
        return Promise.resolve();
      },
    },
    engagement: { sendScore(s) { calls.push('sendScore:' + s.value); return Promise.resolve(); }, openYTContent() { return Promise.resolve(); } },
    system: {
      getLanguage() { calls.push('getLanguage'); return Promise.resolve('fr-FR'); },
      isAudioEnabled() { return false; },
      onAudioEnabledChange(cb) { cbs.audio.push(cb); return () => {}; },
      onPause(cb) { cbs.pause.push(cb); return () => {}; },
      onResume(cb) { cbs.resume.push(cb); return () => {}; },
    },
    ads: { requestInterstitialAd() { calls.push('ad'); return Promise.resolve(); }, requestRewardedAd() { return Promise.resolve(false); } },
    health: { logError() { calls.push('logError'); }, logWarning() {} },
  };
})();`;

async function openPage(w, h, url, label, sdkBody = OFFLINE_SDK) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const origin = new URL(url).origin;
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${label}: console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`${label}: page error: ${e.message}`));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin) || u.startsWith('data:')) return route.continue();
    if (u === SDK) {
      // Offline stand-in for the SDK: outside Playables it only defines the global.
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: sdkBody });
    }
    problems.push(`${label}: unexpected network request: ${u}`);
    return route.abort();
  });
  await page.goto(url);
  return page;
}

let count = 0;
for (const [w, h] of SIZES) {
  if (only && only !== `${w}x${h}`) continue;
  for (const [name, query] of STATES) {
    const label = `${w}x${h}-${name}`;
    const page = await openPage(w, h, base + query, label);
    try {
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 60_000 });
    } catch {
      problems.push(`${label}: never reached the shot state`);
    }
    const info = await page.evaluate(() => window.__shotInfo);
    await page.screenshot({ path: `shots/${label}.png` });
    console.log(`${label.padEnd(22)} ${JSON.stringify(info)}`);
    count++;
    await page.close();
  }
}
// Scored game over inside (fake) Playables, driven by the dev autoplay bot.
{
  const page = await openPage(390, 844, base + '?seed=42&autoplay&t=12&shot=over', 'playables-score', FAKE_PLAYABLES_SDK);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 60_000 });
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__ytCalls);
  const info = await page.evaluate(() => window.__shotInfo);
  const save = await page.evaluate(() => JSON.parse(window.__lastSave || '{}'));
  console.log(`playables game over      ${JSON.stringify(calls)} best=${save.best}`);
  if (!calls.includes(`sendScore:${info.score}`)) problems.push(`playables: expected sendScore:${info.score}`);
  if (save.best !== info.score) problems.push('playables: saved best does not match the sent score');
  const load = calls.indexOf('loadData');
  const firstSave = calls.findIndex((c) => c.startsWith('saveData'));
  if (load < 0 || firstSave < load || calls.includes('saveData-before-load')) problems.push('playables: saveData before loadData');
  await page.close();
}
await server.close();

// Production smoke test.
if (existsSync('dist/index.html')) {
  const prev = await preview({ logLevel: 'error', preview: { port: 5198, host: '127.0.0.1' } });
  const url = prev.resolvedUrls.local[0];
  const page = await openPage(390, 844, url, 'prod');
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({ lang: document.documentElement.lang }));
  // Hold, release, and make sure the page survives a real input cycle.
  await page.mouse.move(195, 600);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/prod-390x844.png' });
  await page.setViewportSize({ width: 900, height: 420 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/prod-resized-900x420.png' });
  console.log(`prod smoke               ${JSON.stringify(state)}`);
  await page.close();

  // Playables integration, end to end, with a recording fake SDK.
  const yt = await openPage(390, 844, url, 'playables', FAKE_PLAYABLES_SDK);
  await yt.waitForTimeout(800);
  const usedStorageBefore = await yt.evaluate(() => localStorage.length);
  // A zero-charge tap: falls back and crashes (a score of 0 isn't sent).
  await yt.mouse.click(195, 600);
  await yt.waitForTimeout(3500);
  const lang = await yt.evaluate(() => document.documentElement.lang);
  // Platform pause: the frame loop must stop; resume shows the overlay and waits for a tap.
  const frames = () => yt.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 300) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); }));
  await yt.evaluate(() => window.__ytCbs.pause.forEach((cb) => cb()));
  await yt.waitForTimeout(300);
  await yt.screenshot({ path: 'shots/playables-paused.png' });
  await yt.evaluate(() => window.__ytCbs.resume.forEach((cb) => cb()));
  await yt.waitForTimeout(300);
  await yt.screenshot({ path: 'shots/playables-resumed.png' });
  await frames();
  const calls = await yt.evaluate(() => window.__ytCalls);
  const usedStorage = await yt.evaluate(() => localStorage.length);
  console.log(`playables calls          ${JSON.stringify(calls)}`);
  const idx = (c) => calls.findIndex((x) => x.startsWith(c));
  if (idx('firstFrameReady') < 0 || idx('gameReady') < idx('firstFrameReady')) problems.push('playables: firstFrameReady must come before gameReady');
  if (idx('loadData') < 0 || calls.includes('saveData-before-load')) problems.push('playables: saveData before loadData');
  if (idx('saveData') < 0) problems.push('playables: no saveData on game over / pause');
  if (calls.includes('ad')) problems.push('playables: ads requested in v1');
  if (lang !== 'fr') problems.push(`playables: getLanguage not applied (lang=${lang})`);
  if (usedStorage || usedStorageBefore) problems.push('playables: localStorage used inside Playables');
  await yt.close();
  await new Promise((r) => prev.httpServer.close(r));
} else {
  console.log('(no dist/: skipped the production smoke test; run npm run build first)');
}

await browser.close();
console.log(`\n${count} screenshots in shots/`);
if (problems.length) {
  console.log('\nProblems:');
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}

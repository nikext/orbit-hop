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

async function openPage(w, h, url, label) {
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
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.ytgame={IN_PLAYABLES_ENV:false,SDK_VERSION:"shots"};' });
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

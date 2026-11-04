/**
 * Playables bundle checks on dist/ (run after `vite build`):
 *  - every file under 512 KiB (the SHOULD limit; the MUST is 30 MiB)
 *  - gzipped total under 1 MB (target under 300 KB)
 *  - file names only [A-Za-z0-9_.-], at most 8000 files
 *  - no absolute paths or URLs except the SDK script
 *  - the SDK <script> is the first script in index.html
 *  - no Worker / WebAssembly / eval( / new Function in the output
 *  - no dev-only code (bot, URL flags) in the output
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
const SDK = 'https://www.youtube.com/game_api/v1';
const FILE_MAX = 512 * 1024;
const GZIP_MAX = 1024 * 1024;
const GZIP_TARGET = 300 * 1024;
const NAME_RE = /^[A-Za-z0-9_.-]+$/;

const errors = [];
const warnings = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(DIST);
if (files.length > 8000) errors.push(`too many files: ${files.length} > 8000`);

let raw = 0;
let gz = 0;
const rows = [];
for (const f of files) {
  const rel = relative(DIST, f);
  for (const part of rel.split(/[\\/]/)) {
    if (!NAME_RE.test(part)) errors.push(`forbidden file name: ${rel}`);
  }
  const buf = readFileSync(f);
  const g = gzipSync(buf, { level: 9 }).length;
  raw += buf.length;
  gz += g;
  rows.push([rel, buf.length, g]);
  if (buf.length > FILE_MAX) errors.push(`${rel} is ${(buf.length / 1024).toFixed(1)} KiB (> 512 KiB)`);

  if (!/\.(js|html|css|json|txt|svg|map)$/.test(f)) continue;
  let text = buf.toString('utf8');

  if (f.endsWith('.html')) {
    const scripts = [...text.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    if (!scripts.length || !scripts[0].includes(`src="${SDK}"`)) errors.push(`${rel}: the SDK script must be the first <script>`);
    for (const m of text.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)) {
      const u = m[1];
      if (u === SDK) continue;
      if (/^(?:[a-z]+:)?\/\//i.test(u) || u.startsWith('/')) errors.push(`${rel}: absolute path or URL: ${u}`);
    }
    text = text.split(SDK).join('');
  }

  // Absolute URLs anywhere in code or markup (the SDK URL is allowed in index.html only).
  for (const m of text.matchAll(/\b(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)]*/gi)) {
    errors.push(`${rel}: absolute URL in output: ${m[0].slice(0, 80)}`);
  }
  for (const m of text.matchAll(/(?:url\(|from\s*|import\(\s*)["']?(\/[A-Za-z0-9_])/g)) {
    errors.push(`${rel}: root-absolute path: ${m[0]}`);
  }

  const forbidden = [
    [/\bnew\s+Worker\b|\bSharedWorker\b|\bServiceWorker\b|\bWorker\(/, 'Web Worker'],
    [/\bWebAssembly\b/, 'WebAssembly'],
    [/\beval\s*\(/, 'eval('],
    [/\bnew\s+Function\b/, 'new Function'],
    [/\bnavigator\.sendBeacon\b|\bXMLHttpRequest\b|\bfetch\s*\(|\bWebSocket\b|\bEventSource\b/, 'network API'],
  ];
  for (const [re, what] of forbidden) if (re.test(text)) errors.push(`${rel}: contains ${what}`);
  for (const devOnly of ['__shotReady', 'autoplay', 'checkReachable']) {
    if (text.includes(devOnly)) errors.push(`${rel}: dev-only code leaked into the build (${devOnly})`);
  }
}

if (gz > GZIP_MAX) errors.push(`gzipped total ${(gz / 1024).toFixed(1)} KiB > 1 MB`);
else if (gz > GZIP_TARGET) warnings.push(`gzipped total ${(gz / 1024).toFixed(1)} KiB is over the 300 KB target`);

console.log('Bundle:');
for (const [rel, b, g] of rows) console.log(`  ${rel.padEnd(36)} ${(b / 1024).toFixed(1).padStart(8)} KiB  ${(g / 1024).toFixed(1).padStart(7)} KiB gz`);
console.log(`  ${'total'.padEnd(36)} ${(raw / 1024).toFixed(1).padStart(8)} KiB  ${(gz / 1024).toFixed(1).padStart(7)} KiB gz  (${files.length} files)`);
for (const w of warnings) console.log(`warning: ${w}`);
if (errors.length) {
  console.error('\nBundle check FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('\nBundle check passed.');

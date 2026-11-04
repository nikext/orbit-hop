/**
 * Headless difficulty bot.
 *
 *   npm run bot                       # both reports, default sizes
 *   npm run bot -- --seeds 60         # more seeds for the play report
 *   npm run bot -- --reach-only --reach-seeds 40 --hops 70
 *
 * "play": a human-like bot (search + forgiving choice + timing noise) plays
 * N seeds per profile and prints first-death time, score and cause
 * distributions. "reach": a perfect search bot follows the column and fails
 * loudly if any generated gap is unreachable.
 *
 * Tooling only: uses node:worker_threads to spread seeds over a few cores.
 * Nothing here ships in the game bundle.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { GOOD_PLAYER, NEW_PLAYER, checkReachable, playHuman, type BotRun } from '../src/sim/bot';

type Job = { kind: 'play'; seed: number; profile: 'new' | 'good'; maxSeconds: number } | { kind: 'reach'; seed: number; hops: number };
type Result = { kind: 'play'; profile: string; run: BotRun } | { kind: 'reach'; seed: number; failedAtRow: number; hops: number };

function runJob(job: Job): Result {
  if (job.kind === 'play') {
    const profile = job.profile === 'new' ? NEW_PLAYER : GOOD_PLAYER;
    return { kind: 'play', profile: job.profile, run: playHuman(job.seed, profile, job.maxSeconds) };
  }
  const r = checkReachable(job.seed, job.hops);
  return { kind: 'reach', seed: job.seed, ...r };
}

if (!isMainThread) {
  for (const job of workerData as Job[]) parentPort!.postMessage(runJob(job));
  parentPort!.close();
} else {
  const args = process.argv.slice(2);
  const num = (name: string, def: number) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : def;
  };
  const has = (name: string) => args.includes(name);
  const seeds = num('--seeds', 40);
  const reachSeeds = num('--reach-seeds', 24);
  const hops = num('--hops', 60);
  const maxSeconds = num('--max', 300);
  const threads = Math.max(1, Math.min(num('--threads', 6), cpus().length));

  const jobs: Job[] = [];
  if (!has('--reach-only')) {
    for (let i = 0; i < seeds; i++) jobs.push({ kind: 'play', seed: 1000 + i * 7, profile: 'new', maxSeconds });
    if (!has('--new-only')) for (let i = 0; i < seeds; i++) jobs.push({ kind: 'play', seed: 1000 + i * 7, profile: 'good', maxSeconds });
  }
  if (!has('--play-only')) for (let i = 0; i < reachSeeds; i++) jobs.push({ kind: 'reach', seed: 50000 + i * 31, hops });

  const t0 = Date.now();
  const buckets: Job[][] = Array.from({ length: threads }, () => []);
  jobs.forEach((j, i) => buckets[i % threads]!.push(j));
  const results: Result[] = [];
  await Promise.all(
    buckets
      .filter((b) => b.length)
      .map(
        (bucket) =>
          new Promise<void>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), { workerData: bucket, execArgv: ['--import', 'tsx'] });
            w.on('message', (r: Result) => {
              results.push(r);
              if (results.length % 10 === 0) process.stderr.write(`  ${results.length}/${jobs.length}\r`);
            });
            w.on('error', reject);
            w.on('exit', () => resolve());
          }),
      ),
  );

  const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    if (!s.length) return NaN;
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]!;
  };
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '-');

  let failed = false;
  for (const profile of ['new', 'good']) {
    const runs = results.filter((r): r is Extract<Result, { kind: 'play' }> => r.kind === 'play' && r.profile === profile).map((r) => r.run);
    if (!runs.length) continue;
    const times = runs.map((r) => r.time);
    const scores = runs.map((r) => r.score);
    const caps = runs.map((r) => r.captures);
    const causes: Record<string, number> = {};
    for (const r of runs) {
      const k = r.stuck ? 'stuck' : r.died ? (r.cause ?? '?') : 'survived';
      causes[k] = (causes[k] ?? 0) + 1;
    }
    const stuck = runs.filter((r) => r.stuck).length;
    console.log(`\n== ${profile} player bot, ${runs.length} seeds (cap ${maxSeconds}s) ==`);
    console.log(`first death (s): p10 ${fmt(q(times, 0.1))}  median ${fmt(q(times, 0.5))}  p90 ${fmt(q(times, 0.9))}`);
    console.log(`score:           p10 ${q(scores, 0.1)}  median ${q(scores, 0.5)}  p90 ${q(scores, 0.9)}  max ${Math.max(...scores)}`);
    console.log(`captures:        p10 ${q(caps, 0.1)}  median ${q(caps, 0.5)}  p90 ${q(caps, 0.9)}`);
    console.log(`height (km):     median ${fmt(q(runs.map((r) => r.height / 10), 0.5))}`);
    console.log(`end causes:      ${JSON.stringify(causes)}`);
    if (stuck) {
      failed = true;
      console.log(`!! ${stuck} run(s) got stuck with no reachable move`);
    }
  }

  const reach = results.filter((r): r is Extract<Result, { kind: 'reach' }> => r.kind === 'reach');
  if (reach.length) {
    const bad = reach.filter((r) => r.failedAtRow >= 0);
    console.log(`\n== reachability: ${reach.length} seeds x ${hops} hops ==`);
    if (bad.length) {
      failed = true;
      for (const b of bad) console.log(`!! seed ${b.seed}: unreachable gap at row ${b.failedAtRow} (after ${b.hops} hops)`);
    } else console.log('every gap reachable');
  }
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s on ${threads} threads)`);
  process.exit(failed ? 1 : 0);
}

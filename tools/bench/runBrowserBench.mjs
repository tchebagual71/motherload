// Runs bench.html (ADR-0002 browser bench) in headless Chromium + SwiftShader and prints the result and its HFB1
// code. SwiftShader is a CPU rasteriser, so the frame numbers say nothing about a phone's GPU (04 §10.7); the tick
// numbers are this machine's. The decision run is on the Galaxy A15/A16 (04 §3.4).
//
//   HF_SCOPE=mvp npm run build && npx vite preview --port 5311 &
//   node tools/bench/runBrowserBench.mjs [baseUrl] [query] [--shot=path.png] [--device="iPhone 15"]
//   e.g. node tools/bench/runBrowserBench.mjs http://localhost:5311/ "fast=1"
import { chromium, devices } from '@playwright/test';

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5311/';
const query = args.find((a) => !a.startsWith('--') && !/^https?:/.test(a)) ?? '';
const shot = args.find((a) => a.startsWith('--shot='))?.slice(7);
const midShot = args.find((a) => a.startsWith('--midshot='))?.slice(10);
const device = args.find((a) => a.startsWith('--device='))?.slice(9) ?? 'iPhone 15';
const timeoutMs = Number(process.env.HF_BENCH_TIMEOUT_MS ?? 30 * 60_000);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices[device], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const url = `${base.replace(/\/$/, '')}/bench.html${query ? `?${query}` : ''}`;
const t0 = Date.now();
await page.goto(url);
let lastLog = 0;
let midDone = false;
for (;;) {
  const s = await page.evaluate(() => {
    const b = window.__hfBench;
    return b ? { phase: b.phase, progress: b.progress, error: b.error, status: document.getElementById('status')?.textContent ?? '' } : null;
  });
  if (s?.phase === 'done' || s?.phase === 'error') break;
  if (midShot && !midDone && s?.phase === 'timed' && s.progress > 0.3) {
    await page.screenshot({ path: midShot });
    midDone = true;
  }
  if (Date.now() - t0 > timeoutMs) throw new Error(`bench timed out: ${JSON.stringify(s)}`);
  if (Date.now() - lastLog > 15_000) {
    console.log(`${Math.round((Date.now() - t0) / 1000)} s · ${s?.status ?? 'loading'}`);
    lastLog = Date.now();
  }
  await page.waitForTimeout(1_000);
}
const result = await page.evaluate(() => ({ report: window.__hfBench.report, code: window.__hfBench.code, error: window.__hfBench.error }));
if (shot) await page.screenshot({ path: shot, fullPage: true });
await browser.close();
if (result.error) {
  console.error(`bench error: ${result.error}`);
  process.exit(1);
}
const r = result.report;
const f = (n) => (n < 1 ? n.toFixed(3) : n.toFixed(2));
console.log(`url ${url} (${device}), ${Math.round((Date.now() - t0) / 1000)} s wall`);
console.log(`fixture: ${r.entities} entities + ${r.beltTiles} belt tiles = ${r.buildings} buildings, ${r.items} items, built in ${r.buildMs} ms`);
console.log(`factory tick (${r.tick.n} live ticks, clock step ${f(r.timerResMs)} ms): p50 ${f(r.tick.p50)} p95 ${f(r.tick.p95)} p99 ${f(r.tick.p99)} max ${f(r.tick.max)} ms`);
console.log(`factory tick batched (${r.tickBatch.n} × 200): mean ${f(r.tickBatch.mean)} p50 ${f(r.tickBatch.p50)} p95 ${f(r.tickBatch.p95)} max ${f(r.tickBatch.max)} ms · gate p95 ≤ 1.5 ms ${r.gatePass ? 'PASS' : 'FAIL'}`);
console.log(`frame (${r.mode}): p50 ${f(r.frame.p50)} p95 ${f(r.frame.p95)} ms, dropped ${(r.dropped * 100).toFixed(1)}% at ${r.displayHz} Hz; work p50 ${f(r.work.p50)} p95 ${f(r.work.p95)} ms`);
console.log(`render: ${r.drawCalls} draw calls, ${r.triangles} triangles, ${r.look}/${r.quality}, DPR ${r.dpr}; gpu ${r.gpu}`);
console.log(`code ${result.code}`);
if (errors.length) console.log(`page errors:\n${errors.join('\n')}`);

// Payload report and gate (canon §3.14): initial JS ≤ 350 KB brotli / 430 KB gzip; first playable precache
// ≤ 2.5 MB. "Initial JS" = the entry module plus every chunk index.html modulepreloads.
// Usage: node scripts/size-report.mjs [distDir] [--warn-only]   (prints a Markdown table)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const dist = args.find((a) => !a.startsWith('--')) ?? 'dist';
const warnOnly = args.includes('--warn-only');
const LIMITS = { br: 350 * 1024, gzip: 430 * 1024, precache: 2.5 * 1024 * 1024 };
const NOT_PRECACHED = [/jetsam\.html$/, /jetsamPage-/, /DebugSheet-/, /testHook-/, /harness/, /\.map$/, /assets-manifest\.json$/, /sw\.js$/, /workbox-/];

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = [...html.matchAll(/<(?:script[^>]*type="module"[^>]*src|link[^>]*rel="modulepreload"[^>]*href)="([^"]+)"/g)].map((m) => m[1]);
const initial = [...new Set(refs)].map((r) => join(dist, r.replace(/^(\.\/|\/motherload\/|\/)/, '')));

let raw = 0;
let gz = 0;
let br = 0;
for (const f of initial) {
  const buf = readFileSync(f);
  raw += buf.length;
  gz += gzipSync(buf, { level: 9 }).length;
  br += brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
}
const precache = walk(dist)
  .filter((f) => /\.(js|css|html|svg|png|woff2)$/.test(f) && !NOT_PRECACHED.some((re) => re.test(f)))
  .reduce((s, f) => s + statSync(f).size, 0);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const ok = (v, lim) => (v <= lim ? '✅' : '❌');
console.log('### Payload');
console.log('| Measure | Size | Budget | |');
console.log('|---|---|---|---|');
console.log(`| Initial JS (raw, ${initial.length} files) | ${kb(raw)} | — | |`);
console.log(`| Initial JS brotli | ${kb(br)} | ${kb(LIMITS.br)} | ${ok(br, LIMITS.br)} |`);
console.log(`| Initial JS gzip | ${kb(gz)} | ${kb(LIMITS.gzip)} | ${ok(gz, LIMITS.gzip)} |`);
console.log(`| Precache (shell) | ${kb(precache)} | ${kb(LIMITS.precache)} | ${ok(precache, LIMITS.precache)} |`);
console.log('');
console.log(initial.map((f) => `- ${relative(dist, f)}`).join('\n'));

const over = br > LIMITS.br || gz > LIMITS.gzip || precache > LIMITS.precache;
if (over && !warnOnly) {
  console.error('size-report: payload over budget (canon §3.14)');
  process.exit(1);
}

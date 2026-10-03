// Initial-payload gate (canon §3.14 "Payload"; 04 §12.1). After a build, everything dist/index.html makes the
// browser fetch before the game can boot (the entry script, every modulepreload and the stylesheets) is compressed
// the way a host would serve it (brotli q11 and gzip -9, node:zlib) and printed as Markdown tables, which CI appends
// to the job summary. Exits 1 when initial JS is over the canon budget, or the Workbox precache (the shell the first
// playable needs) is over the first-playable budget. The budgets are read from canon §3.14, never copied here.
// CSS is listed but only JS counts toward the "initial JS" budget. KB = 1,024 bytes.
// Usage: npm run size [-- [distDir] [--warn-only]]        (distDir defaults to dist/)
// Its unit tests run in Vitest from this file (vite.config.ts test.includeSource).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const KB = 1024;
const CANON = fileURLToPath(new URL('../docs/design/00-canon.md', import.meta.url));

/** The canon §3.14 payload budgets in bytes: initial JS brotli and gzip, and the first-playable precache (raw). */
export function parseBudgets(canon) {
  const at = canon.search(/^### 3\.14\b/m);
  if (at < 0) throw new Error('canon §3.14 (Performance budgets) not found');
  const body = canon.slice(canon.indexOf('\n', at) + 1);
  const end = body.search(/^#{1,3} /m);
  const section = end < 0 ? body : body.slice(0, end);
  const js = /initial JS (?:≤|<=)\s*\**\s*([\d.]+)\s*KB brotli\s*\/\s*([\d.]+)\s*KB gzip/i.exec(section);
  const shell = /first playable (?:≤|<=)\s*\**\s*([\d.]+)\s*MB/i.exec(section);
  if (!js || !shell) throw new Error('canon §3.14: no "initial JS ≤ … KB brotli / … KB gzip; first playable ≤ … MB" budget');
  return { br: Number(js[1]) * KB, gzip: Number(js[2]) * KB, precache: Number(shell[1]) * KB * KB };
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/**
 * What index.html loads up front, in page order and without repeats: scripts with a src ('entry'; Vite writes one
 * module entry, `nomodule` fallbacks never load in a WebGL2 browser), modulepreloads ('preload') and stylesheets
 * ('css'). Icons, the manifest and dynamic imports are not part of it.
 */
export function initialRefs(html) {
  const refs = [];
  const add = (ref, kind) => {
    if (ref && !refs.some((r) => r.ref === ref)) refs.push({ ref, kind });
  };
  for (const [tag] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    if (/^<script/i.test(tag)) {
      if (!/\snomodule\b/i.test(tag)) add(attr(tag, 'src'), 'entry');
      continue;
    }
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('modulepreload')) add(attr(tag, 'href'), 'preload');
    else if (rel.includes('stylesheet')) add(attr(tag, 'href'), 'css');
  }
  return refs;
}

/**
 * The dist-relative path a page reference names: `./assets/x.js` with the default base, `/motherload/assets/x.js`
 * under HF_BASE (the longest suffix that `exists`). Null for an off-origin URL or a file that is not in dist.
 */
export function distPath(ref, exists) {
  const path = ref.split(/[?#]/)[0];
  if (/^[a-z][\w+.-]*:/i.test(path) || path.startsWith('//')) return null;
  const parts = path.split('/').filter((p) => p !== '' && p !== '.');
  for (let i = 0; i < parts.length; i++) {
    const p = parts.slice(i).join('/');
    if (exists(p)) return p;
  }
  return null;
}

/** The URLs Workbox precaches: generateSW inlines the manifest into sw.js as `{url:"…",revision:…}` entries. */
export function precacheUrls(sw) {
  return [...sw.matchAll(/\{\s*["']?url["']?\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Raw, brotli (quality 11) and gzip (level 9) sizes of one file. */
export function measure(buf) {
  return {
    raw: buf.length,
    br: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length,
    gzip: gzipSync(buf, { level: 9 }).length,
  };
}

/** One row per budget: the measured size against its canon limit (precache null: the build has no sw.js). */
export function verdicts(files, precache, budgets) {
  const js = files.filter((f) => f.kind !== 'css');
  const sum = (k) => js.reduce((s, f) => s + f[k], 0);
  const rows = [
    { label: 'Initial JS, brotli q11', size: sum('br'), limit: budgets.br },
    { label: 'Initial JS, gzip -9', size: sum('gzip'), limit: budgets.gzip },
  ];
  if (precache !== null) rows.push({ label: 'First-playable precache, raw', size: precache, limit: budgets.precache });
  return rows.map((r) => ({ ...r, over: r.size > r.limit }));
}

const kb = (n) => `${(n / KB).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;

/** The Markdown report: the initial set file by file, then each budget. */
export function report(files, precache, rows) {
  const total = (k, pick) => files.filter(pick).reduce((s, f) => s + f[k], 0);
  const isJs = (f) => f.kind !== 'css';
  const isCss = (f) => f.kind === 'css';
  const out = ['### Initial payload (canon §3.14)', '', '| File | Kind | Raw | Brotli | Gzip |', '|---|---|--:|--:|--:|'];
  for (const f of files) out.push(`| ${f.path} | ${f.kind} | ${kb(f.raw)} | ${kb(f.br)} | ${kb(f.gzip)} |`);
  const nJs = files.filter(isJs).length;
  const nCss = files.filter(isCss).length;
  out.push(`| **Initial JS** | ${nJs} file${nJs === 1 ? '' : 's'} | ${kb(total('raw', isJs))} | **${kb(total('br', isJs))}** | **${kb(total('gzip', isJs))}** |`);
  if (nCss > 0) out.push(`| CSS (not in the JS budget) | ${nCss} file${nCss === 1 ? '' : 's'} | ${kb(total('raw', isCss))} | ${kb(total('br', isCss))} | ${kb(total('gzip', isCss))} |`);
  out.push('', '| Budget | Size | Limit | Headroom | |', '|---|--:|--:|--:|---|');
  for (const r of rows) out.push(`| ${r.label} | ${kb(r.size)} | ${kb(r.limit)} | ${kb(r.limit - r.size)} | ${r.over ? '**OVER**' : 'ok'} |`);
  if (precache === null) out.push('', '_No sw.js in this build: the precache was not measured._');
  return out.join('\n');
}

function isFile(p) {
  return existsSync(p) && statSync(p).isFile();
}

function main(argv) {
  const warnOnly = argv.includes('--warn-only');
  const dist = resolve(argv.find((a) => !a.startsWith('--')) ?? 'dist');
  const index = join(dist, 'index.html');
  if (!isFile(index)) throw new Error(`${index} not found: run npm run build first`);
  const budgets = parseBudgets(readFileSync(CANON, 'utf8'));
  const refs = initialRefs(readFileSync(index, 'utf8'));
  if (!refs.some((r) => r.kind === 'entry')) throw new Error(`${index} has no <script src> entry`);
  const files = refs.map(({ ref, kind }) => {
    const path = distPath(ref, (p) => isFile(join(dist, p)));
    if (path === null) throw new Error(`${ref} (index.html) is not a file in ${dist}`);
    return { path, kind, ...measure(readFileSync(join(dist, path))) };
  });
  const sw = join(dist, 'sw.js');
  const precache = isFile(sw)
    ? precacheUrls(readFileSync(sw, 'utf8')).reduce((s, u) => {
        const path = distPath(u, (p) => isFile(join(dist, p)));
        if (path === null) throw new Error(`precached ${u} (sw.js) is not a file in ${dist}`);
        return s + statSync(join(dist, path)).size;
      }, 0)
    : null;
  const rows = verdicts(files, precache, budgets);
  console.log(report(files, precache, rows));
  const over = rows.filter((r) => r.over);
  if (over.length === 0) return 0;
  const what = over.map((r) => `${r.label} ${kb(r.size)} > ${kb(r.limit)}`).join('; ');
  console.error(`check-size: over the canon §3.14 payload budget: ${what}${warnOnly ? ' (--warn-only)' : ''}`);
  return warnOnly ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`check-size: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  // What Vite 8 writes into dist/index.html (default base), trimmed; plus things that are not the initial set.
  const INDEX = `<!doctype html><html><head>
    <!-- <script type="module" src="./assets/commented-out.js"></script> -->
    <script type="module">import('./assets/inline-dynamic.js')</script>
    <script type="module" crossorigin src="./assets/main-AAAA.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/modulepreload-polyfill-BBBB.js">
    <link rel="modulepreload" crossorigin href="./assets/core-CCCC.js">
    <link crossorigin href='./assets/main-AAAA.js' rel=modulepreload>
    <link rel="stylesheet" crossorigin href="./assets/main-DDDD.css">
    <link rel="icon" type="image/svg+xml" href="./icon.svg">
    <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png">
    <link rel="manifest" href="./manifest.webmanifest"></head>
    <body><script nomodule src="./assets/legacy.js"></script><script defer src="./late.js"></script></body></html>`;

  describe('check-size (canon §3.14 payload gate)', () => {
    it('reads the payload budgets from canon §3.14, so the gate cannot silently drift from the canon', () => {
      const b = parseBudgets(readFileSync(CANON, 'utf8'));
      for (const v of Object.values(b)) expect(Number.isFinite(v) && v > 0).toBe(true);
      expect(b.br).toBeLessThan(b.gzip);
      expect(b.gzip).toBeLessThan(b.precache);
    });

    it('parses the §3.14 payload line and nothing outside §3.14', () => {
      const md = [
        '### 3.13 Platforms',
        '- initial JS ≤ 1 KB brotli / 2 KB gzip; first playable ≤ 9 MB',
        '### 3.14 Performance budgets',
        '| Budget | Low |',
        '- **Payload:** initial JS ≤ **350 KB brotli / 430 KB gzip**; first playable ≤ 2.5 MB (music excluded)',
        '### 3.15 Save',
      ].join('\n');
      expect(parseBudgets(md)).toEqual({ br: 350 * KB, gzip: 430 * KB, precache: 2.5 * KB * KB });
      expect(() => parseBudgets(md.replace('### 3.14', '### 3.99'))).toThrow(/§3\.14/);
      expect(() => parseBudgets(md.replace('Payload:** initial JS ≤', 'Payload:** initial JS about'))).toThrow(/budget/);
    });

    it('collects the entry scripts, every modulepreload and the stylesheets, once each, in page order', () => {
      expect(initialRefs(INDEX)).toEqual([
        { ref: './assets/main-AAAA.js', kind: 'entry' },
        { ref: './assets/modulepreload-polyfill-BBBB.js', kind: 'preload' },
        { ref: './assets/core-CCCC.js', kind: 'preload' },
        { ref: './assets/main-DDDD.css', kind: 'css' },
        { ref: './late.js', kind: 'entry' },
      ]);
    });

    it('maps relative and HF_BASE-prefixed references into dist, and nothing off-origin', () => {
      const dist = new Set(['assets/main-AAAA.js', 'index.html']);
      const exists = (p) => dist.has(p);
      expect(distPath('./assets/main-AAAA.js', exists)).toBe('assets/main-AAAA.js');
      expect(distPath('/motherload/assets/main-AAAA.js', exists)).toBe('assets/main-AAAA.js');
      expect(distPath('/assets/main-AAAA.js?v=1', exists)).toBe('assets/main-AAAA.js');
      expect(distPath('index.html', exists)).toBe('index.html');
      expect(distPath('./assets/missing.js', exists)).toBeNull();
      expect(distPath('https://cdn.example/assets/main-AAAA.js', exists)).toBeNull();
      expect(distPath('//cdn.example/assets/main-AAAA.js', exists)).toBeNull();
    });

    it('reads the precache list generateSW inlines into sw.js', () => {
      const sw = 's.precacheAndRoute([{url:"index.html",revision:"8d83"},{url:"assets/core-CCCC.js",revision:null},{ "url": "icon.svg", "revision": "02e8" }],{})';
      expect(precacheUrls(sw)).toEqual(['index.html', 'assets/core-CCCC.js', 'icon.svg']);
    });

    it('gates initial JS (CSS excluded) at brotli and gzip, and the precache', () => {
      const budgets = { br: 100, gzip: 120, precache: 1000 };
      const files = [
        { path: 'a.js', kind: 'entry', raw: 300, br: 60, gzip: 70 },
        { path: 'b.js', kind: 'preload', raw: 200, br: 40, gzip: 50 },
        { path: 'a.css', kind: 'css', raw: 900, br: 500, gzip: 600 },
      ];
      expect(verdicts(files, 1000, budgets).map((r) => r.over)).toEqual([false, false, false]);
      const heavier = [...files, { path: 'c.js', kind: 'preload', raw: 10, br: 1, gzip: 1 }];
      expect(verdicts(heavier, 1001, budgets).map((r) => r.over)).toEqual([true, true, true]);
      expect(verdicts(files, null, budgets)).toHaveLength(2);
      expect(report(heavier, 1001, verdicts(heavier, 1001, budgets))).toContain('**OVER**');
    });

    it('measures brotli q11 and gzip -9 below raw for text', () => {
      const m = measure(Buffer.from('export const a = 1;\n'.repeat(500)));
      expect(m.raw).toBe(10_000);
      expect(m.br).toBeLessThan(m.gzip);
      expect(m.gzip).toBeLessThan(m.raw / 20);
    });

    it("names the chunk the game shares with bench.html 'core', and leaves every other chunk's name alone", async () => {
      const { default: config } = await import('../vite.config.ts');
      const output = config.build.rolldownOptions.output;
      const chunk = (moduleIds, extra = {}) => ({ name: 'types', isEntry: false, isDynamicEntry: false, facadeModuleId: null, moduleIds, exports: [], ...extra });
      const three = '/repo/node_modules/three/build/three.core.js';
      expect(output.chunkFileNames(chunk([three, '/repo/src/shared/types.ts']))).toBe('assets/core-[hash].js');
      expect(output.chunkFileNames(chunk(['/repo/src/shared/canon.ts'], { name: 'canon' }))).toBe('assets/[name]-[hash].js');
      expect(output.chunkFileNames(chunk([three], { name: 'lazyBuild', isDynamicEntry: true }))).toBe('assets/[name]-[hash].js');
    });
  });
}

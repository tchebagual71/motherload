// GitHub Pages asset retention (04 §9.4). Every deploy replaces the whole site, so a phone still running the
// previous index.html would 404 on its lazy chunks. Before upload, this merges the hashed assets of the previous
// 2 releases (listed in the live assets-manifest.json) into dist/assets/ and writes a new manifest. Hashed names
// never collide; releases older than 30 days drop out. Network failures only warn: the deploy goes ahead.
// Usage: node scripts/pages-retention.mjs <distDir> <siteBaseUrl> <releaseId>
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dist = 'dist', siteArg = '', releaseId = 'local'] = process.argv.slice(2);
const KEEP_RELEASES = 2;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const site = siteArg.replace(/\/+$/, '');
const assetsDir = join(dist, 'assets');
const now = Date.now();

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

const current = { id: releaseId, at: now, assets: existsSync(assetsDir) ? readdirSync(assetsDir).sort() : [] };
let previous = [];
if (site) {
  try {
    const live = await fetchJson(`${site}/assets-manifest.json`);
    previous = (Array.isArray(live.releases) ? live.releases : []).filter((r) => r.id !== releaseId && now - r.at <= MAX_AGE_MS).slice(0, KEEP_RELEASES);
  } catch (e) {
    console.warn(`retention: no live manifest (${e.message}); first deploy or site unreachable`);
  }
}

mkdirSync(assetsDir, { recursive: true });
const have = new Set(current.assets);
let copied = 0;
for (const rel of previous) {
  for (const name of rel.assets ?? []) {
    if (have.has(name) || name.includes('/') || name.includes('..')) continue;
    try {
      const r = await fetch(`${site}/assets/${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      writeFileSync(join(assetsDir, name), Buffer.from(await r.arrayBuffer()));
      have.add(name);
      copied++;
    } catch (e) {
      console.warn(`retention: could not keep ${name}: ${e.message}`);
    }
  }
}

writeFileSync(join(dist, 'assets-manifest.json'), JSON.stringify({ releases: [current, ...previous] }, null, 1));
console.log(`retention: release ${releaseId}, ${current.assets.length} assets, kept ${copied} from ${previous.length} previous release(s)`);

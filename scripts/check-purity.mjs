// Purity lint for simulation code (04 §2.2): no DOM, three, wall clock or Math.random in pure modules.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PURE = ['src/shared', 'src/terrain', 'src/pod', 'src/economy', 'src/story', 'src/factory', 'src/world', 'src/save/codec'];
const BANNED = [
  [/\bMath\.random\b/, 'Math.random (use shared/rng)'],
  [/\bDate\.now\b|\bnew Date\b/, 'wall clock'],
  [/\bperformance\.now\b/, 'performance.now'],
  [/\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/, 'timers'],
  [/from ['"]three['"]/, 'three import'],
  [/\bdocument\.|\bwindow\./, 'DOM access'],
];
const files = [];
function walk(d) {
  let entries = [];
  try { entries = readdirSync(d); } catch { return; }
  for (const e of entries) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
  }
}
PURE.forEach(walk);
let bad = 0;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const [re, why] of BANNED) if (re.test(line)) { console.error(`${f}:${i + 1}: ${why}: ${line.trim()}`); bad++; }
  });
}
// Platform lint: Safari-absent APIs only inside src/platform.
const ALL = [];
(function w(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) w(p); else if (/\.tsx?$/.test(p)) ALL.push(p); } })('src');
for (const f of ALL) {
  if (f.startsWith('src/platform')) continue;
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/requestIdleCallback|cancelIdleCallback|\bscheduler\.|navigator\.vibrate/.test(line) && !/^\s*\/\//.test(line)) { console.error(`${f}:${i + 1}: Safari-absent API outside platform/`); bad++; }
  });
}
if (bad) { console.error(`purity: ${bad} violation(s)`); process.exit(1); }
console.log(`purity: ok (${files.length} pure files)`);

// Dev harness for render work (render-harness.html): a generated world (synthetic fallback), a fake
// pod you can fly and dig with the keyboard, both looks, quality tiers and context-loss testing.
// Keys: arrows/WASD move & dig · L look · Q quality · B Bright Mines · E arming preview · K lose context
//       T cycle pod tiers
//       1–6 jump (Rim, r2, r40 B1 ores, r140 Hardrock, r270 Magma, r600 Heart) · H hide HUD · G auto-dig.
// URL: ?look=pixel&row=40&x=12&scope=v1&quality=mid&persp=1&arming=1&bright=1&seed=7&auto=1&hud=0&top=103
import { CHUNK, DIG_LAST_ROW, HEART_TOP_ROW, MINE_H, MINE_W, POD_H, RIM_BUILDINGS, SEAL_ROW, START_X } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import { Rng } from '../shared/rng';
import { F, T, mineralCode, relicCode, type Lode, type Look, type Scope } from '../shared/types';
import { generateWorld } from '../terrain/generate';
import { TerrainGrid } from '../terrain/grid';
import type { PodIntent, PodState } from '../pod/types';
import type { CargoGroup, PodStats, Quote, Result, ShopItem, StoryState, UpgradeCard, Wallet, WorldApi } from '../world/api';
import type { CameraMode, QualityTier, Renderer, ViewportLayout } from './api';
import { createRenderer } from './renderer';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const SEED = num('seed', 7);
const SCOPE = (params.get('scope') ?? __HF_SCOPE__) as Scope;

// ---------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------

function syntheticWorld(seed: number): TerrainGrid {
  const g = new TerrainGrid(seed);
  const rng = new Rng(seed, 99);
  for (let r = 0; r < MINE_H; r++) {
    for (let x = 0; x < MINE_W; x++) {
      let code: number = T.DIRT;
      if (r === 0) code = T.TURF;
      else if (r === SEAL_ROW) code = T.SEAL;
      else if (r >= HEART_TOP_ROW) code = rng.chance(0.25) ? T.AIR : T.HEARTSTONE;
      else {
        const o = r + 5;
        if (rng.chance(0.2)) {
          const spread = Math.floor(o / 65) + 2;
          const tier = Math.min(10, Math.max(1, Math.floor(o / 65) + 1 - rng.int(spread) + (rng.chance(0.2) ? 1 : 0)));
          code = r > 76 && rng.chance(0.03) ? relicCode(rng.int(4)) : mineralCode(Math.max(1, tier));
        } else if (r >= 129 && rng.chance(0.12)) code = r >= 262 && rng.chance(0.5) ? T.MAGMA : T.HARDROCK;
        else if (rng.chance(0.08)) code = T.AIR;
      }
      g.terrain[g.idx(x, r)] = code;
    }
  }
  for (const b of RIM_BUILDINGS) for (let x = b.x0; x <= b.x1; x++) g.terrain[g.idx(x, 0)] = T.PAVED;
  const survey = 23;
  for (let r = 0; r <= 45; r++) {
    g.terrain[g.idx(survey, r)] = T.AIR;
    g.flags[g.idx(survey, r)] |= F.SURVEY;
  }
  const lodes: Lode[] = [
    { id: 0, metal: 'copper', purity: 'normal', x0: 24, top: 46, scripted: true, scope: 'mvp', discovered: true },
    { id: 1, metal: 'hematite', purity: 'normal', x0: 8, top: 52, scripted: false, scope: 'mvp', discovered: false },
    { id: 2, metal: 'kerogen', purity: 'normal', x0: 30, top: 100, scripted: false, scope: 'v1', discovered: false },
  ];
  g.lodes = lodes;
  lodes.forEach((l, i) => {
    for (let r = l.top; r < l.top + 2; r++) for (let x = l.x0; x < l.x0 + 3; x++) {
      g.terrain[g.idx(x, r)] = T.LODE_ROCK;
      g.lodeIndex[g.idx(x, r)] = i + 1;
    }
  });
  return g;
}

function buildGrid(): TerrainGrid {
  if (params.get('synthetic') === '1') return syntheticWorld(SEED);
  try {
    return generateWorld(SEED).grid;
  } catch (err) {
    console.warn('render harness: generateWorld unavailable, using a synthetic grid', err);
    return syntheticWorld(SEED);
  }
}

/** Debug strip (canon §5.1): a few Hardrock and Magma cells next to a column, for the style test. */
function carveShaft(g: TerrainGrid, x: number, toRow: number): void {
  for (let r = 0; r <= Math.min(toRow, DIG_LAST_ROW); r++) {
    const code = g.get(x, r);
    if (code !== T.PAVED && code !== T.SEAL && code !== T.LODE_ROCK) {
      g.set(x, r, T.AIR);
      g.markDug(x, r);
    }
  }
  // Floor under the pod and a short side gallery for depth.
  if (toRow + 1 < MINE_H && g.get(x, toRow + 1) === T.AIR) g.set(x, toRow + 1, T.DIRT);
  for (let dx = 1; dx <= 3; dx++) if (x + dx < MINE_W && g.get(x + dx, toRow) !== T.LODE_ROCK) g.set(x + dx, toRow, T.AIR);
}

const ZERO_QUOTE: Quote = { amount: 0, cost: 0, limitedByCash: false };
const NO: Result = { ok: false, reason: 'harness' };

class FakeWorld implements WorldApi {
  readonly seed = SEED;
  readonly scope: Scope = SCOPE;
  readonly terrain: TerrainGrid;
  readonly pod: PodState;
  readonly wallet: Wallet = { cash: 20, debt: 0, lifetimeEarned: 0 };
  readonly story: StoryState = {
    deepestRow: 0, trips: 0, tripDeepestRow: 0, underground: false, incentivesPaid: [], flags: {}, coopCreditReadyStep: 0, destructions: 0,
  };
  stepNo = 0;
  readonly events: GameEvent[] = [];

  constructor(grid: TerrainGrid) {
    this.terrain = grid;
    this.pod = {
      x: START_X + 0.5, y: POD_H / 2, vx: 0, vy: 0, prevX: START_X + 0.5, prevY: POD_H / 2, grounded: true, facing: 1,
      fuel: 6, hull: 10, tiers: { drill: 1, hull: 1, engine: 1, tank: 1, radiator: 1, bay: 1, scanner: 1 },
      cargo: [], consumables: { jerrycan: 0, patchKit: 0, pop: 2, megaPop: 1, hopBeacon: 0, homingBeacon: 0 },
      quickSlots: ['pop', 'megaPop', 'jerrycan', 'patchKit'], dig: null, engageSteps: 0, engageDir: null, sector: 'none',
      cooldown: 0, magmaPending: 0, thrust: 0, digging: false, fuelWarn: -1, hullWarned: false, airSteps: 0, destroyed: false, row: -1,
    };
  }
  step(_intent: PodIntent, _podRunning: boolean): void {
    this.stepNo++;
  }
  drainEvents(): GameEvent[] {
    return this.events.splice(0, this.events.length);
  }
  stats(): PodStats {
    return { maxFuel: 10, maxHull: 10, engineHp: 150, hoverCap: 100, vUp: 7, digSteps: 29, radiator: 1, baySlots: 7, slotsUsed: 0, cargoMass: 0, scannerLodeRadius: 1 };
  }
  padUnderPod(): null {
    return null;
  }
  sheetClosed(): void {}
  isPadArmed(): boolean {
    return true;
  }
  fuelQuote(): Quote {
    return ZERO_QUOTE;
  }
  buyFuel(): Result {
    return NO;
  }
  cargoGroups(): CargoGroup[] {
    return [];
  }
  cargoValue(): number {
    return 0;
  }
  sellAll(): Result {
    return NO;
  }
  repairQuote(): Quote {
    return ZERO_QUOTE;
  }
  repairAll(): Result {
    return NO;
  }
  garageCards(): UpgradeCard[] {
    return [];
  }
  buyUpgrade(): Result {
    return NO;
  }
  shedItems(): ShopItem[] {
    return [];
  }
  buyConsumable(): Result {
    return NO;
  }
  setQuickSlot(): void {}
  discardCargo(): Result {
    return NO;
  }
  undoDiscard(): Result {
    return NO;
  }
  readonly discardsPending = 0;
  commitDiscards(): void {}
  returnFuel(): number {
    return 0;
  }
  onRim(): boolean {
    return this.pod.grounded && this.pod.y > 0;
  }
  respawn(): { fee: number; debt: number; lost: [] } {
    return { fee: 0, debt: 0, lost: [] };
  }
  serialize(): Uint8Array {
    return new Uint8Array();
  }
  debugTeleport(row: number): void {
    teleport(this, this.pod.x, row);
  }
  debugGiveCash(): void {}
  debugSetTier(): void {}
}

// ---------------------------------------------------------------------------------------------
// Fake pod: box collision, gravity, thrust, timed digging
// ---------------------------------------------------------------------------------------------

const DIG_S = 0.35;
const HALF_W = 0.43;
const HALF_H = POD_H / 2;
const keys = new Set<string>();
let autoDig = params.get('auto') === '1';
let digTimer = 0;

function solidAt(g: TerrainGrid, x: number, y: number): boolean {
  if (y >= 0) return false;
  return g.get(Math.floor(x), Math.floor(-y)) !== T.AIR;
}

function teleport(w: FakeWorld, x: number, row: number): void {
  const p = w.pod;
  if (row >= 0) carveShaft(w.terrain, Math.floor(x), row);
  p.x = p.prevX = Math.floor(x) + 0.5;
  p.y = p.prevY = row < 0 ? HALF_H : -(row + 1) + HALF_H;
  p.vx = p.vy = 0;
  p.dig = null;
  p.digging = false;
  w.events.push({ t: 'teleport', id: 'hopBeacon', x: p.x, y: p.y });
}

function stepPod(w: FakeWorld, dt: number): void {
  const p = w.pod;
  const g = w.terrain;
  p.prevX = p.x;
  p.prevY = p.y;
  const left = keys.has('ArrowLeft') || keys.has('a');
  const right = keys.has('ArrowRight') || keys.has('d');
  const up = keys.has('ArrowUp') || keys.has('w');
  const down = keys.has('ArrowDown') || keys.has('s') || (autoDig && -p.y < DIG_LAST_ROW - 2);
  const ix = (right ? 1 : 0) - (left ? 1 : 0);
  if (ix !== 0) p.facing = ix > 0 ? 1 : -1;

  if (p.dig) {
    digTimer += dt;
    p.digging = true;
    const target = p.dig;
    if (digTimer >= DIG_S) {
      const code = g.get(target.x, target.r);
      g.set(target.x, target.r, T.AIR);
      g.markDug(target.x, target.r);
      w.events.push({ t: 'dug', x: target.x, r: target.r, code });
      p.dig = null;
      p.digging = false;
    }
    p.vx = 0;
    p.vy = 0;
    return;
  }
  const cellX = Math.floor(p.x);
  const cellR = Math.floor(-(p.y - HALF_H) - 0.01);
  const startDig = (x: number, r: number, dir: 'down' | 'left' | 'right'): void => {
    const code = g.get(x, r);
    if (code === T.AIR || code === T.PAVED || code === T.SEAL || code === T.HEARTSTONE || code === T.LODE_ROCK || r >= MINE_H) return;
    p.dig = { x, r, dir, progress: 0, total: 20, cleared: false, fromX: p.x, fromY: p.y };
    digTimer = 0;
    w.events.push({ t: 'dig-start', x, r, code });
  };
  if (p.grounded && down) startDig(cellX, cellR + 1, 'down');
  else if (p.grounded && ix !== 0) {
    const nx = cellX + ix;
    if (nx >= 0 && nx < MINE_W && solidAt(g, nx + 0.5, p.y)) startDig(nx, Math.floor(-p.y), ix > 0 ? 'right' : 'left');
  }
  if (p.dig) return;

  p.thrust = up ? 1 : 0;
  p.vx = ix * 4.5;
  if (ix === 0 && p.grounded) p.x += (cellX + 0.5 - p.x) * Math.min(1, dt * 10);
  p.vy = up ? Math.min(7, p.vy + 20 * dt) : Math.max(-13.5, p.vy - 11.537 * dt);
  // Horizontal move with collision.
  const nx = p.x + p.vx * dt;
  const edge = nx + Math.sign(p.vx) * HALF_W;
  if (p.vx !== 0 && (solidAt(g, edge, p.y - HALF_H + 0.05) || solidAt(g, edge, p.y + HALF_H - 0.05) || edge < 0 || edge > MINE_W)) p.vx = 0;
  else p.x = nx;
  // Vertical move with collision.
  const ny = p.y + p.vy * dt;
  if (p.vy < 0) {
    const foot = ny - HALF_H;
    const blocked = solidAt(g, p.x - HALF_W + 0.05, foot) || solidAt(g, p.x + HALF_W - 0.05, foot);
    const onRim = p.y - HALF_H >= 0 && foot < 0 && g.get(Math.floor(p.x), 0) !== T.AIR;
    if (blocked || onRim) {
      if (!p.grounded && p.vy < -6) w.events.push({ t: 'landed', v: -p.vy });
      p.y = Math.ceil(foot) + HALF_H;
      p.vy = 0;
      p.grounded = true;
    } else {
      p.y = ny;
      p.grounded = false;
    }
  } else if (p.vy > 0) {
    const head = ny + HALF_H;
    if (solidAt(g, p.x, head)) p.vy = 0;
    else p.y = Math.min(ny, 30);
    p.grounded = false;
  }
  p.row = Math.floor(-p.y);
}

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

// Count shader program links so tests can assert the M0 look flip compiles nothing new.
let programLinks = 0;
const linkProgram = WebGL2RenderingContext.prototype.linkProgram;
WebGL2RenderingContext.prototype.linkProgram = function (this: WebGL2RenderingContext, program: WebGLProgram): void {
  programLinks++;
  linkProgram.call(this, program);
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
if (params.get('hud') === '0') hud.classList.add('hidden');

function layoutNow(): ViewportLayout {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const top = num('top', height >= 800 ? 59 + 44 : 20 + 44);
  return { width, height, dpr: window.devicePixelRatio || 1, clearTop: top, controlZone: num('cz', height >= 800 ? 200 : 150) };
}

const world = new FakeWorld(buildGrid());
let look: Look = params.get('look') === 'pixel' ? 'pixel' : 'toon';
const tiers: QualityTier[] = ['low', 'mid', 'high'];
let quality: QualityTier = (params.get('quality') as QualityTier | null) ?? 'mid';
let bright = params.get('bright') === '1';
let arming = params.get('arming') === '1';
const mode: CameraMode = params.get('mode') === 'build' ? 'build' : 'play';
const renderer: Renderer = createRenderer(canvas, layoutNow(), {
  look, quality, precompileBoth: params.get('precompile') !== '0', perspective: params.get('persp') === '1',
});
if (params.has('row')) teleport(world, num('x', START_X), num('row', 0));
else if (params.has('x')) teleport(world, num('x', START_X), -1);

const JUMPS: Record<string, number> = { '1': -1, '2': 2, '3': 40, '4': 140, '5': 270, '6': 600 };
window.addEventListener('keydown', (e) => {
  keys.add(e.key);
  const k = e.key.toLowerCase();
  if (k === 'l') setLook(look === 'toon' ? 'pixel' : 'toon');
  else if (k === 'q') {
    quality = tiers[(tiers.indexOf(quality) + 1) % tiers.length];
    renderer.setQuality(quality);
  } else if (k === 'b') bright = !bright;
  else if (k === 'e') arming = !arming;
  else if (k === 'g') autoDig = !autoDig;
  else if (k === 'h') hud.classList.toggle('hidden');
  else if (k === 'k') loseContext();
  else if (k === 't') {
    const t = world.pod.tiers;
    for (const line of Object.keys(t) as (keyof typeof t)[]) t[line] = (t[line] % 7) + 1;
  }
  else if (e.key in JUMPS) teleport(world, world.pod.x, JUMPS[e.key]);
});
window.addEventListener('keyup', (e) => keys.delete(e.key));
window.addEventListener('resize', () => renderer.resize(layoutNow()));

function setLook(l: Look): void {
  look = l;
  renderer.setLook(l);
}

function loseContext(): void {
  const gl = canvas.getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_lose_context');
  if (!ext) return;
  ext.loseContext();
  window.setTimeout(() => ext.restoreContext(), 800);
}

const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
let frames = 0;
let fpsT = last;
let fps = 0;
let armT = 0;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= STEP) {
    stepPod(world, STEP);
    world.step({ sx: 0, sy: 0, thrust: false, fireSlot: -1 }, true);
    acc -= STEP;
  }
  armT = arming ? (armT + dt * 4) % 1.25 : 0;
  renderer.render({
    world,
    alpha: acc / STEP,
    timeMs: now,
    mode,
    events: world.drainEvents(),
    layout: layoutNow(),
    touching: false,
    arming: arming ? { radius: 1, progress: Math.min(1, armT) } : null,
    brightMines: bright,
    reducedMotion: false,
  });
  frames++;
  if (now - fpsT > 500) {
    fps = (frames * 1000) / (now - fpsT);
    frames = 0;
    fpsT = now;
  }
  const i = renderer.info;
  hud.textContent =
    `${i.look} k=${i.pixelScale} ${i.quality} ${fps.toFixed(0)} fps\n` +
    `draws ${i.drawCalls} tris ${(i.triangles / 1000).toFixed(1)}k\n` +
    `row ${Math.floor(-world.pod.y)} x ${world.pod.x.toFixed(1)} chunk ${Math.floor(Math.max(0, -world.pod.y) / CHUNK)}` +
    (renderer.contextLost ? '\nCONTEXT LOST' : '');
  requestAnimationFrame(frame);
}

declare global {
  interface Window {
    __hfRender?: {
      ready: boolean;
      setLook(l: Look): void;
      teleport(x: number, row: number): void;
      info(): unknown;
      setArming(on: boolean): void;
      loseContext(): void;
      contextLost(): boolean;
      screenToCell(px: number, py: number): unknown;
      screenToRimBuilding(px: number, py: number): unknown;
      worldToScreen(x: number, y: number, z?: number): unknown;
      programLinks(): number;
      setTiers(tier: number): void;
    };
  }
}

window.__hfRender = {
  ready: false,
  setLook,
  teleport: (x, row) => teleport(world, x, row),
  info: () => ({ ...renderer.info }),
  setArming: (on) => {
    arming = on;
  },
  loseContext,
  contextLost: () => renderer.contextLost,
  screenToCell: (px, py) => renderer.screenToCell(px, py),
  screenToRimBuilding: (px, py) => renderer.screenToRimBuilding(px, py),
  worldToScreen: (x, y, z) => renderer.worldToScreen(x, y, z),
  programLinks: () => programLinks,
  setTiers: (tier) => {
    const t = world.pod.tiers;
    for (const line of Object.keys(t) as (keyof typeof t)[]) t[line] = tier;
  },
};
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  window.setTimeout(() => {
    if (window.__hfRender) window.__hfRender.ready = true;
  }, 600);
});

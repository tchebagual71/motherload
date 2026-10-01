// UI dev harness (ui-harness.html): mounts the real UI + input over a toy 2D canvas world driven by
// FakeWorld / createFakeApp, so HUD, controls, sheets and overlays can be checked without the game.
// URL: ?look=pixel&size=S|M|L&left=1&thrust=1&perf=1&styletest=0&reduced=1&scope=m0|mvp|v1
//      &overlay=title|interrupt|countdown|upright|death|safemode&sheet=pump|assay|garage|shed|menu|settings|saves|debug|cargo
//      &preset=start|rich|broke|heavy|lowfuel|deep|debt&insets=59,34&install=1&trips=0&interrupts=1
import { createInput } from '../input';
import { STRATA } from '../render/palette';
import { CONSUMABLES, MINE_H, MINE_W, POD_H, POD_W, TOUCH, type ConsumableId } from '../shared/canon';
import type { Overlay, SheetId } from '../app/types';
import type { Look, Scope } from '../shared/types';
import { createFakeApp, type FakePreset } from './fakes';
import { mountUI } from './index';

const q = new URLSearchParams(location.search);
const flag = (k: string, d = false): boolean => (q.has(k) ? q.get(k) === '1' : d);
const insets = (q.get('insets') ?? '').split(',').map(Number);
const insetTop = insets[0] || 0;
const insetBottom = insets[1] || 0;
if (q.has('insets')) {
  const s = document.documentElement.style;
  s.setProperty('--hf-force-inset-top', `${insetTop}px`);
  s.setProperty('--hf-force-inset-bottom', `${insetBottom}px`);
}

const app = createFakeApp({
  scope: (q.get('scope') as Scope | null) ?? __HF_SCOPE__,
  look: (q.get('look') as Look | null) ?? 'toon',
  overlay: (q.get('overlay') as Overlay | null) ?? null,
  sheet: (q.get('sheet') as SheetId | null) ?? null,
  styleTest: flag('styletest', true),
  canInstall: flag('install'),
  standalone: !flag('install'),
  settings: {
    ...(q.has('size') ? { controlSize: q.get('size') as 'S' | 'M' | 'L' } : {}),
    leftHanded: flag('left'),
    thrustButton: flag('thrust'),
    showPerf: flag('perf'),
    reducedMotion: flag('reduced'),
  },
});
const world = app.world;
world.applyPreset((q.get('preset') as FakePreset | null) ?? 'start');
if (q.has('trips')) world.story.trips = Number(q.get('trips'));
if (app.state.overlay.peek() === 'death') app.state.death.value = { cause: 'hull', fee: 300, debt: 120, lostCount: 12, lostValue: 3_400 };
if (app.state.overlay.peek() === 'countdown') app.state.countdownMs.value = 1500;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const low = document.createElement('canvas');
const lowCtx = low.getContext('2d') as CanvasRenderingContext2D;

const layout = () => {
  const size = app.state.settings.peek().controlSize;
  return { width: innerWidth, height: innerHeight, controlZone: TOUCH.controlZone[size] + insetBottom, clearTop: insetTop + TOUCH.hudRow };
};

mountUI(uiRoot, app);
const input = createInput({
  canvas,
  uiRoot,
  app,
  getLayout: layout,
  onWorldTap: (x, y) => app.toast(`World tap at ${Math.round(x)}, ${Math.round(y)}`),
  onInterrupt: () => {
    app.state.overlay.value = 'interrupt';
  },
});

// ------------------------------------------------------------------ platform interrupts (canon §4.5)
let uprightByRotation = false;
function checkOrientation(): void {
  const landscape = innerWidth > innerHeight && Math.min(innerWidth, innerHeight) < 600;
  const o = app.state.overlay.peek();
  if (landscape && o !== 'upright' && o !== 'title') {
    input.releaseAll();
    uprightByRotation = true;
    app.state.overlay.value = 'upright';
  } else if (!landscape && o === 'upright' && uprightByRotation) {
    uprightByRotation = false;
    app.state.overlay.value = 'interrupt';
  }
}
addEventListener('resize', checkOrientation);
checkOrientation();
if (flag('interrupts')) {
  addEventListener('blur', () => {
    if (app.state.overlay.peek() === null) app.state.overlay.value = 'interrupt';
  });
}

// ------------------------------------------------------------------ toy world drawing
const dug = new Uint8Array(MINE_W * MINE_H);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const BAND = STRATA.map((s) => ({ bottom: s.bottom, front: hex(s.front), accent: hex(s.accent) }));
const bandAt = (r: number) => BAND.find((b) => r <= b.bottom) ?? BAND[BAND.length - 1];
const hash = (x: number, r: number) => (((x * 73856093) ^ (r * 19349663)) >>> 0) % 97;

function drawWorld(c: CanvasRenderingContext2D, w: number, h: number, scale: number): void {
  const pod = world.pod;
  const ppu = (h < 700 ? 38 : 41) * scale;
  const clearTop = (insetTop + TOUCH.hudRow) * scale;
  const anchorY = clearTop + 0.35 * (h - clearTop);
  const half = w / 2 / ppu;
  const camX = Math.max(half - 1, Math.min(MINE_W + 1 - half, pod.x));
  const sx = (x: number) => w / 2 + (x - camX) * ppu;
  const sy = (y: number) => anchorY - (y - pod.y) * ppu;

  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#f2b58e');
  sky.addColorStop(1, '#fadcc0');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  const r0 = Math.max(0, Math.floor(-pod.y - anchorY / ppu) - 1);
  const r1 = Math.min(MINE_H - 1, Math.ceil(-pod.y + (h - anchorY) / ppu) + 1);
  for (let r = r0; r <= r1; r++) {
    const band = bandAt(r);
    for (let x = 0; x < MINE_W; x++) {
      const px = sx(x);
      if (px > w || px + ppu < 0) continue;
      const py = sy(-r);
      if (dug[r * MINE_W + x]) {
        c.fillStyle = 'rgba(30,18,28,0.85)';
        c.fillRect(px, py, ppu + 0.5, ppu + 0.5);
        continue;
      }
      c.fillStyle = band.front;
      c.fillRect(px, py, ppu + 0.5, ppu + 0.5);
      const k = hash(x, r);
      if (k < 9) {
        c.fillStyle = band.accent;
        c.fillRect(px + ppu * 0.3, py + ppu * 0.3, ppu * 0.4, ppu * 0.4);
      }
    }
  }
  c.fillStyle = '#5e4a52';
  c.fillRect(0, sy(0) - 3 * scale, w, 3 * scale);

  const podW = POD_W * ppu;
  const podH = POD_H * ppu;
  const px = sx(pod.x) - podW / 2;
  const py = sy(pod.y) - podH / 2;
  c.fillStyle = '#f4f1ea';
  c.strokeStyle = '#2b1e2f';
  c.lineWidth = 2 * scale;
  c.beginPath();
  c.roundRect(px, py, podW, podH, 8 * scale);
  c.fill();
  c.stroke();
  c.fillStyle = '#46e0d2';
  c.fillRect(px + podW * 0.55, py + podH * 0.2, podW * 0.3, podH * 0.3);
  if (pod.thrust > 0) {
    c.fillStyle = '#ffd36b';
    c.fillRect(px + podW * 0.3, py + podH, podW * 0.4, podH * 0.5 * pod.thrust);
  }

  const arming = app.state.arming.peek();
  if (arming) {
    const id = pod.quickSlots[arming.slot];
    const rad = id === 'megaPop' ? 2 : id === 'pop' ? 1 : 0;
    const cx = Math.floor(pod.x);
    const cr = pod.row;
    c.strokeStyle = '#ffb238';
    c.lineWidth = 3 * scale;
    c.strokeRect(sx(cx - rad), sy(-(cr - rad)), (2 * rad + 1) * ppu, (2 * rad + 1) * ppu);
    c.beginPath();
    c.arc(sx(pod.x), sy(pod.y), ppu * 0.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * arming.progress);
    c.stroke();
  }
}

function resizeCanvas(): void {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  low.width = Math.ceil(innerWidth / 3);
  low.height = Math.ceil(innerHeight / 3);
}
addEventListener('resize', resizeCanvas);
resizeCanvas();

function render(): void {
  if (app.state.look.peek() === 'pixel') {
    drawWorld(lowCtx, low.width, low.height, 1 / 3);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(low, 0, 0, canvas.width, canvas.height);
  } else {
    drawWorld(ctx, canvas.width, canvas.height, canvas.width / innerWidth);
  }
}

// ------------------------------------------------------------------ loop (04 §3.2 shape)
const STEP_MS = 1000 / 60;
let last = performance.now();
let acc = 0;
let fpsEma = 60;
let perfAcc = 0;
const nameOf = (id: ConsumableId) => CONSUMABLES.find((c) => c.id === id)?.name ?? id;

function frame(t: number): void {
  const dt = Math.min(250, t - last);
  last = t;
  app.tick(dt);
  const intent = input.sampleIntent();
  if (intent.fireSlot >= 0) app.toast(`${nameOf(world.pod.quickSlots[intent.fireSlot])} fired`, 'good');
  const running = app.state.overlay.peek() === null && app.state.sheet.peek() === null;
  acc += dt;
  let n = 0;
  while (acc >= STEP_MS && n < 5) {
    world.step(intent, running);
    intent.fireSlot = -1; // edge: only the first step of the frame fires
    acc -= STEP_MS;
    n++;
  }
  if (n === 5) acc = Math.min(acc, STEP_MS);
  const p = world.pod;
  if (p.row >= 0 && p.row < MINE_H) dug[p.row * MINE_W + Math.max(0, Math.min(MINE_W - 1, Math.floor(p.x)))] = 1;
  render();
  fpsEma = fpsEma * 0.95 + (dt > 0 ? 1000 / dt : 60) * 0.05;
  perfAcc += dt;
  if (perfAcc > 500 && app.state.settings.peek().showPerf) {
    perfAcc = 0;
    app.state.perf.value = { fps: fpsEma, frameMs: 1000 / fpsEma, drawCalls: 12, tris: 4200 };
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

Object.assign(window, { __hfHarness: { app, world, input } });

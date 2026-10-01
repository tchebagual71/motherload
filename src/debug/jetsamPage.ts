// Jetsam probe page (04 §10.4; jetsam.html): allocate 10-MB steps of ArrayBuffers (touching every page) or
// WebGL textures until iOS kills the tab, logging each total to localStorage first so the reopened page shows
// the kill point. A separate entry so the game never loads it.
import { lsKey } from '../platform/channel';
import { local, writeJson, type KeyValue } from '../platform/storage';
import { emptyState, JETSAM_KEY, loadState, median, RUNS_PER_MODE, BUDGET_FRACTION, settleKilledRun, STEP_MB, type JetsamMode, type JetsamState } from './jetsam';

const MAX_MB = 4_096;
const STEP_DELAY_MS = 40;
const PAGE = 4_096;

// ---------------------------------------------------------------- allocation (browser only)

type Allocator = () => boolean;

function arrayBufferAllocator(): Allocator {
  const keep: Uint8Array[] = [];
  return () => {
    try {
      const a = new Uint8Array(STEP_MB * 1024 * 1024);
      for (let i = 0; i < a.length; i += PAGE) a[i] = 1; // touch every page so it is resident
      keep.push(a);
      return true;
    } catch {
      return false;
    }
  };
}

function webglAllocator(): Allocator {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext('webgl2');
  if (!gl) return () => false;
  // 10 MB = 1280 × 2048 RGBA8; the same zero buffer is uploaded each time so the driver commits the memory.
  const w = 1280;
  const h = 2048;
  const zeros = new Uint8Array(w * h * 4);
  const keep: WebGLTexture[] = [];
  return () => {
    const tex = gl.createTexture();
    if (!tex) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, zeros);
    gl.flush();
    if (gl.getError() === gl.OUT_OF_MEMORY || gl.isContextLost()) return false;
    keep.push(tex);
    return true;
  };
}

export function runProbe(mode: JetsamMode, onStep: (mb: number) => void, onDone: (limitMb: number) => void, kv: KeyValue = local): void {
  const key = lsKey(JETSAM_KEY);
  const alloc = mode === 'webgl' ? webglAllocator() : arrayBufferAllocator();
  let total = 0;
  const step = (): void => {
    const next = total + STEP_MB;
    const s = loadState(kv, key);
    writeJson(kv, key, { ...s, active: { mode, mb: next } });
    if (next > MAX_MB || !alloc()) {
      const done = loadState(kv, key);
      writeJson(kv, key, { ...done, active: null, limits: { ...done.limits, [mode]: [...done.limits[mode], total] } });
      onDone(total);
      return;
    }
    total = next;
    onStep(total);
    setTimeout(step, STEP_DELAY_MS);
  };
  step();
}

// ---------------------------------------------------------------- page UI

function render(root: HTMLElement, s: JetsamState, status: string): void {
  const row = (mode: JetsamMode, label: string): string => {
    const med = median(s.runs[mode]);
    const runs = s.runs[mode].map((v) => `${v} MB`).join(', ') || '—';
    const limits = s.limits[mode].length ? ` · survived to ${s.limits[mode].join(', ')} MB` : '';
    const budget = med === null ? '' : ` · budget ${Math.round(med * BUDGET_FRACTION)} MB`;
    return `<li><b>${label}</b>: ${runs}${limits}<br><small>median ${med ?? '—'} MB${budget} (${s.runs[mode].length}/${RUNS_PER_MODE} runs)</small></li>`;
  };
  root.querySelector('#results')!.innerHTML = row('arraybuffer', 'ArrayBuffer') + row('webgl', 'WebGL textures');
  root.querySelector('#status')!.textContent = status;
}

export function mountJetsamPage(root: HTMLElement): void {
  let state = settleKilledRun(loadState());
  writeJson(local, lsKey(JETSAM_KEY), state);
  render(root, state, state.runs.arraybuffer.length + state.runs.webgl.length ? 'Ready. Previous kill points are listed.' : 'Ready.');
  const buttons = root.querySelectorAll<HTMLButtonElement>('button[data-mode]');
  const setBusy = (busy: boolean): void => buttons.forEach((b) => (b.disabled = busy));
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      const mode = b.dataset.mode as JetsamMode;
      setBusy(true);
      runProbe(
        mode,
        (mb) => ((root.querySelector('#status') as HTMLElement).textContent = `${mode}: ${mb} MB allocated…`),
        (limit) => {
          state = loadState();
          render(root, state, `${mode}: allocation stopped at ${limit} MB without a kill.`);
          setBusy(false);
        },
      );
    }),
  );
  root.querySelector('#reset')?.addEventListener('click', () => {
    state = emptyState();
    writeJson(local, lsKey(JETSAM_KEY), state);
    render(root, state, 'Cleared.');
  });
}

const root = document.getElementById('jetsam');
if (root) mountJetsamPage(root);

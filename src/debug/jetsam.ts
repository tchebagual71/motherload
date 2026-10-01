// Jetsam probe bookkeeping (04 §10.4), shared by the probe page (jetsamPage.ts → jetsam.html) and the Perf Report.
// The page allocates 10-MB steps until iOS kills the tab, logging each total BEFORE allocating, so the reopened
// page knows the kill point. 3 runs per mode; the median goes into the Perf Report; the low-tier memory budget
// is 60% of it (canon §3.14).
import { lsKey } from '../platform/channel';
import { local, readJson, type KeyValue } from '../platform/storage';
import type { JetsamSummary } from './perfReport';

export type JetsamMode = 'arraybuffer' | 'webgl';

export interface JetsamState {
  runs: Record<JetsamMode, number[]>;
  /** Survived without a kill: the allocation itself failed at this many MB. */
  limits: Record<JetsamMode, number[]>;
  active: { mode: JetsamMode; mb: number } | null;
}

export const JETSAM_KEY = 'jetsam';
export const STEP_MB = 10;
export const RUNS_PER_MODE = 3;
export const BUDGET_FRACTION = 0.6;

export function emptyState(): JetsamState {
  return { runs: { arraybuffer: [], webgl: [] }, limits: { arraybuffer: [], webgl: [] }, active: null };
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function loadState(kv: KeyValue = local, key: string = lsKey(JETSAM_KEY)): JetsamState {
  const raw = readJson<JetsamState>(kv, key);
  if (!raw || !raw.runs || !raw.limits) return emptyState();
  return raw;
}

/** A run that was still active when the page loaded was killed at its last logged total. */
export function settleKilledRun(s: JetsamState): JetsamState {
  if (!s.active) return s;
  const { mode, mb } = s.active;
  return { ...s, runs: { ...s.runs, [mode]: [...s.runs[mode], mb] }, active: null };
}

export function summarize(s: JetsamState): JetsamSummary {
  return { arraybufferMB: median(s.runs.arraybuffer), webglMB: median(s.runs.webgl) };
}

/** For the Perf Report: null until at least one kill point is known. */
export function readJetsamSummary(kv: KeyValue = local, key: string = lsKey(JETSAM_KEY)): JetsamSummary | null {
  const s = summarize(loadState(kv, key));
  return s.arraybufferMB === null && s.webglMB === null ? null : s;
}

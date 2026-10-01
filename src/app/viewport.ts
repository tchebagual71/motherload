// Live ViewportLayout for render and input (03 §1.1): canvas size, device pixel ratio, safe-area insets from a
// probe, and the visual viewport so a floating Safari toolbar never covers the controls. Re-read on every
// resize, orientation change and visual-viewport change.
import type { ViewportLayout } from '../render/api';
import { createSafeAreaProbe } from '../platform/safeArea';
import { computeLayout, sameLayout, type ControlSize } from './layout';

export interface ViewportTracker {
  readonly layout: ViewportLayout;
  setControlSize(size: ControlSize): void;
  recompute(): void;
  dispose(): void;
}

export interface ViewportTrackerOptions {
  canvas: HTMLCanvasElement;
  controlSize: ControlSize;
  /** ?dpr= test override. */
  dprOverride: number | null;
  onChange(next: ViewportLayout, prev: ViewportLayout): void;
}

export function parseDprOverride(v: string | null): number | null {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 && n <= 4 ? n : null;
}

export function createViewportTracker(opts: ViewportTrackerOptions): ViewportTracker {
  const probe = createSafeAreaProbe(document.body);
  let size = opts.controlSize;

  const measure = (): ViewportLayout => {
    const vv = window.visualViewport;
    const width = opts.canvas.clientWidth || window.innerWidth;
    const height = opts.canvas.clientHeight || window.innerHeight;
    return computeLayout({
      width,
      height,
      dpr: opts.dprOverride ?? window.devicePixelRatio ?? 1,
      insets: probe.read(),
      controlSize: size,
      visualBottom: vv ? vv.height + vv.offsetTop : undefined,
    });
  };

  let layout = measure();
  const recompute = (): void => {
    const next = measure();
    if (sameLayout(next, layout)) return;
    const prev = layout;
    layout = next;
    opts.onChange(next, prev);
  };

  const vv = window.visualViewport;
  window.addEventListener('resize', recompute);
  window.addEventListener('orientationchange', recompute);
  vv?.addEventListener('resize', recompute);
  vv?.addEventListener('scroll', recompute);

  return {
    get layout() {
      return layout;
    },
    setControlSize(s) {
      size = s;
      recompute();
    },
    recompute,
    dispose() {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('orientationchange', recompute);
      vv?.removeEventListener('resize', recompute);
      vv?.removeEventListener('scroll', recompute);
      probe.dispose();
    },
  };
}

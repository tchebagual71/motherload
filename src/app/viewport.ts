// Live ViewportLayout for render and input (03 §1.1): canvas size, device pixel ratio, safe-area insets from a
// probe, and the visual viewport so a floating Safari toolbar never covers the controls. Re-read on every
// resize, orientation change, visual-viewport change and devicePixelRatio change (zoom, display switch).
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
  const dpr = opts.dprOverride === null ? watchDevicePixelRatio(recompute) : null;

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
      dpr?.dispose();
      probe.dispose();
    },
  };
}

/**
 * A DPR change alone fires no resize: a `(resolution: Ndppx)` query matching the current ratio fires `change`
 * once it stops matching, so it is re-armed for the new ratio each time.
 */
export function watchDevicePixelRatio(onChange: () => void): { dispose(): void } {
  if (typeof matchMedia === 'undefined') return { dispose() {} };
  let mq: MediaQueryList | null = null;
  const arm = (): void => {
    mq?.removeEventListener('change', fire);
    mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', fire);
  };
  const fire = (): void => {
    arm();
    onChange();
  };
  arm();
  return {
    dispose() {
      mq?.removeEventListener('change', fire);
      mq = null;
    },
  };
}

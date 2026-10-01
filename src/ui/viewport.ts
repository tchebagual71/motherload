// Viewport + safe-area insets as a signal (03 §1.1: insets are never hard-coded and are re-read on every
// resize). Insets come from a hidden probe positioned by env(safe-area-inset-*) (or the harness's
// --hf-force-inset-* overrides); the usable height follows visualViewport so a floating Safari toolbar
// never covers controls.
import { signal, type Signal } from '@preact/signals';

export interface Viewport {
  w: number;
  h: number;
  /** Safe-area insets (pt). */
  it: number;
  ib: number;
  il: number;
  ir: number;
}

export interface ViewportHandle {
  vp: Signal<Viewport>;
  dispose(): void;
}

function same(a: Viewport, b: Viewport): boolean {
  return a.w === b.w && a.h === b.h && a.it === b.it && a.ib === b.ib && a.il === b.il && a.ir === b.ir;
}

export function createViewport(root: HTMLElement): ViewportHandle {
  const probe = document.createElement('div');
  probe.className = 'hf-inset-probe';
  probe.setAttribute('aria-hidden', 'true');
  root.appendChild(probe);
  const vp = signal<Viewport>({ w: 0, h: 0, it: 0, ib: 0, il: 0, ir: 0 });

  const measure = (): void => {
    const vv = window.visualViewport;
    const w = Math.round(vv ? vv.width : window.innerWidth);
    const h = Math.round(vv ? vv.height + vv.offsetTop : window.innerHeight);
    const cs = getComputedStyle(probe);
    const px = (v: string): number => Math.max(0, Math.round(parseFloat(v) || 0));
    const next: Viewport = { w, h, it: px(cs.paddingTop), ib: px(cs.paddingBottom), il: px(cs.paddingLeft), ir: px(cs.paddingRight) };
    root.style.setProperty('--hf-vh', `${h}px`);
    if (!same(vp.peek(), next)) vp.value = next;
  };

  measure();
  const vv = window.visualViewport;
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', measure);
  vv?.addEventListener('resize', measure);
  vv?.addEventListener('scroll', measure);
  return {
    vp,
    dispose(): void {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
      probe.remove();
    },
  };
}

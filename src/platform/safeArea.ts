// Safe-area insets from a hidden probe padded by env(safe-area-inset-*) (03 §1.1: insets are never hard-coded
// and are re-read on every resize). `--hf-force-inset-*` on an ancestor overrides env() for tests and harnesses,
// matching the UI's probe so both layers agree.

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_INSETS: Readonly<Insets> = { top: 0, right: 0, bottom: 0, left: 0 };

export interface SafeAreaProbe {
  read(): Insets;
  dispose(): void;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export function createSafeAreaProbe(parent: HTMLElement = document.body): SafeAreaProbe {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    SIDES.map((s) => `padding-${s}:var(--hf-force-inset-${s},env(safe-area-inset-${s},0px));`).join('');
  parent.appendChild(el);
  const px = (v: string): number => Math.max(0, Math.round(parseFloat(v) || 0));
  return {
    read(): Insets {
      const cs = getComputedStyle(el);
      return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
    },
    dispose(): void {
      el.remove();
    },
  };
}

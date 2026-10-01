// Viewport layout math (canon §3.12; 03 §1.1). Pure: the DOM readings come from app/viewport.ts.
import type { ViewportLayout } from '../render/api';
import { TOUCH } from '../shared/canon';
import type { Insets } from '../platform/safeArea';
import type { Settings } from './types';

export type ControlSize = Settings['controlSize'];

/** Above this the visual-viewport shortfall is a software keyboard, not a floating toolbar. */
export const MAX_TOOLBAR_OVERLAP = 120;

export interface LayoutInput {
  /** Canvas (layout viewport) size in CSS px. */
  width: number;
  height: number;
  dpr: number;
  insets: Insets;
  controlSize: ControlSize;
  /**
   * Bottom of the visual viewport (visualViewport.height + offsetTop) in CSS px, if known. A Safari floating
   * toolbar covers the canvas below it, so the control zone grows to stay clear (03 §1.1: never 100dvh).
   */
  visualBottom?: number;
}

/** How much of the canvas bottom a floating browser toolbar covers (0 for keyboards and standalone). */
export function toolbarOverlap(height: number, visualBottom: number | undefined): number {
  if (visualBottom === undefined) return 0;
  const over = Math.round(height - visualBottom);
  return over > 0 && over <= MAX_TOOLBAR_OVERLAP ? over : 0;
}

/**
 * Clear rect starts under the top inset + 44-pt HUD row; the control zone is 150/166/182 pt plus the bottom
 * inset (or the floating-toolbar overlap when that is larger).
 */
export function computeLayout(i: LayoutInput): ViewportLayout {
  const bottom = Math.max(i.insets.bottom, toolbarOverlap(i.height, i.visualBottom));
  return {
    width: Math.max(1, Math.round(i.width)),
    height: Math.max(1, Math.round(i.height)),
    dpr: i.dpr > 0 ? i.dpr : 1,
    clearTop: i.insets.top + TOUCH.hudRow,
    controlZone: TOUCH.controlZone[i.controlSize] + bottom,
  };
}

export function sameLayout(a: ViewportLayout, b: ViewportLayout): boolean {
  return a.width === b.width && a.height === b.height && a.dpr === b.dpr && a.clearTop === b.clearTop && a.controlZone === b.controlZone;
}

/** Portrait ↔ landscape flip between two layouts (an `interrupt` source, canon §4.5). */
export function orientationFlipped(a: ViewportLayout, b: ViewportLayout): boolean {
  return a.width > a.height !== b.width > b.height;
}

/** 03 §12: control size M, except S on 667-pt phones (iPhone SE class). */
export function defaultControlSize(screenWidth: number, screenHeight: number): ControlSize {
  return Math.max(screenWidth, screenHeight) <= 667 ? 'S' : 'M';
}

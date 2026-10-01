// Scroll containment rule (canon §3.12 Input; 03 §1.1; 04 §6.3): document touchmove is blocked unless it
// happens inside a [data-scroll] container that can still scroll in the gesture's direction, so the page
// never rubber-bands and Safari never pans the viewport. Pure decision function; DOM wiring in gestures.ts.

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/** Sub-pixel slack: iOS reports fractional scroll positions at the ends. */
const EPS = 1;

/**
 * Can this container scroll for a finger that moved (dx, dy) since touchstart (screen space, y down)?
 * The dominant axis decides; a finger moving down scrolls content towards its top.
 */
export function canScrollFor(m: ScrollMetrics, dx: number, dy: number): boolean {
  const vertical = Math.abs(dy) >= Math.abs(dx);
  if (vertical) {
    const maxTop = m.scrollHeight - m.clientHeight;
    if (maxTop <= EPS) return false;
    if (dy > 0) return m.scrollTop > EPS;
    if (dy < 0) return m.scrollTop < maxTop - EPS;
    return true;
  }
  const maxLeft = m.scrollWidth - m.clientWidth;
  if (maxLeft <= EPS) return false;
  if (dx > 0) return m.scrollLeft > EPS;
  return m.scrollLeft < maxLeft - EPS;
}

/** Should the document-level touchmove guard call preventDefault? `chain` = [data-scroll] ancestors, nearest first. */
export function shouldBlockTouchMove(chain: readonly ScrollMetrics[], dx: number, dy: number, touches: number): boolean {
  if (touches > 1) return true; // no page pinch-zoom, ever
  for (const m of chain) if (canScrollFor(m, dx, dy)) return false;
  return true;
}

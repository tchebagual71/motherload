// Browser gesture suppression (04 §6.3): no page pan, rubber-band, pinch-zoom, double-tap zoom or
// callouts, while [data-scroll] sheet bodies still scroll natively.
import { shouldBlockTouchMove, type ScrollMetrics } from './scrollGuard';

const SCROLL_SELECTOR = '[data-scroll]';

function isTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || (t instanceof HTMLElement && t.isContentEditable);
}

function scrollChain(target: EventTarget | null): ScrollMetrics[] {
  const chain: ScrollMetrics[] = [];
  let el = target instanceof Element ? target.closest(SCROLL_SELECTOR) : null;
  while (el) {
    chain.push(el as HTMLElement);
    el = el.parentElement ? el.parentElement.closest(SCROLL_SELECTOR) : null;
  }
  return chain;
}

/** Installs the guards; returns a disposer. */
export function installGestureGuards(canvas: HTMLElement): () => void {
  canvas.style.touchAction = 'none';
  let startX = 0;
  let startY = 0;

  const onCanvasTouchMove = (e: TouchEvent): void => {
    if (e.cancelable) e.preventDefault();
  };
  const onTouchStart = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (t) {
      startX = t.clientX;
      startY = t.clientY;
    }
  };
  const onTouchMove = (e: TouchEvent): void => {
    // The canvas handler already blocked stick drags; skip the chain walk on that hot path.
    if (!e.cancelable || e.defaultPrevented || isTextField(e.target)) return;
    const t = e.touches[0];
    const dx = t ? t.clientX - startX : 0;
    const dy = t ? t.clientY - startY : 0;
    if (shouldBlockTouchMove(scrollChain(e.target), dx, dy, e.touches.length)) e.preventDefault();
  };
  const prevent = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
  };
  const onContextMenu = (e: Event): void => {
    if (!isTextField(e.target)) prevent(e);
  };

  const active: AddEventListenerOptions = { passive: false };
  canvas.addEventListener('touchmove', onCanvasTouchMove, active);
  canvas.addEventListener('gesturestart', prevent, active);
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, active);
  document.addEventListener('gesturestart', prevent, active);
  document.addEventListener('gesturechange', prevent, active);
  document.addEventListener('contextmenu', onContextMenu);

  return () => {
    canvas.removeEventListener('touchmove', onCanvasTouchMove);
    canvas.removeEventListener('gesturestart', prevent);
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('gesturestart', prevent);
    document.removeEventListener('gesturechange', prevent);
    document.removeEventListener('contextmenu', onContextMenu);
  };
}

// Page lifecycle hooks (04 §4.12 critical saves, canon §4.5 interrupt sources). Listeners are registered once;
// the returned function removes them.

export interface LifecycleHandlers {
  /** visibilitychange → hidden. Runs synchronously in the event task (critical save path). */
  hidden?(): void;
  /** visibilitychange → visible. */
  visible?(): void;
  /** pagehide (bfcache or unload). Also synchronous. */
  pagehide?(): void;
  /** window blur (Control Center, call banner, devtools…). */
  blur?(): void;
  /** Device orientation flipped (orientationchange or screen.orientation change). */
  orientation?(): void;
}

export function onLifecycle(h: LifecycleHandlers): () => void {
  const onVis = (): void => {
    if (document.visibilityState === 'hidden') h.hidden?.();
    else h.visible?.();
  };
  const onPageHide = (): void => h.pagehide?.();
  const onBlur = (): void => h.blur?.();
  const onOrient = (): void => h.orientation?.();
  const so = typeof screen !== 'undefined' ? screen.orientation : undefined;

  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('blur', onBlur);
  window.addEventListener('orientationchange', onOrient);
  so?.addEventListener?.('change', onOrient);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('orientationchange', onOrient);
    so?.removeEventListener?.('change', onOrient);
  };
}

export function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

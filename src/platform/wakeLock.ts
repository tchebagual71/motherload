// Screen Wake Lock: a nice-to-have (iOS 18.4+ standalone only; Low Power Mode still locks after 30 s), never
// relied upon (03 §3.8). Every failure is swallowed.

export interface WakeLockHandle {
  /** Keep the screen on while playing; re-acquired automatically when the page becomes visible again. */
  want(on: boolean): void;
  dispose(): void;
}

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

export function createWakeLock(): WakeLockHandle {
  const api = typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock : undefined;
  let wanted = false;
  let sentinel: WakeLockSentinelLike | null = null;
  let pending = false;

  const acquire = (): void => {
    if (!api || !wanted || pending || (sentinel && !sentinel.released) || document.visibilityState !== 'visible') return;
    pending = true;
    api
      .request('screen')
      .then((s) => {
        sentinel = s;
        if (!wanted) void s.release().catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => {
        pending = false;
      });
  };
  const release = (): void => {
    const s = sentinel;
    sentinel = null;
    if (s && !s.released) void s.release().catch(() => undefined);
  };
  const onVis = (): void => {
    if (document.visibilityState === 'visible') acquire();
  };
  if (api) document.addEventListener('visibilitychange', onVis);

  return {
    want(on) {
      wanted = on;
      if (on) acquire();
      else release();
    },
    dispose() {
      wanted = false;
      release();
      if (api) document.removeEventListener('visibilitychange', onVis);
    },
  };
}

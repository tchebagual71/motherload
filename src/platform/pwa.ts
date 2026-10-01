/// <reference types="vite-plugin-pwa/client" />
// Service-worker registration (04 §9.2: Workbox generateSW, registerType 'prompt'). The update is never applied
// mid-trip: the app decides when (title screen, or the next cold launch).

export interface ServiceWorkerHandle {
  /** Activate the waiting worker and reload. Call only after a critical save. */
  applyUpdate(): Promise<void>;
}

export interface RegisterOptions {
  onNeedRefresh(): void;
  onOfflineReady?(): void;
}

export async function registerServiceWorker(opts: RegisterOptions): Promise<ServiceWorkerHandle | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    const update = registerSW({
      immediate: true,
      onNeedRefresh: opts.onNeedRefresh,
      onOfflineReady: opts.onOfflineReady,
    });
    return { applyUpdate: () => update(true) };
  } catch {
    return null;
  }
}

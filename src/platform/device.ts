// Device and display-mode probes (DOM side). Every probe tolerates a missing navigator (unit tests, SSR).

export interface DeviceInfo {
  ios: boolean;
  android: boolean;
  /** Running from the Home Screen (or forced with ?standalone=1 for tests, 03 §6.7). */
  standalone: boolean;
  /** navigator.deviceMemory in GB (Chromium only), else null. */
  deviceMemory: number | null;
  /** Instagram/Facebook/… in-app browsers that cannot install or keep saves. */
  inAppBrowser: boolean;
  ua: string;
}

function nav(): Navigator | null {
  return typeof navigator === 'undefined' ? null : navigator;
}

/** iPhone / iPad, including iPadOS reporting itself as a Mac with touch. */
export function isIOS(ua: string = nav()?.userAgent ?? '', maxTouchPoints: number = nav()?.maxTouchPoints ?? 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function isAndroid(ua: string = nav()?.userAgent ?? ''): boolean {
  return /Android/i.test(ua);
}

export function isInAppBrowser(ua: string = nav()?.userAgent ?? ''): boolean {
  return /FBAN|FBAV|Instagram|Line\/|GSA\/|TikTok|Snapchat/i.test(ua);
}

export function isStandalone(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  if (new URLSearchParams(search).get('standalone') === '1') return true;
  const n = nav() as (Navigator & { standalone?: boolean }) | null;
  if (n?.standalone === true) return true;
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

export function deviceMemory(): number | null {
  const m = (nav() as (Navigator & { deviceMemory?: number }) | null)?.deviceMemory;
  return typeof m === 'number' && m > 0 ? m : null;
}

export function detectDevice(search?: string): DeviceInfo {
  const ua = nav()?.userAgent ?? '';
  return {
    ios: isIOS(ua),
    android: isAndroid(ua),
    standalone: isStandalone(search),
    deviceMemory: deviceMemory(),
    inAppBrowser: isInAppBrowser(ua),
    ua,
  };
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

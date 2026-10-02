// Environment probes shared by ui/ and input/ (DOM-side, read once).

let debugFlag: boolean | null = null;

/** Debug menu and keys: dev builds or `?debug=1` (03 §6.3; 04 §13). */
export function debugEnabled(): boolean {
  if (debugFlag === null) {
    const q = typeof location === 'undefined' ? '' : location.search;
    debugFlag = import.meta.env.DEV || new URLSearchParams(q).get('debug') === '1';
  }
  return debugFlag;
}

/** iPhone / iPad (including iPadOS reporting as Mac with touch). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

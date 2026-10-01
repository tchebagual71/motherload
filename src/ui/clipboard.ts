// Clipboard and Web Share helpers for save codes (canon §3.15; 03 §6.7). DOM-side.

/** Copy text; falls back to a hidden textarea + execCommand where the async API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path (permissions, insecure context).
  }
  return legacyCopy(text);
}

/**
 * Copy text that is still being produced. Safari drops the user activation across an `await`, so the
 * ClipboardItem form (which accepts a promise) is used when available; it must be called inside the tap.
 */
export async function copyTextLater(text: Promise<string>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    }
  } catch {
    // Fall through.
  }
  return copyText(await text);
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export async function pasteText(): Promise<string | null> {
  try {
    return navigator.clipboard?.readText ? await navigator.clipboard.readText() : null;
  } catch {
    return null;
  }
}

export function canShare(): boolean {
  return typeof navigator.share === 'function';
}

/** Share the code as a .hfsave file when the platform supports files, else as text. */
export async function shareSave(code: string, fileName: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShare()) return 'unsupported';
  try {
    const file = new File([code], fileName, { type: 'text/plain' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'HoleFactory save' });
    else await navigator.share({ text: code, title: 'HoleFactory save' });
    return 'shared';
  } catch {
    return 'cancelled';
  }
}

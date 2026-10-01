// Toast queue rules (03 §6.2): at most two visible, 2.5 s each, ≤ 40 characters; a repeated text refreshes
// the live toast instead of stacking. Pure: callers pass `now` (performance.now()).
import type { Toast } from './types';

export const TOAST_MS = 2_500;
export const MAX_TOASTS = 2;
export const TOAST_MAX_CHARS = 40;

export function clipToast(text: string): string {
  return text.length <= TOAST_MAX_CHARS ? text : `${text.slice(0, TOAST_MAX_CHARS - 1).trimEnd()}…`;
}

/** New list after showing `text` at `now`. Expired toasts are dropped, the oldest goes when over the cap. */
export function pushToast(list: readonly Toast[], id: number, text: string, tone: Toast['tone'], now: number): Toast[] {
  const clipped = clipToast(text);
  const live = list.filter((t) => t.until > now && t.text !== clipped);
  live.push({ id, text: clipped, tone, until: now + TOAST_MS });
  return live.length > MAX_TOASTS ? live.slice(live.length - MAX_TOASTS) : live;
}

/** The same list when nothing expired (so the signal does not fire), else the live subset. */
export function pruneToasts(list: Toast[], now: number): Toast[] {
  return list.some((t) => t.until <= now) ? list.filter((t) => t.until > now) : list;
}

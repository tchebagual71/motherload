// Trip summary on Rim arrival (01 §2.3; 03 §6.3): "312ft · $1,240 · 4.1 L · −0 HP · 3:22", then ≤ 3 Next Goals
// chips. Leaves after 4 s or on a tap; while a sheet covers it the clock restarts when it shows again.
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { AppController, TripSummary } from '../../app/types';
import { formatCash, formatDepth, formatHp, formatLitres } from '../format';

export const TRIP_SUMMARY_MS = 4_000;

/** "3:22" from whole seconds. */
export function formatTripTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

export function tripLine(t: TripSummary): string {
  const parts = [formatDepth(t.deepestRow), formatCash(t.value), formatLitres(t.fuelUsed), `−${formatHp(t.hullLost)} HP`];
  if (t.seconds !== undefined) parts.push(formatTripTime(t.seconds));
  return parts.join(' · ');
}

export function TripSummaryCard({ app, summary }: { app: AppController; summary: TripSummary }): JSX.Element {
  const dismiss = (): void => {
    if (app.state.tripSummary.peek() === summary) app.state.tripSummary.value = null;
  };
  useEffect(() => {
    const t = setTimeout(dismiss, TRIP_SUMMARY_MS);
    return () => clearTimeout(t);
  }, [summary]);
  const haul = `${summary.collected} ${summary.collected === 1 ? 'item' : 'items'}`;
  return (
    <button type="button" class="hf-trip" data-tap="" aria-label={`Trip ${summary.trip} summary: ${tripLine(summary)}. Tap to close`} onClick={dismiss}>
      <span class="hf-trip-head">
        Trip {summary.trip} · {haul}
      </span>
      <span class="hf-trip-line hf-digits">{tripLine(summary)}</span>
      {summary.nextGoals.length > 0 && (
        <span class="hf-trip-goals">
          {summary.nextGoals.map((g) => (
            <span key={g} class="hf-trip-goal">
              {g}
            </span>
          ))}
        </span>
      )}
      <span class="hf-trip-timer" aria-hidden="true" />
    </button>
  );
}

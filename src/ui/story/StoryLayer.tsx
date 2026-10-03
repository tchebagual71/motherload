// The story's transient slot at the top of the clear rect (03 §6.2: ≤ 1 transient text at a time, radio first):
// the radio ticker or card, then the trip summary on Rim arrival, else the goal chip. The chip also stands aside
// for toasts, and toasts move down below a showing radio or summary (--hf-story-h). Hidden under sheets and
// overlays, where the radio's clock holds.
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { GoalChip } from './GoalChip';
import { RadioCard, RadioLive, useRadio } from './RadioCards';
import { TripSummaryCard } from './TripSummaryCard';
import './story.css';

/** Gap between the story slot and the toasts under it. */
const STACK_GAP = 6;

export function StoryLayer({ app }: { app: AppController }): JSX.Element {
  app.state.hudTick.value; // ≤ 10 Hz: radio clock, idle detection, toast expiry
  const covered = app.state.overlay.value !== null || app.state.sheet.value !== null;
  const { view, tap } = useRadio(app, covered);
  const summary = covered ? null : app.state.tripSummary.value;
  const goal = app.state.goal.value;
  const now = performance.now();
  const toastShowing = app.state.toasts.value.some((t) => t.until > now);
  const showGoal = !covered && goal !== null && view.mode === 'hidden' && !summary && !toastShowing;
  const stack = useRef<HTMLDivElement>(null);
  const pushesToasts = view.mode !== 'hidden' || summary !== null;

  useLayoutEffect(() => {
    const el = stack.current;
    const root = el?.closest('.hf-ui') as HTMLElement | null | undefined;
    if (!el || !root) return;
    const h = pushesToasts ? `${(el.offsetHeight || 0) + STACK_GAP}px` : '0px';
    if (root.style.getPropertyValue('--hf-story-h') !== h) root.style.setProperty('--hf-story-h', h);
  });

  return (
    <div class="hf-story" ref={stack}>
      <RadioCard view={view} reduced={app.state.settings.value.reducedMotion} onTap={tap} />
      {summary && <TripSummaryCard app={app} summary={summary} />}
      {showGoal && <GoalChip goal={goal} />}
      <RadioLive view={view} />
    </div>
  );
}

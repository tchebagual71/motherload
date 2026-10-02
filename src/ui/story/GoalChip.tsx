// Goal chip (01 §2.3; 03 §6.2): one Dot-voiced action in a 28-pt chip under the HUD row; a tap shows Next Goals
// (≤ 3) for a few seconds. Its hit area is ≥ 44 pt (CSS) and it carries [data-tap] for second-finger taps.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { GoalChip as Goal } from '../../app/types';
import { Avatar } from './Avatar';

export const NEXT_GOALS_MS = 5_000;

export function GoalChip({ goal }: { goal: Goal }): JSX.Element {
  const [open, setOpen] = useState(false);
  const next = goal.next ?? [];
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(false), NEXT_GOALS_MS);
    return () => clearTimeout(t);
  }, [open]);
  const label = `Goal: ${goal.text}${goal.progress ? `, ${goal.progress}` : ''}${next.length > 0 ? '. Tap for next goals' : ''}`;
  return (
    <div class="hf-goal-wrap">
      <button
        type="button"
        class="hf-goal"
        aria-label={label}
        aria-expanded={next.length > 0 ? open : undefined}
        data-tap=""
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar sender="Dot" size={20} />
        <span class="hf-goal-text">{goal.text}</span>
        {goal.progress && <span class="hf-goal-progress hf-digits">{goal.progress}</span>}
      </button>
      {open && next.length > 0 && (
        <ol class="hf-goal-next" aria-label="Next goals">
          {next.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

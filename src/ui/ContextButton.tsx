// Context button (03 §3.5): centred over the slot cluster, shows the most urgent action (ui/context.ts) with a
// 200-ms fade-in, hidden when nothing applies. [data-tap] so a second finger can press it while the stick is held.
import type { JSX } from 'preact';
import type { AppController } from '../app/types';
import { controls } from '../input/controlsState';
import type { Rect } from '../input/zones';
import { pickContextAction, runContextAction, type ContextInput } from './context';

function contextInput(): ContextInput {
  const now = performance.now();
  return { now, idleMs: now - controls.lastInputAt };
}

export function ContextButton({ app, rect }: { app: AppController; rect: Rect }): JSX.Element | null {
  app.state.hudTick.value; // ≤ 10 Hz refresh
  app.state.bayFullAt.value;
  const action = pickContextAction(app, contextInput());
  if (!action) return null;
  return (
    <button
      key={action.id}
      type="button"
      tabIndex={-1}
      class="hf-context"
      data-tap=""
      data-context={action.id}
      style={{ left: `${rect.x0}px`, top: `${rect.y0}px`, width: `${rect.x1 - rect.x0}px`, height: `${rect.y1 - rect.y0}px` }}
      aria-label={`${action.label} (E)`}
      onClick={() => runContextAction(app, contextInput())}
    >
      {action.label}
    </button>
  );
}

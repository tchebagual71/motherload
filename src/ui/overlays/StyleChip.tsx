// M0 A/B style chip (03 §9.4; canon §5.1): 44 pt at the clear rect's top-left, 8 pt under the HUD; a tap flips
// the look in ≤ 1 frame (both pipelines precompiled), a long-press (450 ms, canon §3.12) opens the style test.
// Labelled A / B by seed parity so sessions stay blind (INT-4).
// [data-tap]: flips on a second-finger tap while the stick is held (see input/taps.ts).
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { TOUCH } from '../../shared/canon';
import { abLabel } from '../styleTest';

export function StyleChip({ app }: { app: AppController }): JSX.Element {
  const look = app.state.look.value;
  const label = abLabel(look, app.world.seed);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const clear = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const onDown = (): void => {
    clear();
    longFired.current = false;
    timer.current = setTimeout(() => {
      timer.current = null;
      longFired.current = true;
      app.openSheet('styletest');
    }, TOUCH.longPressMs);
  };
  const flip = (): void => {
    if (longFired.current) {
      longFired.current = false;
      return;
    }
    app.setLook(look === 'toon' ? 'pixel' : 'toon');
  };
  return (
    <button
      type="button"
      class="hf-style-chip"
      aria-label={`Look ${label}: tap to switch, hold for the look test`}
      data-tap=""
      onPointerDown={onDown}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={flip}
    >
      {label}
    </button>
  );
}

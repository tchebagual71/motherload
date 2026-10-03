// Press-and-hold button (canon §3.7 "Discard all" 600-ms hold): a fill sweeps across while held; letting go or
// sliding off early cancels. Keyboard activation (Enter / Space) fires at once.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** After a hold fires, the release's click (if the browser sends one) must not land on what moved under it. */
const SWALLOW_MS = 600;

function swallowNextClick(): void {
  const swallow = (e: Event): void => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  const done = (): void => document.removeEventListener('click', swallow, true);
  document.addEventListener('click', swallow, true);
  setTimeout(done, SWALLOW_MS);
}

export interface HoldButtonProps {
  ms: number;
  onHold: () => void;
  kind?: 'secondary' | 'danger';
  label?: string;
  class?: string;
  children?: ComponentChildren;
}

export function HoldButton({ ms, onHold, kind = 'secondary', label, class: cls, children }: HoldButtonProps): JSX.Element {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const start = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clear();
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      swallowNextClick();
      onHold();
    }, ms);
  };
  const cancel = (): void => {
    clear();
    setHolding(false);
  };
  // A pointer click (detail ≥ 1) comes after the hold, which already fired or was cancelled; only a keyboard
  // click (detail 0) activates here.
  const onClick = (e: MouseEvent): void => {
    if (e.detail === 0) onHold();
  };

  const classes = `hf-btn hf-btn-${kind} hf-hold${holding ? ' hf-holding' : ''}${cls ? ` ${cls}` : ''}`;
  return (
    <button
      type="button"
      class={classes}
      style={{ '--hold-ms': `${ms}ms` }}
      aria-label={label}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span class="hf-hold-fill" aria-hidden="true" />
      <span class="hf-hold-label">{children}</span>
    </button>
  );
}

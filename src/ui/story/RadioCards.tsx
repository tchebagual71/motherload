// Radio transmissions (canon §2.12 #5; 03 §6.5): the head of app.state.radio as a 28-pt ticker while moving or a
// 76-pt card when grounded and idle, at the top of the clear rect (03 §1.2: a card costs rows above the pod,
// never the clear rows below it). Only the "›" button takes pointers, so the stick is never intercepted; it
// carries [data-tap] so a second finger can press it while the other thumb holds the stick (input/taps.ts).
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { controls } from '../../input/controlsState';
import { Avatar, senderClass } from './Avatar';
import { RadioPlayer, TYPE_PER_MS, tickerText, type RadioView } from './radioPlayer';

/** Below this speed (tiles/s) a grounded pod counts as idle. */
const IDLE_SPEED = 0.05;

function podMoving(app: AppController): boolean {
  const pod = app.world.pod;
  const stick = controls.stick.active && controls.stick.magnitude > 0;
  return stick || controls.thrustHeld.peek() || !pod.grounded || pod.dig !== null || Math.abs(pod.vx) > IDLE_SPEED;
}

/**
 * The radio's current view, sampled on every render of the caller (which re-renders with hudTick, ≤ 10 Hz).
 * A message that finished its last card leaves the queue through app.dismissRadio.
 */
export function useRadio(app: AppController, covered: boolean): { view: RadioView; tap: () => void } {
  const player = useRef<RadioPlayer | null>(null);
  player.current ??= new RadioPlayer();
  const [, rerender] = useState(0);
  const head = app.state.radio.value[0] ?? null;
  const view = player.current.update({ now: performance.now(), head, grounded: app.world.pod.grounded, moving: podMoving(app), covered });
  const done = player.current.done;

  useEffect(() => {
    if (done >= 0 && app.state.radio.peek().some((m) => m.id === done)) app.dismissRadio(done);
  }, [done]);

  const tap = (): void => {
    player.current?.tap(head);
    rerender((n) => n + 1);
  };
  return { view, tap };
}

export function RadioCard({ view, reduced, onTap }: { view: RadioView; reduced: boolean; onTap: () => void }): JSX.Element | null {
  const msg = view.msg;
  if (view.mode === 'hidden' || !msg) return null;
  if (view.mode === 'ticker') {
    return (
      <div class={`hf-radio hf-radio-ticker ${senderClass(msg.sender)}`}>
        <span class="hf-radio-line">
          <span class="hf-radio-from">{msg.sender}</span>
          <span class="hf-radio-text">{tickerText(view.text)}</span>
        </span>
        <button type="button" class="hf-radio-next" aria-label={`Open transmission from ${msg.sender}`} data-tap="" onClick={onTap}>
          ›
        </button>
      </div>
    );
  }
  const chars = [...view.text];
  const typed = reduced ? chars.length : Math.min(chars.length, Math.floor(view.openMs * TYPE_PER_MS));
  const last = view.index >= msg.cards.length - 1;
  return (
    <div class={`hf-radio hf-radio-card ${senderClass(msg.sender)}`}>
      <Avatar sender={msg.sender} />
      <span class="hf-radio-body">
        <span class="hf-radio-from">
          {msg.sender}
          {msg.cards.length > 1 && <span class="hf-radio-count">{` · ${view.index + 1}/${msg.cards.length}`}</span>}
        </span>
        <span class="hf-radio-text" aria-hidden="true">
          {chars.slice(0, typed).join('')}
          {/* The untyped rest keeps its space, so the card never reflows while typing. */}
          <span class="hf-radio-untyped">{chars.slice(typed).join('')}</span>
        </span>
      </span>
      <button type="button" class="hf-radio-next" aria-label={last ? 'Done' : 'Next card'} data-tap="" onClick={onTap}>
        ›
      </button>
    </div>
  );
}

/** Polite live region (03 §7): each card is read once, whole, whether it shows as a ticker or a card. */
export function RadioLive({ view }: { view: RadioView }): JSX.Element {
  const msg = view.msg;
  return (
    <span class="hf-sr" aria-live="polite">
      {msg && view.mode !== 'hidden' && (
        <span key={`${msg.id}:${view.index}`}>
          {msg.sender}: {view.text}
        </span>
      )}
    </span>
  );
}

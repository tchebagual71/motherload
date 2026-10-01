// Bottom sheet (03 §6.4, §2.5): starts under the HUD row so cash stays live, ≤ 92% tall, ✕ 44 pt,
// swipe-down on the header closes, the body is a [data-scroll] container, the primary action is pinned.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon, type IconName } from './icons';

/** Drag distance (pt) or flick speed (pt/ms) that closes the sheet. */
const CLOSE_DRAG_PT = 96;
const CLOSE_FLICK_V = 0.6;

export interface BottomSheetProps {
  title: string;
  icon?: IconName;
  onClose: () => void;
  /** Pinned bottom area (primary action). */
  footer?: ComponentChildren;
  /** Exit animation in progress. */
  leaving?: boolean;
  /** Extra class for the sheet (e.g. narrower content). */
  class?: string;
  children?: ComponentChildren;
}

export function BottomSheet({ title, icon, onClose, footer, leaving, class: cls, children }: BottomSheetProps): JSX.Element {
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef({ id: -1, y0: 0, t0: 0, dy: 0 });

  useEffect(() => {
    sheet.current?.focus({ preventScroll: true });
  }, []);

  const onDown = (e: PointerEvent): void => {
    if (drag.current.id !== -1 || (e.target instanceof Element && e.target.closest('button'))) return;
    drag.current = { id: e.pointerId, y0: e.clientY, t0: e.timeStamp, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (sheet.current) sheet.current.style.transition = 'none';
  };
  const onMove = (e: PointerEvent): void => {
    const d = drag.current;
    if (e.pointerId !== d.id || !sheet.current) return;
    d.dy = Math.max(0, e.clientY - d.y0);
    sheet.current.style.transform = `translate3d(0, ${d.dy}px, 0)`;
  };
  const onUp = (e: PointerEvent): void => {
    const d = drag.current;
    if (e.pointerId !== d.id) return;
    drag.current = { id: -1, y0: 0, t0: 0, dy: 0 };
    const speed = d.dy / Math.max(1, e.timeStamp - d.t0);
    const el = sheet.current;
    if (d.dy > CLOSE_DRAG_PT || (d.dy > 24 && speed > CLOSE_FLICK_V)) {
      onClose();
      return;
    }
    if (el) {
      el.style.transition = 'transform 160ms ease-out';
      el.style.transform = '';
    }
  };

  return (
    <div class={leaving ? 'hf-sheet-layer hf-leaving' : 'hf-sheet-layer'}>
      <div class="hf-scrim" onClick={onClose} />
      <section
        ref={sheet}
        class={cls ? `hf-sheet ${cls}` : 'hf-sheet'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header class="hf-sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span class="hf-grab" aria-hidden="true" />
          {icon && <Icon name={icon} size={24} class="hf-sheet-icon" />}
          <h2 class="hf-sheet-title">{title}</h2>
          <button type="button" class="hf-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </header>
        <div class="hf-sheet-body" data-scroll="">
          {children}
        </div>
        {footer && <footer class="hf-sheet-foot">{footer}</footer>}
      </section>
    </div>
  );
}

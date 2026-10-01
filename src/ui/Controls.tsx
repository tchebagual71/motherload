// Control-zone visuals (canon §3.12; 03 §1.5, §2.1–2.2, §3.1, §3.4): scrim, floating stick (drawn where
// the thumb is), rest hint, 2×2 quick slots and the optional THRUST button. Pointer handling lives in
// input/: slots and THRUST are tagged with data-slot / data-thrust and input delegates on the UI root.
import { useSignalEffect, type Signal } from '@preact/signals';
import type { CSSProperties, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { AppController } from '../app/types';
import { controls } from '../input/controlsState';
import { slotDecision, isGroundedOnly } from '../input/slots';
import { controlRects, restHintCentre, type Rect } from '../input/zones';
import { CONSUMABLES, TOUCH, type ConsumableId } from '../shared/canon';
import { Icon } from './icons';
import type { Viewport } from './viewport';

const SECTOR_TURN = { none: 0, up: 0, right: 90, down: 180, left: 270 } as const;

function rectStyle(r: Rect): CSSProperties {
  return { left: `${r.x0}px`, top: `${r.y0}px`, width: `${r.x1 - r.x0}px`, height: `${r.y1 - r.y0}px` };
}

export function ControlZone({ app, vp }: { app: AppController; vp: Signal<Viewport> }): JSX.Element {
  const s = app.state.settings.value;
  const v = vp.value;
  const zoneH = TOUCH.controlZone[s.controlSize] + v.ib;
  const rects = controlRects(v.w, v.h, v.ib, s.controlSize, s.thrustButton, s.leftHanded);
  return (
    <div class="hf-controls">
      <div class="hf-zone-scrim" style={{ height: `${zoneH}px` }} />
      <StickVisual app={app} vp={vp} />
      <QuickSlots app={app} rects={rects.slots} />
      {rects.thrust && <ThrustButton rect={rects.thrust} />}
    </div>
  );
}

/** The stick follows the thumb at pointer rate: transforms are written straight to the DOM. */
function StickVisual({ app, vp }: { app: AppController; vp: Signal<Viewport> }): JSX.Element {
  app.state.hudTick.value; // trips count for the rest hint
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const arc = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const s = app.state.settings.value;
  const v = vp.value;
  const r = TOUCH.stickRadius[s.controlSize];
  const showHint = app.world.story.trips < 3;
  const rest = restHintCentre({ width: v.w, height: v.h, controlZone: TOUCH.controlZone[s.controlSize] + v.ib, clearTop: v.it + TOUCH.hudRow }, s.controlSize, s.leftHanded);

  useSignalEffect(() => {
    controls.stickVersion.value;
    const st = controls.stick;
    const b = base.current;
    const k = knob.current;
    const a = arc.current;
    if (!b || !k || !a) return;
    hint.current?.classList.toggle('hf-hidden', st.active);
    b.classList.toggle('hf-on', st.active);
    if (!st.active) return;
    const d = `${st.radius * 2}px`;
    if (b.style.width !== d) b.style.width = b.style.height = d;
    b.style.transform = `translate3d(${st.baseX - st.radius}px, ${st.baseY - st.radius}px, 0)`;
    k.style.transform = `translate3d(${st.knobX - st.baseX}px, ${st.knobY - st.baseY}px, 0)`;
    a.dataset.sector = st.sector;
    a.style.transform = `rotate(${SECTOR_TURN[st.sector]}deg)`;
  });

  return (
    <>
      {showHint && (
        <div
          ref={hint}
          class="hf-rest-hint"
          style={{ left: `${rest.x - r}px`, top: `${rest.y - r}px`, width: `${r * 2}px`, height: `${r * 2}px` }}
          aria-hidden="true"
        />
      )}
      <div ref={base} class="hf-stick" aria-hidden="true">
        <div ref={arc} class="hf-stick-arc" data-sector="none" />
        <div ref={knob} class="hf-stick-knob" />
      </div>
    </>
  );
}

function consumableName(id: ConsumableId): string {
  return CONSUMABLES.find((c) => c.id === id)?.name ?? id;
}

function QuickSlots({ app, rects }: { app: AppController; rects: readonly Rect[] }): JSX.Element {
  app.state.hudTick.value;
  const arming = app.state.arming.value;
  const pressed = controls.pressedSlot.value;
  const pod = app.world.pod;
  const stats = app.world.stats();
  const fuelFrac = stats.maxFuel > 0 ? pod.fuel / stats.maxFuel : 1;
  const hullFrac = stats.maxHull > 0 ? pod.hull / stats.maxHull : 1;
  return (
    <>
      {rects.map((rect, i) => {
        const id = pod.quickSlots[i];
        if (!id) return null;
        const count = pod.consumables[id] ?? 0;
        const decision = slotDecision(id, { count, grounded: pod.grounded, fuelFrac, hullFrac });
        const locked = isGroundedOnly(id) && !pod.grounded && count > 0;
        return (
          <Slot
            key={i}
            index={i}
            id={id}
            rect={rect}
            count={count}
            disabled={!decision.ok}
            locked={locked}
            pressed={pressed === i}
            progress={arming && arming.slot === i ? arming.progress : -1}
          />
        );
      })}
    </>
  );
}

interface SlotProps {
  index: number;
  id: ConsumableId;
  rect: Rect;
  count: number;
  disabled: boolean;
  locked: boolean;
  pressed: boolean;
  /** Arming ring progress, -1 = not arming. */
  progress: number;
}

function Slot({ index, id, rect, count, disabled, locked, pressed, progress }: SlotProps): JSX.Element {
  const el = useRef<HTMLButtonElement>(null);
  const seen = useRef(controls.denied.peek().serial);
  useSignalEffect(() => {
    const d = controls.denied.value;
    if (d.serial === seen.current) return;
    seen.current = d.serial;
    if (d.slot !== index || !el.current || el.current.closest('.hf-reduced')) return;
    el.current.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
      { duration: 120, iterations: 2 },
    );
  });
  const size = rect.x1 - rect.x0;
  const ringR = size / 2 - 3;
  const circ = 2 * Math.PI * ringR;
  const cls = `hf-slot${disabled ? ' hf-dim' : ''}${pressed ? ' hf-pressed' : ''}${progress >= 1 ? ' hf-armed' : ''}`;
  return (
    <button
      ref={el}
      type="button"
      tabIndex={-1}
      class={cls}
      data-slot={index}
      style={rectStyle(rect)}
      aria-label={`${consumableName(id)}, ${count} left, key ${index + 1}`}
    >
      <Icon name={id} size={size >= 60 ? 30 : 26} />
      <span class="hf-slot-count">{count}</span>
      {locked && (
        <span class="hf-slot-lock">
          <Icon name="lock" size={12} />
        </span>
      )}
      {progress >= 0 && (
        <svg class="hf-slot-ring" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={ringR}
            stroke-dasharray={`${circ}`}
            stroke-dashoffset={`${circ * (1 - progress)}`}
          />
        </svg>
      )}
    </button>
  );
}

function ThrustButton({ rect }: { rect: Rect }): JSX.Element {
  const held = controls.thrustHeld.value;
  return (
    <button
      type="button"
      tabIndex={-1}
      class={held ? 'hf-thrust hf-pressed' : 'hf-thrust'}
      data-thrust=""
      style={rectStyle(rect)}
      aria-label="Thrust"
    >
      THRUST
    </button>
  );
}

// HUD row (canon §3.12; 03 §6.1): one 44-pt row under the top inset — fuel, hull, cargo, info, menu.
// Re-renders with app.state.hudTick (≤ 10 Hz) and reads the world directly. Its buttons carry [data-tap]
// so input/ activates them from the pointer sequence: a second finger gets no click while the stick is
// held. Not a live region (it changes every tick); only newly crossed warnings are announced.
import type { Signal } from '@preact/signals';
import type { CSSProperties, JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { AppController } from '../app/types';
import { inScope } from '../config/scope';
import { closeCurrentSheet } from './actions';
import { BAY_FULL_CONTEXT_MS } from './context';
import { formatCash } from './format';
import { hudAlert, hudModel, returnTickOn, type HudModel } from './hudModel';
import { Icon } from './icons';
import { hudColumns, hudDigitPt } from './layout';
import type { Viewport } from './viewport';
import { Bar } from './widgets';

const FUEL_COLOUR = 'var(--hf-fuel)';
const width = (w: number): CSSProperties => ({ width: `${w}px` });
const DANGER = 'var(--hf-danger)';
const MASS_COLOUR = { ok: 'var(--hf-cargo)', amber: 'var(--hf-amber)', red: 'var(--hf-danger)' } as const;

export function Hud({ app, vp }: { app: AppController; vp: Signal<Viewport> }): JSX.Element {
  app.state.hudTick.value; // subscribe: ≤ 10 Hz refresh
  const v = vp.value;
  const world = app.world;
  const settings = app.state.settings.value;
  const stats = world.stats();
  // Return Tick is MVP (canon §5.5).
  const tickOn = inScope('mvp') && returnTickOn(settings.returnTick, {
    tankTier: world.pod.tiers.tank,
    trips: world.story.trips,
    assisted: settings.landingAssist || settings.steadyDrill,
  });
  const m = hudModel(world.pod, stats, world.wallet, { liters: tickOn ? world.returnFuel() : 0, shown: tickOn });
  const rowW = v.w - v.il - v.ir;
  const [fuelW, hullW, cargoW, infoW, menuW] = hudColumns(rowW);
  const style = { '--hf-digit': `${hudDigitPt(rowW, settings.textScale)}px` };
  const bayFullAt = app.state.bayFullAt.value;
  const bayFull = performance.now() - bayFullAt <= BAY_FULL_CONTEXT_MS;

  const onMenu = (): void => {
    if (app.state.sheet.peek() === 'menu') closeCurrentSheet(app);
    else app.openSheet('menu');
  };
  const onCargo = (): void => {
    if (inScope('mvp')) app.openSheet('cargo');
  };
  const onInfo = (): void => {
    const debt = world.wallet.debt;
    if (debt > 0) app.toast(`Co-op debt ${formatCash(debt)}, taken from your next sale`, 'warn');
  };

  return (
    <>
      <div class="hf-hud" style={style} role="group" aria-label="Pod status">
        <FuelPill m={m} w={fuelW} />
        <HullPill m={m} w={hullW} hull={world.pod.hull} />
        <CargoPill m={m} w={cargoW} slots={stats.baySlots} bayFull={bayFull} bayFullAt={bayFullAt} onClick={onCargo} />
        <InfoPill m={m} w={infoW} onClick={onInfo} />
        <button type="button" class="hf-pill hf-pill-menu" style={width(menuW)} aria-label="Menu" data-tap="" onClick={onMenu}>
          <span class="hf-pill-face">
            <Icon name="menu" size={22} />
          </span>
        </button>
      </div>
      <HudAlerts m={m} />
    </>
  );
}

/** Assertive region for warnings just crossed (hudAlert); each new alert is a new node so it is read. */
function HudAlerts({ m }: { m: HudModel }): JSX.Element {
  const last = useRef<HudModel | null>(null);
  const said = useRef({ id: 0, text: '' });
  const alert = hudAlert(last.current, m);
  last.current = m;
  if (alert) said.current = { id: said.current.id + 1, text: alert };
  return (
    <div class="hf-sr" aria-live="assertive">
      {said.current.text && <span key={said.current.id}>{said.current.text}</span>}
    </div>
  );
}

function FuelPill({ m, w }: { m: HudModel; w: number }): JSX.Element {
  const low = m.fuelWarn >= 0;
  const label = `Fuel ${m.fuelText}${m.fuelShort ? ', short of the climb home' : ''}`;
  return (
    <div class={`hf-pill hf-pill-fuel${low ? ` hf-warn hf-warn-${m.fuelWarn}` : ''}`} style={width(w)} aria-label={label}>
      <span class="hf-pill-face">
        <span class="hf-pill-top">
          <Icon name="fuel" size={13} class="hf-pill-icon" />
          <span class="hf-digits">{m.fuelText}</span>
        </span>
        <span class="hf-bar-wrap">
          <Bar frac={m.fuelFrac} color={low || m.fuelShort ? DANGER : FUEL_COLOUR} />
          {/* Return Tick (01 §3.5): the climb home's fuel at this load; the bar is red below 1.25× it. */}
          {m.returnTick !== null && <i class="hf-return-tick" style={{ left: `${(m.returnTick * 100).toFixed(1)}%` }} />}
        </span>
      </span>
    </div>
  );
}

function HullPill({ m, w, hull }: { m: HudModel; w: number; hull: number }): JSX.Element {
  const face = useRef<HTMLSpanElement>(null);
  const prev = useRef(hull);
  useLayoutEffect(() => {
    // 2-pt shake on damage (03 §6.1); skipped under reduced motion via the CSS class on the root.
    if (hull < prev.current - 1e-6 && face.current && !face.current.closest('.hf-reduced')) {
      face.current.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }],
        { duration: 180, iterations: 2 },
      );
    }
    prev.current = hull;
  }, [hull]);
  return (
    <div class={`hf-pill hf-pill-hull${m.hullLow ? ' hf-warn' : ''}`} style={width(w)} aria-label={`Hull ${m.hullText}`}>
      <span class="hf-pill-face" ref={face}>
        <span class="hf-pill-top">
          <Icon name="hull" size={13} class="hf-pill-icon" />
          <span class="hf-digits">{m.hullText}</span>
        </span>
        <Bar frac={m.hullFrac} color={m.hullLow ? DANGER : 'var(--hf-hull)'} />
      </span>
    </div>
  );
}

interface CargoPillProps {
  m: HudModel;
  w: number;
  slots: number;
  /** Within 5 s of a "Bay full" (03 §6.1, §6.8: P0 on the pill; INT-3). */
  bayFull: boolean;
  bayFullAt: number;
  onClick: () => void;
}

function CargoPill({ m, w, slots, bayFull, bayFullAt, onClick }: CargoPillProps): JSX.Element {
  const face = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    // 3-pt shake on each "Bay full" (03 §6.9); skipped under reduced motion via the root class.
    if (!bayFull || !face.current || face.current.closest('.hf-reduced')) return;
    face.current.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
      { duration: 160, iterations: 2 },
    );
  }, [bayFullAt]);
  const alert = m.tooHeavy || bayFull;
  const callout = m.tooHeavy ? 'TOO HEAVY' : bayFull ? 'BAY FULL' : null;
  const label = `Cargo ${m.cargoText} of ${slots}${m.tooHeavy ? ', too heavy' : bayFull ? ', bay full' : ''}`;
  return (
    <button
      type="button"
      class={`hf-pill hf-pill-cargo${alert ? ' hf-heavy' : ''}`}
      style={width(w)}
      aria-label={label}
      data-tap=""
      onClick={onClick}
    >
      <span class="hf-pill-face" ref={face}>
        <span class="hf-pill-top">
          <Icon name={alert ? 'warn' : 'cargo'} size={13} class="hf-pill-icon" />
          <span class="hf-digits">{m.cargoText}</span>
        </span>
        <Bar frac={m.cargoFrac} color={MASS_COLOUR[m.massTone]} />
      </span>
      {callout && <span class="hf-callout">{callout}</span>}
    </button>
  );
}

function InfoPill({ m, w, onClick }: { m: HudModel; w: number; onClick: () => void }): JSX.Element {
  const depth = (
    <span class="hf-depth">
      <span class="hf-depth-arrow" aria-hidden="true">
        ▼
      </span>
      {m.depth}
    </span>
  );
  const cash = <span class={m.inDebt ? 'hf-cash hf-debt' : 'hf-cash'}>{m.cash}</span>;
  return (
    <button
      type="button"
      class="hf-pill hf-pill-info"
      style={width(w)}
      aria-label={`Cash ${m.cash}, depth ${m.depth}`}
      data-tap=""
      onClick={onClick}
    >
      <span class="hf-pill-face">
        <span class="hf-info-main hf-digits">{m.underground ? depth : cash}</span>
        <span class="hf-info-sub hf-digits">{m.underground ? cash : depth}</span>
      </span>
    </button>
  );
}

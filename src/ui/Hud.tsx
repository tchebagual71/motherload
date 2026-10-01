// HUD row (canon §3.12; 03 §6.1): one 44-pt row under the top inset — fuel, hull, cargo, info, menu.
// Re-renders with app.state.hudTick (≤ 10 Hz) and reads the world directly.
import type { Signal } from '@preact/signals';
import type { CSSProperties, JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { AppController } from '../app/types';
import { inScope } from '../config/scope';
import { closeCurrentSheet } from './actions';
import { formatCash } from './format';
import { hudModel, type HudModel } from './hudModel';
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
  const stats = world.stats();
  const m = hudModel(world.pod, stats, world.wallet);
  const rowW = v.w - v.il - v.ir;
  const [fuelW, hullW, cargoW, infoW, menuW] = hudColumns(rowW);
  const style = { '--hf-digit': `${hudDigitPt(rowW)}px` };

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
    <div class="hf-hud" style={style} role="status" aria-label="Pod status">
      <FuelPill m={m} w={fuelW} />
      <HullPill m={m} w={hullW} hull={world.pod.hull} />
      <CargoPill m={m} w={cargoW} slots={stats.baySlots} onClick={onCargo} />
      <InfoPill m={m} w={infoW} onClick={onInfo} />
      <button type="button" class="hf-pill hf-pill-menu" style={width(menuW)} aria-label="Menu" onClick={onMenu}>
        <span class="hf-pill-face">
          <Icon name="menu" size={22} />
        </span>
      </button>
    </div>
  );
}

function FuelPill({ m, w }: { m: HudModel; w: number }): JSX.Element {
  const low = m.fuelWarn >= 0;
  return (
    <div class={`hf-pill hf-pill-fuel${low ? ` hf-warn hf-warn-${m.fuelWarn}` : ''}`} style={width(w)} aria-label={`Fuel ${m.fuelText}`}>
      <span class="hf-pill-face">
        <span class="hf-pill-top">
          <Icon name="fuel" size={13} class="hf-pill-icon" />
          <span class="hf-digits">{m.fuelText}</span>
        </span>
        <Bar frac={m.fuelFrac} color={low ? DANGER : FUEL_COLOUR} />
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

function CargoPill({ m, w, slots, onClick }: { m: HudModel; w: number; slots: number; onClick: () => void }): JSX.Element {
  const label = `Cargo ${m.cargoText} of ${slots}${m.tooHeavy ? ', too heavy' : ''}`;
  return (
    <button type="button" class={`hf-pill hf-pill-cargo${m.tooHeavy ? ' hf-heavy' : ''}`} style={width(w)} aria-label={label} onClick={onClick}>
      <span class="hf-pill-face">
        <span class="hf-pill-top">
          <Icon name={m.tooHeavy ? 'warn' : 'cargo'} size={13} class="hf-pill-icon" />
          <span class="hf-digits">{m.cargoText}</span>
        </span>
        <Bar frac={m.cargoFrac} color={MASS_COLOUR[m.massTone]} />
      </span>
      {m.tooHeavy && <span class="hf-callout">TOO HEAVY</span>}
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
    <button type="button" class="hf-pill hf-pill-info" style={width(w)} aria-label={`Cash ${m.cash}, depth ${m.depth}`} onClick={onClick}>
      <span class="hf-pill-face">
        <span class="hf-info-main hf-digits">{m.underground ? depth : cash}</span>
        <span class="hf-info-sub hf-digits">{m.underground ? cash : depth}</span>
      </span>
    </button>
  );
}

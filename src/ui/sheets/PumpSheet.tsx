// Pump House (canon §2.4; 01 §3.10; 03 §6.3): gauge, 5 / 10 / 25 / 50 L tiles with quotes, pinned Fill,
// Co-op Credit note (MVP). The receipt toast is written here in the quote's own litres (rounded down, 03 §6.1).
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';
import { COOP_CREDIT_CASH_BELOW, COOP_CREDIT_FUEL_BELOW, COOP_CREDIT_LITERS } from '../../shared/canon';
import { inScope } from '../../config/scope';
import type { Quote, Result, WorldApi } from '../../world/api';
import { act } from '../actions';
import { BottomSheet } from '../BottomSheet';
import { formatCash, formatLitres, formatLitresAmount, formatSteps } from '../format';
import { Bar, Button } from '../widgets';

const AMOUNTS = [5, 10, 25, 50] as const;

function tileSub(q: Quote, liters: number): string {
  if (q.amount <= 0) return '—';
  if (q.amount < liters - 1e-6) return `${formatLitresAmount(q.amount)} · ${formatCash(q.cost)}`;
  return formatCash(q.cost);
}

/**
 * Buy fuel; the receipt names the litres and dollars the sheet quoted ("Fill 4.6 L · $5" → "Filled up: 4.6 L for
 * $5"), never a differently rounded amount (PLAYER-11).
 */
export function buyFuelReceipt(w: WorldApi, liters: number | 'fill'): Result {
  const q = w.fuelQuote(liters);
  const r = w.buyFuel(liters);
  if (!r.ok) return r;
  const full = w.pod.fuel >= w.stats().maxFuel;
  const what = full ? `Filled up: ${formatLitresAmount(q.amount)}` : `Bought ${formatLitresAmount(q.amount)}`;
  return { ...r, message: `${what} for ${formatCash(q.cost)}` };
}

export function PumpSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  app.state.hudTick.value;
  const w = app.world;
  const pod = w.pod;
  const max = w.stats().maxFuel;
  const full = pod.fuel >= max - 0.05;
  const fill = w.fuelQuote('fill');
  const fillLabel = full
    ? 'Tank is full'
    : fill.amount <= 0
      ? 'No cash for fuel'
      : `${fill.limitedByCash ? 'Buy' : 'Fill'} ${formatLitresAmount(fill.amount)} · ${formatCash(fill.cost)}`;

  return (
    <BottomSheet
      title="Pump House"
      icon="pump"
      onClose={close}
      leaving={leaving}
      footer={
        <Button kind="primary" big disabled={fill.amount <= 0} onClick={() => act(app, () => buyFuelReceipt(w, 'fill'))}>
          {fillLabel}
        </Button>
      }
    >
      <div class="hf-gauge">
        <div class="hf-gauge-top">
          <span class="hf-gauge-value hf-digits">{formatLitres(pod.fuel)}</span>
          <span class="hf-gauge-max">of {formatLitres(max)}</span>
        </div>
        <Bar frac={max > 0 ? pod.fuel / max : 0} color="var(--hf-fuel)" class="hf-bar-big" />
      </div>
      <div class="hf-tiles">
        {AMOUNTS.map((l, i) => {
          const q = w.fuelQuote(l);
          // A bigger tile that buys no more than the one before it (tank room or cash) adds nothing.
          const redundant = i > 0 && q.amount <= w.fuelQuote(AMOUNTS[i - 1]).amount + 1e-6;
          return (
            <button
              key={l}
              type="button"
              class="hf-btn hf-btn-secondary hf-tile"
              disabled={q.amount <= 0 || redundant}
              aria-label={`Buy ${l} litres for ${formatCash(q.cost)}`}
              onClick={() => act(app, () => buyFuelReceipt(w, l))}
            >
              <span class="hf-tile-main">{l} L</span>
              <span class="hf-tile-sub">{redundant ? '—' : tileSub(q, l)}</span>
            </button>
          );
        })}
      </div>
      <p class="hf-note">Fuel is {formatCash(1)} a litre. Fill buys as much as your cash allows.</p>
      {inScope('mvp') && <CoopNote app={app} />}
    </BottomSheet>
  );
}

/** Co-op Credit (01 §3.10): free 5 L when cash < $5 and fuel < 2 L, once per 10 min. */
function CoopNote({ app }: { app: AppController }): JSX.Element {
  const w = app.world;
  const eligible = w.wallet.cash < COOP_CREDIT_CASH_BELOW && w.pod.fuel < COOP_CREDIT_FUEL_BELOW;
  const wait = w.story.coopCreditReadyStep - w.stepNo;
  let text = `Broke and dry? The Co-op tops you up ${COOP_CREDIT_LITERS} L free, once every 10 minutes.`;
  if (eligible) text = wait > 0 ? `Co-op Credit is back in ${formatSteps(wait)}.` : `Co-op Credit ready: ${COOP_CREDIT_LITERS} L on the house.`;
  return <p class={eligible ? 'hf-note hf-note-good' : 'hf-note'}>{text}</p>;
}

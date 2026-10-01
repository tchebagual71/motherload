// Assay Office, Sell (canon §2.4, §3.8; 03 §6.3): cargo groups, Co-op debt line, pinned "Sell all $n".
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';
import { ORES, RELIC_COLOURS } from '../../render/palette';
import type { CargoItem } from '../../shared/types';
import { act } from '../actions';
import { BottomSheet } from '../BottomSheet';
import { formatCash, formatMass } from '../format';
import { Button } from '../widgets';

/** Swatch colour for a cargo item (03 §8.4 ore codes; relic colours). */
export function itemSwatch(item: CargoItem): string {
  let hex = 0xb8a27a;
  if (item.kind === 'mineral') hex = ORES[item.tier - 1]?.base ?? hex;
  else if (item.kind === 'relic') hex = RELIC_COLOURS[item.id] ?? hex;
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export function AssaySheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  app.state.hudTick.value;
  const w = app.world;
  const groups = w.cargoGroups();
  const total = w.cargoValue();
  const debt = w.wallet.debt;
  const net = Math.max(0, total - debt);
  return (
    <BottomSheet
      title="Assay Office"
      icon="assay"
      onClose={close}
      leaving={leaving}
      footer={
        <Button kind="primary" big disabled={groups.length === 0} onClick={() => act(app, () => w.sellAll())}>
          {groups.length === 0 ? 'Nothing to sell' : `Sell all · ${formatCash(total)}`}
        </Button>
      }
    >
      {groups.length === 0 ? (
        <p class="hf-empty">Your bay is empty. Dig up some ore and bring it here.</p>
      ) : (
        <ul class="hf-list">
          {groups.map((g, i) => (
            <li key={i} class="hf-list-row">
              <span class="hf-swatch" style={{ background: itemSwatch(g.item) }} aria-hidden="true" />
              <span class="hf-list-main">
                <span class="hf-list-title">
                  {g.label} <span class="hf-mult">×{g.count}</span>
                </span>
                <span class="hf-list-sub">
                  {formatCash(g.unitValue)} each · {formatMass(g.mass)}
                </span>
              </span>
              <span class="hf-list-value hf-digits">{formatCash(g.totalValue)}</span>
            </li>
          ))}
        </ul>
      )}
      {debt > 0 && (
        <div class="hf-debt-line" role="note">
          <span class="hf-debt-head">
            <span>Co-op debt</span>
            <span class="hf-digits">−{formatCash(debt)}</span>
          </span>
          <span class="hf-debt-net">
            {total > 0 ? `Taken from this sale: you receive ${formatCash(net)}` : 'Taken from your next sale'}
          </span>
        </div>
      )}
    </BottomSheet>
  );
}

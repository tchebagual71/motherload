// Assay Office, Sell (canon §2.4, §3.8; 03 §6.3): cargo groups, Co-op debt line, pinned "Sell all $n". MVP: each
// bulk-specimen row (tiers 1–6, canon §4.9) has a 44-pt Sell / Stockpile toggle once a lode is found (U2); the
// pinned action stockpiles those rows into the Bins and sells the rest. Gems stay sell-only in the MVP.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import type { CargoGroup } from '../../world/api';
import { ORES, RELIC_COLOURS } from '../../render/palette';
import { scopeAtLeast } from '../../shared/scope';
import { relicCaption } from '../../story';
import type { CargoItem } from '../../shared/types';
import { act } from '../actions';
import { BottomSheet } from '../BottomSheet';
import { formatCash, formatMass } from '../format';
import { Button } from '../widgets';
import './ShedSheet.css';

/** Bulk specimen tiers ride logistics (canon §4.9): the Assay can Stockpile them. */
const MAX_BULK_TIER = 6;
/** Specimen tiers the player set to Stockpile, remembered for the session (the toggle sticks between visits). */
const stockTiers = new Set<number>();

function bulkTier(g: CargoGroup): number {
  return g.item.kind === 'mineral' && g.item.tier <= MAX_BULK_TIER ? g.item.tier : 0;
}

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
  const [, rerender] = useState(0);
  const all = w.cargoGroups();
  // Kits are never sold here (canon §4.9); the cargo panel lists them.
  const groups = all.filter((g) => g.item.kind !== 'kit');
  const canStock = w.factory !== null && w.factory.isUnlocked('U2');
  const stocked = canStock ? groups.filter((g) => stockTiers.has(bulkTier(g))) : [];
  const stockCount = stocked.reduce((a, g) => a + g.count, 0);
  const total = w.cargoValue() - stocked.reduce((a, g) => a + g.totalValue, 0);
  const debt = w.wallet.debt;
  const net = Math.max(0, total - debt);
  const toggle = (tier: number, on: boolean): void => {
    if (on) stockTiers.add(tier);
    else stockTiers.delete(tier);
    rerender((n) => n + 1);
  };
  const run = (): void => {
    for (const g of stocked) act(app, () => w.stockpileCargo(g.item, 'all'));
    if (total > 0 || stocked.length === 0) act(app, () => w.sellAll(stocked.map((g) => g.item)));
  };
  const label =
    groups.length === 0
      ? 'Nothing to sell'
      : stocked.length === 0
        ? `Sell all · ${formatCash(total)}`
        : total > 0
          ? `Sell ${formatCash(total)} · Stockpile ${stockCount}`
          : `Stockpile ${stockCount}`;
  return (
    <BottomSheet
      title="Assay Office"
      icon="assay"
      onClose={close}
      leaving={leaving}
      footer={
        <Button kind="primary" big disabled={groups.length === 0} onClick={run}>
          {label}
        </Button>
      }
    >
      {groups.length === 0 ? (
        <p class="hf-empty">{all.length > 0 ? 'Only Kits aboard: they stay with Pip. The Assay buys ore, gems and relics.' : 'Your bay is empty. Dig up some ore and bring it here.'}</p>
      ) : (
        <ul class="hf-list">
          {groups.map((g, i) => (
            <li key={i} class={canStock && bulkTier(g) > 0 ? `hf-list-row hf-assay-row${stockTiers.has(bulkTier(g)) ? ' hf-assay-stock' : ''}` : 'hf-list-row'}>
              <span class="hf-swatch" style={{ background: itemSwatch(g.item) }} aria-hidden="true" />
              <span class="hf-list-main">
                <span class="hf-list-title">
                  {g.label} <span class="hf-mult">×{g.count}</span>
                </span>
                <span class="hf-list-sub">
                  {formatCash(g.unitValue)} each · {formatMass(g.mass)}
                </span>
                {g.item.kind === 'relic' && scopeAtLeast(w.scope, 'mvp') && <span class="hf-list-sub hf-relic-caption">{relicCaption(g.item.id)}</span>}
              </span>
              <span class="hf-list-value hf-digits">{formatCash(g.totalValue)}</span>
              {canStock && bulkTier(g) > 0 && <StockToggle label={g.label} on={stockTiers.has(bulkTier(g))} onChange={(on) => toggle(bulkTier(g), on)} />}
            </li>
          ))}
        </ul>
      )}
      {canStock && groups.some((g) => bulkTier(g) > 0) && (
        <p class="hf-note hf-stock-note">
          Stockpile: <span class="hf-digits">{w.factory?.stockpileFree() ?? 0}</span> free in your Bins. Stockpiled specimens smelt into ingots (tiers 1–4).
        </p>
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
      {scopeAtLeast(w.scope, 'mvp') && (
        <button type="button" class="hf-row hf-menu-item" onClick={() => app.openSheet('office')}>
          <span class="hf-row-label">Dot's office</span>
          <span class="hf-row-hint">Log · Milestones · Plans</span>
          <span class="hf-chev" aria-hidden="true">
            ›
          </span>
        </button>
      )}
    </BottomSheet>
  );
}

/** Sell | Stockpile for one row (44-pt segments, 03 §6.3). */
function StockToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }): JSX.Element {
  return (
    <div class="hf-seg hf-assay-toggle" role="radiogroup" aria-label={`${label}: sell or stockpile`}>
      <button type="button" role="radio" aria-checked={!on} class={on ? 'hf-seg-btn' : 'hf-seg-btn hf-on'} onClick={() => onChange(false)}>
        Sell
      </button>
      <button type="button" role="radio" aria-checked={on} class={on ? 'hf-seg-btn hf-on' : 'hf-seg-btn'} onClick={() => onChange(true)}>
        Stockpile
      </button>
    </div>
  );
}

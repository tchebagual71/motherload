// Garage (canon §2.4, §2.6; 01 §3.10; 03 §6.3–6.4): one card per line (installed vs next tier, price, BUY
// or the blocker), pinned Repair all. Lines outside this build's scope show greyed "Coming soon".
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';
import type { Line } from '../../shared/canon';
import type { UpgradeCard } from '../../world/api';
import { act } from '../actions';
import { BottomSheet } from '../BottomSheet';
import { formatCash, formatHp } from '../format';
import { Icon, type IconName } from '../icons';
import { Button } from '../widgets';

const LINE_LABEL: Readonly<Record<Line, string>> = {
  drill: 'Drill',
  hull: 'Hull',
  engine: 'Engine',
  tank: 'Tank',
  radiator: 'Radiator',
  bay: 'Cargo bay',
  scanner: 'Scanner',
};
const LINE_ICON: Readonly<Record<Line, IconName>> = {
  drill: 'drill',
  hull: 'hull',
  engine: 'engine',
  tank: 'tank',
  radiator: 'radiator',
  bay: 'bay',
  scanner: 'scanner',
};

export function GarageSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  app.state.hudTick.value;
  const w = app.world;
  const cards = w.garageCards();
  const repair = w.repairQuote();
  const stats = w.stats();
  const damaged = w.pod.hull < stats.maxHull - 0.05;
  const repairLabel = !damaged
    ? 'Hull is in good shape'
    : repair.amount <= 0
      ? 'No cash for repairs'
      : `${repair.limitedByCash ? 'Repair' : 'Repair all'} ${formatHp(repair.amount)} HP · ${formatCash(repair.cost)}`;
  // Buyable cards first, then ones blocked by cash/parts, then out-of-scope lines.
  const ordered = [...cards].sort((a, b) => cardRank(a) - cardRank(b));
  return (
    <BottomSheet
      title="Garage"
      icon="garage"
      onClose={close}
      leaving={leaving}
      footer={
        <Button kind="primary" big disabled={!damaged || repair.amount <= 0} onClick={() => act(app, () => w.repairAll())}>
          {repairLabel}
        </Button>
      }
    >
      <ul class="hf-cards">
        {ordered.map((c) => (
          <LineCard key={c.line} card={c} onBuy={() => act(app, () => w.buyUpgrade(c.line, c.tier))} />
        ))}
      </ul>
    </BottomSheet>
  );
}

function cardRank(c: UpgradeCard): number {
  if (!c.available) return 2;
  return c.blocker === null ? 0 : 1;
}

function LineCard({ card, onBuy }: { card: UpgradeCard; onBuy: () => void }): JSX.Element {
  const soon = !card.available;
  return (
    <li class={soon ? 'hf-card hf-card-soon' : 'hf-card'}>
      <div class="hf-card-head">
        <span class="hf-card-icon">
          <Icon name={LINE_ICON[card.line]} size={22} />
        </span>
        <span class="hf-card-title">{LINE_LABEL[card.line]}</span>
        <span class="hf-card-tier">t{card.installedTier}</span>
      </div>
      <div class="hf-compare">
        <span class="hf-compare-now">
          <span class="hf-compare-name">{card.installedName}</span>
          <span class="hf-compare-stat">{card.installedStat}</span>
        </span>
        <span class="hf-compare-arrow" aria-hidden="true">
          →
        </span>
        <span class="hf-compare-next">
          <span class="hf-compare-name">{soon ? '?' : card.name}</span>
          <span class="hf-compare-stat">{soon ? '' : card.stat}</span>
        </span>
      </div>
      {card.parts.length > 0 && (
        <div class="hf-parts">
          {card.parts.map((p) => (
            <span key={p.item} class={p.have >= p.need ? 'hf-chip hf-chip-ok' : 'hf-chip hf-chip-miss'}>
              {p.item} {p.have}/{p.need} {p.have >= p.need ? '✓' : '✗'}
            </span>
          ))}
        </div>
      )}
      <div class="hf-card-foot">
        {soon ? (
          <span class="hf-blocker">Coming soon</span>
        ) : (
          <>
            <span class="hf-price hf-digits">{formatCash(card.price)}</span>
            {card.blocker !== null && <span class="hf-blocker">{card.blocker}</span>}
            <Button
              kind="primary"
              disabled={card.blocker !== null}
              label={`Buy ${card.name} ${LINE_LABEL[card.line].toLowerCase()}, ${card.price} dollars`}
              onClick={onBuy}
            >
              BUY
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

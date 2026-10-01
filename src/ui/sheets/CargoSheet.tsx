// Cargo panel (03 §6.3, MVP): bay contents with mass against the hover cap, and the quick-slots row.
// Discard (canon §3.7) needs a WorldApi call that does not exist yet; see the module report.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { BottomSheet } from '../BottomSheet';
import { formatCash, formatMass } from '../format';
import { massTone } from '../hudModel';
import { Bar, Button, SectionTitle } from '../widgets';
import { itemSwatch } from './AssaySheet';
import { QuickSlotRow } from './QuickSlotRow';

const TONE_COLOUR = { ok: 'var(--hf-cargo)', amber: 'var(--hf-amber)', red: 'var(--hf-danger)' } as const;

export function CargoSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  app.state.hudTick.value;
  const [slot, setSlot] = useState(-1);
  const w = app.world;
  const stats = w.stats();
  const groups = w.cargoGroups();
  const used = w.pod.cargo.length;
  const massFrac = stats.hoverCap > 0 ? stats.cargoMass / stats.hoverCap : 0;
  return (
    <BottomSheet
      title="Cargo"
      icon="cargo"
      onClose={close}
      leaving={leaving}
      footer={
        <Button kind="primary" big onClick={close}>
          Done
        </Button>
      }
    >
      <div class="hf-gauge">
        <div class="hf-gauge-top">
          <span class="hf-gauge-value hf-digits">
            {used}/{stats.baySlots}
          </span>
          <span class="hf-gauge-max">
            slots · {formatMass(stats.cargoMass)} of {formatMass(stats.hoverCap)} lift
          </span>
        </div>
        <Bar frac={massFrac} color={TONE_COLOUR[massTone(massFrac)]} class="hf-bar-big" />
        {stats.cargoMass > stats.hoverCap && <p class="hf-note hf-note-bad">Too heavy to climb: lighten the load.</p>}
      </div>
      {groups.length === 0 ? (
        <p class="hf-empty">Nothing in the bay yet.</p>
      ) : (
        <ul class="hf-list">
          {groups.map((g, i) => (
            <li key={i} class="hf-list-row">
              <span class="hf-swatch" style={{ background: itemSwatch(g.item) }} aria-hidden="true" />
              <span class="hf-list-main">
                <span class="hf-list-title">
                  {g.label} <span class="hf-mult">×{g.count}</span>
                </span>
                <span class="hf-list-sub">{formatMass(g.mass)}</span>
              </span>
              <span class="hf-list-value hf-digits">{formatCash(g.totalValue)}</span>
            </li>
          ))}
        </ul>
      )}
      <SectionTitle>Quick slots</SectionTitle>
      <QuickSlotRow app={app} selected={slot} onSelect={setSlot} />
      {slot >= 0 && (
        <div class="hf-buy-row hf-wrap">
          {w.shedItems().map((it) => (
            <Button
              key={it.id}
              icon={it.id}
              label={`Put ${it.name} in slot ${slot + 1}`}
              onClick={() => {
                w.setQuickSlot(slot, it.id);
                setSlot(-1);
              }}
            >
              {it.owned}
            </Button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

// Cargo panel (03 §6.3; canon §3.7; 01 §3.7): bay contents with mass against the hover cap, discard and the
// quick-slots row. Rows expand on tap to "Discard 1" (44 pt) and "Discard all" (600-ms hold); gems and relics ask
// first; Undo puts discards back until the panel closes (the app commits them on close). The pod is paused.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { MINERALS } from '../../shared/canon';
import type { CargoItem } from '../../shared/types';
import type { CargoGroup } from '../../world/api';
import { act } from '../actions';
import { BottomSheet } from '../BottomSheet';
import { formatCash, formatMass } from '../format';
import { HoldButton } from '../HoldButton';
import { massTone } from '../hudModel';
import { Bar, Button, SectionTitle } from '../widgets';
import { itemSwatch } from './AssaySheet';
import { QuickSlotRow } from './QuickSlotRow';

const TONE_COLOUR = { ok: 'var(--hf-cargo)', amber: 'var(--hf-amber)', red: 'var(--hf-danger)' } as const;
/** canon §3.7: "Discard all" is a 600-ms hold. */
export const DISCARD_ALL_HOLD_MS = 600;

/** Row key: one row per mineral tier, relic or Kit id. */
export function cargoKey(item: CargoItem): string {
  return item.kind === 'mineral' ? `m${item.tier}` : item.kind === 'relic' ? `r${item.id}` : `k:${item.id}`;
}

/** Gems (tiers 7–10) and relics ask before they go overboard (canon §3.7). */
export function discardNeedsConfirm(item: CargoItem): boolean {
  return item.kind === 'relic' || (item.kind === 'mineral' && (MINERALS[item.tier - 1]?.gem ?? false));
}

interface Pending {
  key: string;
  n: number | 'all';
}

export function CargoSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  app.state.hudTick.value;
  const [slot, setSlot] = useState(-1);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  /** Labels of this panel's discards, newest last, for the Undo bar. */
  const [history, setHistory] = useState<string[]>([]);
  const w = app.world;
  const stats = w.stats();
  const groups = w.cargoGroups();
  const massFrac = stats.hoverCap > 0 ? stats.cargoMass / stats.hoverCap : 0;

  const discard = (g: CargoGroup, n: number | 'all'): void => {
    setConfirm(null);
    const r = act(app, () => w.discardCargo(g.item, n));
    if (!r.ok) return;
    const count = r.amount ?? 1;
    setHistory([...history, `${count} × ${g.label}`]);
    if (count >= g.count) setOpen(null);
  };
  const request = (g: CargoGroup, n: number | 'all'): void => {
    if (discardNeedsConfirm(g.item)) setConfirm({ key: cargoKey(g.item), n });
    else discard(g, n);
  };
  const undo = (): void => {
    const r = act(app, () => w.undoDiscard());
    if (r.ok) setHistory(history.slice(0, -1));
  };
  const lastDiscard = w.discardsPending > 0 ? history[history.length - 1] : undefined;

  return (
    <BottomSheet
      title="Cargo"
      icon="cargo"
      class="hf-sheet-cargo"
      onClose={close}
      leaving={leaving}
      footer={
        <>
          {/* Pinned with Done, so Undo never shifts the rows under the thumb. */}
          {lastDiscard && (
            <div class="hf-undo-bar" role="status">
              <span>Discarded {lastDiscard}</span>
              <Button icon="undo" onClick={undo}>
                Undo
              </Button>
            </div>
          )}
          <Button kind="primary" big onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <div class="hf-gauge">
        <div class="hf-gauge-top">
          <span class="hf-gauge-value hf-digits">
            {stats.slotsUsed}/{stats.baySlots}
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
          {groups.map((g) => {
            const key = cargoKey(g.item);
            return (
              <CargoRow
                key={key}
                g={g}
                open={open === key}
                confirm={confirm?.key === key ? confirm.n : null}
                footerRows={history.length}
                onToggle={() => {
                  setConfirm(null);
                  setOpen(open === key ? null : key);
                }}
                onDiscard={(n) => request(g, n)}
                onConfirm={(n) => discard(g, n)}
                onCancel={() => setConfirm(null)}
              />
            );
          })}
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

interface RowProps {
  g: CargoGroup;
  open: boolean;
  /** A gem or relic discard waiting for its confirm, or null. */
  confirm: number | 'all' | null;
  /** Changes when the pinned footer grows or shrinks (the Undo bar), which can cover an open row. */
  footerRows: number;
  onToggle: () => void;
  onDiscard: (n: number | 'all') => void;
  onConfirm: (n: number | 'all') => void;
  onCancel: () => void;
}

function CargoRow({ g, open, confirm, footerRows, onToggle, onDiscard, onConfirm, onCancel }: RowProps): JSX.Element {
  const row = useRef<HTMLLIElement>(null);
  // The panel is 60% tall: keep an opened row's buttons (or its confirm) in view.
  useEffect(() => {
    if (open) row.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open, confirm, footerRows > 0]);
  const value = g.totalValue > 0 ? ` · ${formatCash(g.totalValue)}` : '';
  return (
    <li ref={row} class={open ? 'hf-cargo-row hf-open' : 'hf-cargo-row'}>
      <button type="button" class="hf-list-row hf-cargo-head" aria-expanded={open} onClick={onToggle}>
        <span class="hf-swatch" style={{ background: itemSwatch(g.item) }} aria-hidden="true" />
        <span class="hf-list-main">
          <span class="hf-list-title">
            {g.label} <span class="hf-mult">×{g.count}</span>
          </span>
          <span class="hf-list-sub">
            {formatMass(g.mass)}
            {value}
          </span>
        </span>
        <span class="hf-chev" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && confirm !== null && (
        <div class="hf-confirm" role="alert">
          <p>
            Throw out {confirm === 'all' ? `all ${g.count}` : 'one'} {g.label}? {confirm === 'all' ? `Worth ${formatCash(g.totalValue)}.` : `Worth ${formatCash(g.unitValue)}.`}
          </p>
          <div class="hf-buy-row">
            <Button onClick={onCancel}>Keep</Button>
            <Button kind="danger" onClick={() => onConfirm(confirm)}>
              Discard
            </Button>
          </div>
        </div>
      )}
      {open && confirm === null && (
        <div class="hf-buy-row hf-cargo-actions">
          <Button onClick={() => onDiscard(1)}>Discard 1</Button>
          <HoldButton ms={DISCARD_ALL_HOLD_MS} kind="danger" label={`Hold to discard all ${g.label}`} onHold={() => onDiscard('all')}>
            Hold: discard all
          </HoldButton>
        </div>
      )}
    </li>
  );
}

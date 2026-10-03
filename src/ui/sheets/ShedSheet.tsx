// Supply Shed (canon §2.4, §2.7, §4.8; 01 §3.10; 02 §3.7; 03 §6.3): consumables ×1 / ×5 / to 9 with owned counts
// and quick-slot assignment; MVP adds the Starter Kit (free once, after the scripted lode) and the Kits shelf
// (To bay / To Stockpile, Load from the Stockpile, the Shopping list for pending ghosts). Out-of-scope items are
// greyed "Coming soon".
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { KIT_METER, kitUnits } from '../../factory/api';
import type { CargoItem } from '../../shared/types';
import type { KitShopItem, ShopItem, WorldApi } from '../../world/api';
import { act } from '../actions';
import { BottomSheet } from '../BottomSheet';
import { formatCash } from '../format';
import { Icon, type IconName } from '../icons';
import { Button } from '../widgets';
import { AssignButton, QuickSlotRow } from './QuickSlotRow';
import './ShedSheet.css';

type Tab = 'consumables' | 'kits';
/** The shelf the player looked at last (session only). */
let lastTab: Tab | null = null;

/** Canon §2.1 Starter Kit: what the card lists (World.claimStarterKit hands these over). */
const STARTER_LINE = 'Auto-Drill Kit, Lift Foot Kit, Lift Rail, 2 Belt Kits';
const STARTER_SLOTS = 5;
const STARTER_MASS = 14;

/** What each MVP Kit builds underground (02 §2.6, §3.1). */
const KIT_EFFECT: Readonly<Record<string, string>> = {
  belt: `${KIT_METER.belt} tiles of underground belt`,
  router: 'One underground Router',
  autoDrill: 'Mk I drill for a discovered lode',
  liftFoot: 'Bucket Lift foot and 31 rows',
  liftRail: '32 more rows of Bucket Lift',
};
const KIT_ICON: Readonly<Record<string, IconName>> = { autoDrill: 'drill', liftFoot: 'hopBeacon', liftRail: 'hopBeacon' };

export function ShedSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  app.state.hudTick.value;
  const w = app.world;
  const [slot, setSlot] = useState(-1);
  const kits = w.kitShop();
  const starter = w.starterKitReady();
  const [tab, setTabState] = useState<Tab>(lastTab ?? (starter ? 'kits' : 'consumables'));
  const setTab = (t: Tab): void => {
    lastTab = t;
    setTabState(t);
  };
  const items = w.shedItems();
  const showKits = kits.length > 0 && tab === 'kits';
  return (
    <BottomSheet
      title="Supply Shed"
      icon="shed"
      onClose={close}
      leaving={leaving}
      footer={
        <Button kind="primary" big onClick={close}>
          Done
        </Button>
      }
    >
      {starter && <StarterKitCard app={app} />}
      {kits.length > 0 && (
        <div class="hf-seg hf-shed-tabs" role="tablist" aria-label="Shelves">
          {(['consumables', 'kits'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={t === tab} class={t === tab ? 'hf-seg-btn hf-on' : 'hf-seg-btn'} onClick={() => setTab(t)}>
              {t === 'kits' ? 'Kits' : 'Consumables'}
            </button>
          ))}
        </div>
      )}
      {showKits ? (
        <KitShelf app={app} kits={kits} />
      ) : (
        <>
          <QuickSlotRow app={app} selected={slot} onSelect={setSlot} />
          <ul class="hf-cards">
            {items.map((it) => (
              <ShedRow key={it.id} app={app} item={it} slot={slot} onAssigned={() => setSlot(-1)} />
            ))}
          </ul>
        </>
      )}
    </BottomSheet>
  );
}

function freeSlots(w: WorldApi): number {
  const s = w.stats();
  return Math.max(0, s.baySlots - s.slotsUsed);
}

function StarterKitCard({ app }: { app: AppController }): JSX.Element {
  const w = app.world;
  const free = freeSlots(w);
  const room = free >= STARTER_SLOTS;
  return (
    <div class="hf-card hf-starter" role="group" aria-label="Starter Kit">
      <div class="hf-card-head">
        <span class="hf-card-icon hf-starter-icon">
          <Icon name="cargo" size={22} />
        </span>
        <span class="hf-card-title">Starter Kit</span>
        <span class="hf-card-tier">Free</span>
      </div>
      <p class="hf-card-text">
        On the house from Dot: {STARTER_LINE} · {STARTER_SLOTS} slots · {STARTER_MASS} mu
      </p>
      <Button kind="primary" class="hf-starter-btn" disabled={!room} onClick={() => act(app, () => w.claimStarterKit())}>
        Collect Starter Kit
      </Button>
      {!room && <p class="hf-blocker hf-starter-block">Needs {STARTER_SLOTS} free bay slots (you have {free})</p>}
    </div>
  );
}

/** Kits the pending ghosts still need beyond what the bay holds (03 §4.6 Shopping list). */
export function shoppingList(w: WorldApi): { id: string; kits: number }[] {
  const f = w.factory;
  if (!f) return [];
  const need: Record<string, number> = {};
  for (const g of f.ghosts()) need[g.kit] = (need[g.kit] ?? 0) + g.kitUnits;
  const out: { id: string; kits: number }[] = [];
  for (const id of Object.keys(need)) {
    const short = need[id] - cargoUnits(w.pod.cargo, id);
    if (short > 0) out.push({ id, kits: Math.ceil(short / kitUnits(id)) });
  }
  return out;
}

function cargoUnits(cargo: readonly CargoItem[], id: string): number {
  let n = 0;
  for (const c of cargo) if (c.kind === 'kit' && c.id === id) n += c.units ?? kitUnits(id);
  return n;
}

function KitShelf({ app, kits }: { app: AppController; kits: KitShopItem[] }): JSX.Element {
  const w = app.world;
  const list = shoppingList(w);
  const byId = (id: string): KitShopItem | undefined => kits.find((k) => k.id === id);
  const missing = list.filter((s) => byId(s.id)?.available);
  const cost = missing.reduce((a, s) => a + (byId(s.id)?.price ?? 0) * s.kits, 0);
  const buyMissing = (): void => {
    for (const s of missing) if (!act(app, () => w.buyKit(s.id, s.kits, 'cargo')).ok) return;
  };
  return (
    <>
      {list.length > 0 && (
        <div class="hf-shop-list" role="group" aria-label="Shopping list">
          <span class="hf-shop-list-head">Shopping list for your ghosts</span>
          <div class="hf-parts">
            {list.map((s) => (
              <span key={s.id} class="hf-chip hf-chip-miss">
                {s.kits} × {byId(s.id)?.name ?? s.id}
              </span>
            ))}
          </div>
          {missing.length > 0 && (
            <Button kind="primary" class="hf-shop-list-btn" disabled={cost > w.wallet.cash} onClick={buyMissing} label={`Buy the missing Kits to the bay, ${cost} dollars`}>
              {`Buy missing · ${formatCash(cost)}`}
            </Button>
          )}
        </div>
      )}
      <p class="hf-note">Underground pieces are built from Kits. Carry them to a ghost, or store them in the Stockpile to load later.</p>
      <ul class="hf-cards">
        {kits.map((k) => (
          <KitRow key={k.id} app={app} kit={k} />
        ))}
      </ul>
    </>
  );
}

function KitRow({ app, kit }: { app: AppController; kit: KitShopItem }): JSX.Element {
  const w = app.world;
  const cash = w.wallet.cash;
  const fits = freeSlots(w) >= kit.slots;
  const afford = cash >= kit.price;
  const buy = (to: 'cargo' | 'stockpile') => act(app, () => w.buyKit(kit.id, 1, to));
  return (
    <li class={kit.available ? 'hf-card hf-kit' : 'hf-card hf-kit hf-card-soon'}>
      <div class="hf-card-head">
        <span class="hf-card-icon hf-kit-icon">
          <Icon name={KIT_ICON[kit.id] ?? 'cargo'} size={22} />
        </span>
        <span class="hf-card-title">{kit.name}</span>
        <span class="hf-card-tier hf-digits" aria-label={`${kit.inCargo} in the bay, ${kit.inStockpile} in the Stockpile`}>
          Bay {kit.inCargo} · Stock {kit.inStockpile}
        </span>
      </div>
      <p class="hf-card-text">
        {KIT_EFFECT[kit.id] ?? 'Builds underground'} · <span class="hf-digits">{formatCash(kit.price)}</span> · {kit.slots} slot · {kit.mass} mu
      </p>
      {kit.available ? (
        <div class="hf-buy-row">
          <Button disabled={!afford || !fits} onClick={() => buy('cargo')} label={`Buy a ${kit.name} to the bay`}>
            To bay
          </Button>
          <Button disabled={!afford} onClick={() => buy('stockpile')} label={`Buy a ${kit.name} to the Stockpile`}>
            To Stockpile
          </Button>
          {kit.inStockpile > 0 && (
            <Button disabled={!fits} onClick={() => act(app, () => w.loadKit(kit.id, 1))} label={`Load a ${kit.name} from the Stockpile`}>
              Load 1
            </Button>
          )}
        </div>
      ) : (
        <div class="hf-card-foot">
          <span class="hf-blocker">{kit.blocker ?? 'Coming soon'}</span>
        </div>
      )}
    </li>
  );
}

function ShedRow({ app, item, slot, onAssigned }: { app: AppController; item: ShopItem; slot: number; onAssigned: () => void }): JSX.Element {
  const room = Math.max(0, item.cap - item.owned);
  const cash = app.world.wallet.cash;
  const buy = (n: number) => act(app, () => app.world.buyConsumable(item.id, n));
  const can = (n: number) => item.available && n > 0 && n <= room && cash >= item.price * n;
  return (
    <li class={item.available ? 'hf-card' : 'hf-card hf-card-soon'}>
      <div class="hf-card-head">
        <span class="hf-card-icon">
          <Icon name={item.id} size={22} />
        </span>
        <span class="hf-card-title">{item.name}</span>
        <span class="hf-card-tier hf-digits">
          {item.owned}/{item.cap}
        </span>
      </div>
      <p class="hf-card-text">
        {item.effect} · <span class="hf-digits">{formatCash(item.price)}</span>
      </p>
      {item.available ? (
        <div class="hf-buy-row">
          <Button disabled={!can(1)} onClick={() => buy(1)} label={`Buy 1 ${item.name}`}>
            ×1
          </Button>
          <Button disabled={!can(5)} onClick={() => buy(5)} label={`Buy 5 ${item.name}`}>
            ×5
          </Button>
          <Button disabled={!can(room)} onClick={() => buy(room)} label={`Fill ${item.name} to ${item.cap}`}>
            to {item.cap}
          </Button>
        </div>
      ) : (
        <div class="hf-card-foot">
          <span class="hf-blocker">Coming soon</span>
        </div>
      )}
      {slot >= 0 && <AssignButton app={app} slot={slot} id={item.id} onDone={onAssigned} />}
    </li>
  );
}

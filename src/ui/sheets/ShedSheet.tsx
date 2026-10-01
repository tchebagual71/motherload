// Supply Shed (canon §2.4, §2.7; 01 §3.10): consumables ×1 / ×5 / to 9 with owned counts and quick-slot
// assignment. Out-of-scope items (M0) are greyed "Coming soon".
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import type { ShopItem } from '../../world/api';
import { act } from '../actions';
import { BottomSheet } from '../BottomSheet';
import { formatCash } from '../format';
import { Icon } from '../icons';
import { Button } from '../widgets';
import { AssignButton, QuickSlotRow } from './QuickSlotRow';

export function ShedSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  app.state.hudTick.value;
  const [slot, setSlot] = useState(-1);
  const items = app.world.shedItems();
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
      <QuickSlotRow app={app} selected={slot} onSelect={setSlot} />
      <ul class="hf-cards">
        {items.map((it) => (
          <ShedRow key={it.id} app={app} item={it} slot={slot} onAssigned={() => setSlot(-1)} />
        ))}
      </ul>
    </BottomSheet>
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

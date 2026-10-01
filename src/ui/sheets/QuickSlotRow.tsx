// Quick-slot assignment row (03 §3.4 "Reassign": tap a slot, then tap a consumable). Used by the Supply
// Shed and the cargo panel.
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';
import { CONSUMABLES, type ConsumableId } from '../../shared/canon';
import { Icon } from '../icons';

export function QuickSlotRow({
  app,
  selected,
  onSelect,
}: {
  app: AppController;
  selected: number;
  onSelect: (slot: number) => void;
}): JSX.Element {
  const slots = app.world.pod.quickSlots;
  return (
    <div class="hf-qs">
      <div class="hf-qs-slots" role="radiogroup" aria-label="Quick slots">
        {slots.map((id, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={selected === i}
            class={selected === i ? 'hf-qs-slot hf-on' : 'hf-qs-slot'}
            aria-label={`Slot ${i + 1}: ${nameOf(id)}`}
            onClick={() => onSelect(selected === i ? -1 : i)}
          >
            <Icon name={id} size={24} />
            <span class="hf-qs-key">{i + 1}</span>
          </button>
        ))}
      </div>
      <p class="hf-note">{selected >= 0 ? `Now pick an item for slot ${selected + 1}.` : 'Tap a slot, then pick an item for it.'}</p>
    </div>
  );
}

export function AssignButton({ app, slot, id, onDone }: { app: AppController; slot: number; id: ConsumableId; onDone: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="hf-btn hf-btn-secondary hf-assign"
      onClick={() => {
        app.world.setQuickSlot(slot, id);
        onDone();
      }}
    >
      Put in slot {slot + 1}
    </button>
  );
}

export function nameOf(id: ConsumableId): string {
  return CONSUMABLES.find((c) => c.id === id)?.name ?? id;
}

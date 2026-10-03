// "Update ready" chip (04 §9.2; APP-14): only on the Rim, the title or in the menu, never mid-trip. A tap runs a
// critical save, then skipWaiting and a reload (AppController.applyUpdate).
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { Icon } from '../icons';

export function UpdateChip({ app, class: cls }: { app: AppController; class?: string }): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  if (!app.state.updateReady.value && !busy) return null;
  const apply = (): void => {
    setBusy(true);
    void app.applyUpdate().finally(() => setBusy(false));
  };
  return (
    <button type="button" class={cls ? `hf-update-chip ${cls}` : 'hf-update-chip'} data-tap="" disabled={busy} onClick={apply}>
      <Icon name="play" size={14} />
      {busy ? 'Updating…' : 'Update'}
    </button>
  );
}

/** On the HUD: only while Pip is grounded on the Rim (no reload mid-trip). */
export function RimUpdateChip({ app, styleChip }: { app: AppController; styleChip: boolean }): JSX.Element | null {
  app.state.hudTick.value;
  if (!app.state.updateReady.value || !app.world.onRim()) return null;
  return <UpdateChip app={app} class={styleChip ? 'hf-update-hud hf-after-chip' : 'hf-update-hud'} />;
}

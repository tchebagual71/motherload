// Salvage card (canon §4.2; 01 §3.11): shown for 3 s after destruction — lost cargo, fee, debt.
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';
import { formatCash } from '../format';

export function DeathCard({ app }: { app: AppController }): JSX.Element | null {
  const d = app.state.death.value;
  if (!d) return null;
  return (
    <div class="hf-overlay hf-death" role="alert">
      <div class="hf-panel hf-death-card">
        <p class="hf-death-title">{d.cause === 'fuel' ? 'Out of fuel' : 'Hull gave out'}</p>
        <p class="hf-death-sub">The salvage drone is towing Pip home.</p>
        <dl class="hf-death-list">
          <div>
            <dt>Cargo lost</dt>
            <dd class="hf-digits">
              {d.lostCount} {d.lostCount === 1 ? 'item' : 'items'}
              {d.lostValue > 0 ? ` · ${formatCash(d.lostValue)}` : ''}
            </dd>
          </div>
          <div>
            <dt>Salvage fee</dt>
            <dd class="hf-digits">{formatCash(d.fee)}</dd>
          </div>
          {d.debt > 0 && (
            <div class="hf-death-debt">
              <dt>Co-op debt</dt>
              <dd class="hf-digits">{formatCash(d.debt)}</dd>
            </div>
          )}
        </dl>
        <p class="hf-note">Refuelled and repaired on the Pump House pad.</p>
      </div>
    </div>
  );
}

// "Factory resting" (02 §8.1 step 1; 04 §3.7): five minutes on screen without input put the factory to sleep (the MVP
// away). A pill that takes no pointers: the first touch or key anywhere wakes the factory (AppController input) and
// the chip goes with it.
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';
import { Icon } from '../icons';

export function RestingChip({ app }: { app: AppController }): JSX.Element | null {
  if (!app.state.resting.value) return null;
  return (
    <div class="hf-resting-chip" role="status">
      <Icon name="pause" size={14} />
      Factory resting
    </div>
  );
}

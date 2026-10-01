// "Tap to resume" (canon §4.5; 03 §3.8): 40% scrim, a 64-pt card centred in the control zone with 16-pt
// margins. The resuming tap lands on this overlay, so it is consumed and never becomes a stick.
import type { Signal } from '@preact/signals';
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';
import { TOUCH } from '../../shared/canon';
import { Icon } from '../icons';
import type { Viewport } from '../viewport';

const CARD_H = 64;

export function InterruptCard({ app, vp }: { app: AppController; vp: Signal<Viewport> }): JSX.Element {
  const zone = TOUCH.controlZone[app.state.settings.value.controlSize];
  const bottom = vp.value.ib + (zone - CARD_H) / 2;
  const resume = (): void => {
    app.unlockAudio();
    app.resume();
  };
  return (
    <div class="hf-overlay hf-interrupt" onClick={resume}>
      {/* The click bubbles to the overlay, which resumes. */}
      <button type="button" class="hf-resume-card" style={{ bottom: `${bottom}px` }}>
        <Icon name="pause" size={22} />
        <span>Tap to resume</span>
      </button>
    </div>
  );
}

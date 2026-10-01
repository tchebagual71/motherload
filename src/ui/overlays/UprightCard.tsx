// "Turn your phone upright" (canon §3.12 landscape phone, M0/MVP; 03 §1.3). The pod is paused
// (`interrupt`) while it shows; back in portrait the app shows "Tap to resume".
import type { JSX } from 'preact';
import { Icon } from '../icons';

export function UprightCard(): JSX.Element {
  return (
    <div class="hf-overlay hf-upright" role="alert">
      <div class="hf-upright-glyph">
        <Icon name="upright" size={64} />
      </div>
      <p class="hf-upright-title">Turn your phone upright</p>
      <p class="hf-upright-sub">HoleFactory plays in portrait. Pip is paused; the factory keeps running.</p>
    </div>
  );
}

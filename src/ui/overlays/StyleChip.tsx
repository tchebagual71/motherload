// M0 A/B style chip (03 §9.4; canon §5.1): 44 pt at the clear rect's top-left, 8 pt under the HUD; flips
// the look in ≤ 1 frame (both pipelines precompiled). Labelled A / B so sessions can stay blind.
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';

export function StyleChip({ app }: { app: AppController }): JSX.Element {
  const look = app.state.look.value;
  const flip = (): void => app.setLook(look === 'toon' ? 'pixel' : 'toon');
  return (
    <button type="button" class="hf-style-chip" aria-label={`Look ${look === 'toon' ? 'A' : 'B'}: switch look`} onClick={flip}>
      {look === 'toon' ? 'A' : 'B'}
    </button>
  );
}

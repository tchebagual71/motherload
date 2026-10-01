// Low-fuel vignette (03 §6.9): a 1-Hz red edge glow at ≤ 20% fuel, stronger at 10 / 5%. Photosafe (03 §7):
// edge-only, slow, well under a 20% full-screen luminance change.
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';
import { fuelWarnLevel } from '../hudModel';

export function FuelVignette({ app }: { app: AppController }): JSX.Element | null {
  app.state.hudTick.value;
  const w = app.world;
  const max = w.stats().maxFuel;
  const level = fuelWarnLevel(max > 0 ? w.pod.fuel / max : 1);
  if (level < 0 || w.pod.destroyed) return null;
  return <div class={`hf-vignette hf-vignette-${level}`} aria-hidden="true" />;
}

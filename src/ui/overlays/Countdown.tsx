// Resume countdown "3 · 2 · 1" (03 §3.8): 0.5 s per digit over the pod. Never blocks input: a thumb may
// take the stick meanwhile and the pod resumes with that input.
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';
import { countdownDigit } from '../format';

export function Countdown({ app }: { app: AppController }): JSX.Element {
  const digit = countdownDigit(app.state.countdownMs.value);
  return (
    <div class="hf-countdown" aria-live="assertive">
      <span key={digit} class="hf-countdown-digit">
        {digit}
      </span>
    </div>
  );
}

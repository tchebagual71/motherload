// Toasts (03 §6.2): top of the clear rect under the HUD, at most two, never blocking input.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppController, Toast } from '../../app/types';

const MAX_TOASTS = 2;

export function Toasts({ app }: { app: AppController }): JSX.Element {
  const all = app.state.toasts.value;
  const [now, setNow] = useState(() => performance.now());
  const live = all.filter((t) => t.until > now).slice(-MAX_TOASTS);

  // Re-render when the next visible toast expires (the app may prune the list lazily).
  useEffect(() => {
    const next = live.reduce((m, t) => Math.min(m, t.until), Infinity);
    if (!Number.isFinite(next)) return;
    const id = setTimeout(() => setNow(performance.now()), Math.max(16, next - performance.now()));
    return () => clearTimeout(id);
  });
  useEffect(() => setNow(performance.now()), [all]);

  return (
    <div class="hf-toasts" aria-live="polite">
      {live.map((t: Toast) => (
        <div key={t.id} class={`hf-toast hf-toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

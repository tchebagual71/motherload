// "Restoring graphics…" (04 §5.6; APP-11): the WebGL context is lost (iOS memory pressure, a GPU reset). Pip is
// paused under the `ctxlost` reason; when the renderer rebuilds, the app asks for the resume tap.
import type { JSX } from 'preact';

export function RestoringCard(): JSX.Element {
  return (
    <div class="hf-overlay hf-restoring" role="status" aria-live="polite">
      <div class="hf-panel hf-restoring-card">
        <span class="hf-spinner" aria-hidden="true" />
        <p class="hf-death-title">Restoring graphics…</p>
        <p class="hf-note">Pip is paused. Your game is safe.</p>
      </div>
    </div>
  );
}

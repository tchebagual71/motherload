// Safe Mode (canon §3.15; 04 §4.13; APP-3, APP-5): two boots of one copy died before their first frame.
// "Load previous copy (n min older)" (or, with no older copy, the failing one once more), "Export this save code"
// and "New game (export first)". A failed recovery is said here, not in a toast hidden behind the card.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ageText } from '../../app/notices';
import type { AppController } from '../../app/types';
import { copyTextLater } from '../clipboard';
import { Button } from '../widgets';

export function previousCopyLabel(olderByMs: number | null): string {
  return olderByMs === null ? 'Try this save again' : `Load previous copy (${ageText(olderByMs)} older)`;
}

export function SafeModeCard({ app }: { app: AppController }): JSX.Element {
  const [copied, setCopied] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const info = app.state.safeMode.value;
  // The recovery runs asynchronously: the card goes away on success, or its result lands in `info`.
  useEffect(() => setBusy(false), [info]);
  const recover = (): void => {
    setBusy(true);
    app.start();
  };
  return (
    <div class="hf-overlay hf-safemode" role="alertdialog" aria-label="Safe Mode">
      <div class="hf-panel hf-safe-card">
        <p class="hf-death-title">Safe Mode</p>
        <p class="hf-note">HoleFactory had trouble starting twice in a row. Your save is kept; copy its code before trying anything else.</p>
        <Button kind="primary" big icon="copy" onClick={() => void copyTextLater(app.exportSave()).then(setCopied)}>
          Export this save code
        </Button>
        {copied !== null && <p class="hf-note">{copied ? 'Copied. Keep it somewhere safe.' : 'Could not copy the code.'}</p>}
        <Button disabled={busy} onClick={recover}>
          {previousCopyLabel(info.previousOlderByMs)}
        </Button>
        {info.error && (
          <p class="hf-note hf-note-bad" role="alert">
            {info.error}
          </p>
        )}
        <Button kind="danger" onClick={() => app.newGame()}>
          New game (export first)
        </Button>
      </div>
    </div>
  );
}

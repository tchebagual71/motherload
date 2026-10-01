// Safe Mode (canon §3.15, MVP): two failed boots on one copy. Offers the export code and a new game; the
// app decides what "previous copy" means and can extend this card.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { copyTextLater } from '../clipboard';
import { Button } from '../widgets';

export function SafeModeCard({ app }: { app: AppController }): JSX.Element {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div class="hf-overlay hf-safemode" role="alertdialog" aria-label="Safe Mode">
      <div class="hf-panel hf-safe-card">
        <p class="hf-death-title">Safe Mode</p>
        <p class="hf-note">HoleFactory had trouble starting twice in a row. Your save is kept; copy its code before trying anything else.</p>
        <Button kind="primary" big icon="copy" onClick={() => void copyTextLater(app.exportSave()).then(setCopied)}>
          Copy save code
        </Button>
        {copied !== null && <p class="hf-note">{copied ? 'Copied.' : 'Could not copy the code.'}</p>}
        <Button onClick={() => app.start()}>Try again</Button>
        <Button kind="danger" onClick={() => app.newGame()}>
          New game
        </Button>
      </div>
    </div>
  );
}

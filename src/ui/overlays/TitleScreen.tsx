// Title screen (03 §6.3, §6.7; canon §3.15): outside standalone the install card leads ("Install for full
// screen and safe saves", Add-to-Home steps, export code auto-copied) and "Play in browser" is second.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { copyTextLater } from '../clipboard';
import { isIOS } from '../env';
import { Icon } from '../icons';
import { Button } from '../widgets';

function hasProgress(app: AppController): boolean {
  const w = app.world;
  return w.story.trips > 0 || w.wallet.lifetimeEarned > 0 || w.story.deepestRow > 0;
}

export function TitleScreen({ app }: { app: AppController }): JSX.Element {
  const install = app.state.canInstall.value && !app.state.standalone.value;
  const progress = hasProgress(app);
  const [steps, setSteps] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  const play = (): void => {
    app.unlockAudio();
    app.start();
  };
  const newGame = (): void => {
    if (progress && !confirmNew) {
      setConfirmNew(true);
      return;
    }
    app.unlockAudio();
    app.newGame();
  };
  const onInstall = (): void => {
    setSteps(true);
    // The Add-to-Home flow carries the save across: copy the export code inside this tap (canon §3.15).
    if (progress) void copyTextLater(app.exportSave()).then(setCopied);
  };

  return (
    <div class="hf-overlay hf-title" role="dialog" aria-label="HoleFactory">
      <div class="hf-title-head">
        <h1 class="hf-logo">
          <span class="hf-logo-a">Hole</span>
          <span class="hf-logo-b">Factory</span>
        </h1>
        <p class="hf-tagline">Dig deep. Haul it up. Build the factory.</p>
      </div>
      <div class="hf-title-panel">
        {install ? (
          <>
            <div class="hf-install">
              <div class="hf-install-head">
                <Icon name="phone" size={28} />
                <span>
                  <b>Install for full screen and safe saves</b>
                  <small>Recommended</small>
                </span>
              </div>
              {steps ? <InstallSteps copied={copied} /> : null}
              {!steps && (
                <Button kind="primary" big onClick={onInstall}>
                  Install
                </Button>
              )}
            </div>
            <Button kind="secondary" onClick={play}>
              Play in browser
            </Button>
          </>
        ) : (
          <Button kind="primary" big icon="play" onClick={play}>
            {progress ? 'Continue' : 'Play'}
          </Button>
        )}
        {(progress || !install) && (
          <Button kind={confirmNew ? 'danger' : 'ghost'} onClick={newGame}>
            {confirmNew ? 'Start over? Tap again' : 'New game'}
          </Button>
        )}
      </div>
    </div>
  );
}

function InstallSteps({ copied }: { copied: boolean | null }): JSX.Element {
  const ios = isIOS();
  return (
    <div class="hf-steps">
      <ol>
        {ios ? (
          <>
            <li>
              <Icon name="share" size={20} /> Tap <b>Share</b> in Safari's toolbar
            </li>
            <li>
              <Icon name="save" size={20} /> Choose <b>Add to Home Screen</b>
            </li>
            <li>
              <Icon name="play" size={20} /> Open <b>HoleFactory</b> from your Home Screen
            </li>
          </>
        ) : (
          <>
            <li>
              <Icon name="menu" size={20} /> Open your browser's menu
            </li>
            <li>
              <Icon name="save" size={20} /> Choose <b>Install app</b> or <b>Add to Home screen</b>
            </li>
            <li>
              <Icon name="play" size={20} /> Open <b>HoleFactory</b> from your Home screen
            </li>
          </>
        )}
      </ol>
      {copied === true && <p class="hf-note hf-note-good">Your save is copied: paste it in the app.</p>}
      {copied === false && <p class="hf-note">Export your save from Menu → Saves before switching.</p>}
    </div>
  );
}

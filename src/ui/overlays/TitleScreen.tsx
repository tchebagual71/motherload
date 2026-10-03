// Title screen (03 §6.3, §6.7; canon §3.15; UX review M12): outside standalone the install card leads ("Install
// for full screen and safe saves", Add-to-Home steps, export code auto-copied) and "Play in browser" is second.
// The first standalone launch with no save offers one-tap "Paste save" (Import from Safari) with a paste box and
// file fallback. The logo and cards scroll in a [data-scroll] area (short Safari viewports); the play / new-game
// actions stay pinned below it, so opening the steps can never push them off screen.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { copyTextLater, pasteText } from '../clipboard';
import { isIOS } from '../env';
import { checkExportCode } from '../format';
import { Icon } from '../icons';
import { Button } from '../widgets';
import { UpdateChip } from './UpdateChip';

function hasProgress(app: AppController): boolean {
  const w = app.world;
  return w.story.trips > 0 || w.wallet.lifetimeEarned > 0 || w.story.deepestRow > 0;
}

export function TitleScreen({ app }: { app: AppController }): JSX.Element {
  const install = app.state.canInstall.value && !app.state.standalone.value;
  // Kept for the title's lifetime once offered, so a successful import can say so (the offer itself ends there).
  const [offerPaste, setOfferPaste] = useState(() => app.state.importOffer.peek() && app.state.standalone.peek());
  // An import replaces app.world, which is not a signal: re-render so "Play" becomes "Continue".
  const [, setImports] = useState(0);
  const progress = hasProgress(app);
  const [steps, setSteps] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // The steps (and the copy result under them, which arrives later) open at the bottom of the scroll
  // area: bring them into view.
  useEffect(() => {
    const el = scroller.current;
    if (steps && el) el.scrollTop = el.scrollHeight;
  }, [steps, copied]);

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
      <div class="hf-title-scroll" data-scroll="" ref={scroller}>
        <div class="hf-title-head">
          <h1 class="hf-logo">
            <span class="hf-logo-a">Hole</span>
            <span class="hf-logo-b">Factory</span>
          </h1>
          <p class="hf-tagline">Dig deep. Haul it up. Build the factory.</p>
        </div>
        {offerPaste && <PasteSave app={app} onImported={() => setImports((n) => n + 1)} onSkip={() => setOfferPaste(false)} />}
        {install && (
          <div class="hf-install">
            <div class="hf-install-head">
              <Icon name="phone" size={28} />
              <span>
                <b>Install for full screen and safe saves</b>
                <small>Recommended</small>
              </span>
            </div>
            {steps ? (
              <InstallSteps copied={copied} />
            ) : (
              <Button kind="primary" big onClick={onInstall}>
                Install
              </Button>
            )}
          </div>
        )}
      </div>
      <div class="hf-title-panel">
        <UpdateChip app={app} class="hf-update-title" />
        {install ? (
          <Button kind="secondary" onClick={play}>
            Play in browser
          </Button>
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
              <Icon name="share" size={20} />
              <span class="hf-step-text">Tap <b>Share</b> in Safari's toolbar</span>
            </li>
            <li>
              <Icon name="save" size={20} />
              <span class="hf-step-text">Choose <b>Add to Home Screen</b></span>
            </li>
            <li>
              <Icon name="play" size={20} />
              <span class="hf-step-text">Open <b>HoleFactory</b> from your Home Screen</span>
            </li>
          </>
        ) : (
          <>
            <li>
              <Icon name="menu" size={20} />
              <span class="hf-step-text">Open your browser's menu</span>
            </li>
            <li>
              <Icon name="save" size={20} />
              <span class="hf-step-text">Choose <b>Install app</b> or <b>Add to Home screen</b></span>
            </li>
            <li>
              <Icon name="play" size={20} />
              <span class="hf-step-text">Open <b>HoleFactory</b> from your Home screen</span>
            </li>
          </>
        )}
      </ol>
      {copied === true && <p class="hf-note hf-note-good">Your save is copied: paste it in the app.</p>}
      {copied === false && <p class="hf-note">Export your save from Menu → Saves before switching.</p>}
    </div>
  );
}

type PasteState = { step: 'offer' } | { step: 'busy' } | { step: 'box'; error: string | null } | { step: 'done' };

interface PasteSaveProps {
  app: AppController;
  onImported: () => void;
  onSkip: () => void;
}

/**
 * Import from Safari (canon §3.15; 03 §6.3): one tap reads the clipboard (user-activated readText), then the
 * import dry run. A blocked or empty clipboard opens a paste box (and a file picker for .hfsave files); Skip
 * hides the card for a fresh start.
 */
function PasteSave({ app, onImported, onSkip }: PasteSaveProps): JSX.Element | null {
  const [st, setSt] = useState<PasteState>({ step: 'offer' });
  const [draft, setDraft] = useState('');
  const card = useRef<HTMLDivElement>(null);
  // The paste box opens below the fold on short screens (the title scrolls): bring it into view.
  useEffect(() => {
    if (st.step === 'box') card.current?.scrollIntoView?.({ block: 'nearest' });
  }, [st.step]);

  const importCode = async (raw: string): Promise<void> => {
    const c = checkExportCode(raw);
    if (!c.ok) {
      setSt({ step: 'box', error: c.reason });
      return;
    }
    setSt({ step: 'busy' });
    const r = await app.importSave(c.code);
    if (r.ok) {
      app.toast(r.message ?? 'Save imported', 'good');
      setSt({ step: 'done' });
      onImported();
    } else setSt({ step: 'box', error: r.reason });
  };
  // readText must start inside the tap (user activation); nothing is awaited before it.
  const onPaste = (): void => {
    void pasteText().then((t) => (t ? importCode(t) : setSt({ step: 'box', error: 'Clipboard is empty or blocked: paste the code below.' })));
  };
  const onFile = (e: Event): void => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) void file.text().then(importCode);
  };

  if (st.step === 'done') return <p class="hf-note hf-note-good hf-paste-done">Save imported. Tap Continue.</p>;
  return (
    <div class="hf-install hf-paste-save" ref={card}>
      <div class="hf-install-head">
        <Icon name="save" size={28} />
        <span>
          <b>Coming from Safari?</b>
          <small>Bring the game you started there</small>
        </span>
      </div>
      {st.step === 'box' ? (
        <>
          <textarea
            class="hf-paste"
            data-scroll=""
            rows={3}
            placeholder="Paste a code that starts with HF1:"
            value={draft}
            spellcheck={false}
            autocapitalize="off"
            autocomplete="off"
            onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)}
          />
          {st.error && <p class="hf-note hf-note-bad">{st.error}</p>}
          <div class="hf-buy-row">
            <label class="hf-btn hf-btn-secondary hf-file">
              From file
              <input type="file" accept=".hfsave,text/plain" onChange={onFile} />
            </label>
            <Button kind="primary" disabled={draft.trim() === ''} onClick={() => void importCode(draft)}>
              Import
            </Button>
          </div>
        </>
      ) : (
        <Button kind="primary" big icon="copy" disabled={st.step === 'busy'} onClick={onPaste}>
          {st.step === 'busy' ? 'Checking save…' : 'Paste save'}
        </Button>
      )}
      {st.step !== 'busy' && (
        <Button kind="ghost" onClick={onSkip}>
          Skip
        </Button>
      )}
    </div>
  );
}

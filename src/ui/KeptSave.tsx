// A stored save this build cannot load (04 §4.11: "M0 saves show 'This test save can't be loaded', with export";
// newer files are never overwritten). Boot moved it out of the rotation untouched (save/legacy.ts); these offer its
// code so the player can keep the file: a card on the title the boot it was found, and a section in Menu → Saves
// for as long as it is kept.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { NOTICE } from '../app/notices';
import type { AppController, KeptSave } from '../app/types';
import { canShare, copyTextLater, shareSave } from './clipboard';
import { Icon } from './icons';
import { Button, SectionTitle } from './widgets';

export function keptTitle(kind: KeptSave['kind']): string {
  return kind === 'test' ? NOTICE.testSave : NOTICE.newerSave;
}

export function keptHint(kind: KeptSave['kind']): string {
  return kind === 'test'
    ? "Saves from the M0 test build don't carry over. Yours is kept as it was: copy its code to keep it."
    : 'It is kept as it was, never overwritten: copy its code for the newer version.';
}

/** The kept save's code, or a rejection when it is unreadable (so a copy reports failure, not an empty paste). */
function keptCode(app: AppController): Promise<string> {
  return app.exportKeptSave().then((c) => c ?? Promise.reject(new Error('kept save unreadable')));
}

/** Copy (inside the tap: Safari drops the activation across an await) and, where offered, share as a file. */
function useKeptExport(app: AppController): { msg: { ok: boolean; text: string } | null; copy: () => void; share: () => void } {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const done = (ok: boolean): void => setMsg(ok ? { ok, text: 'Copied. Keep it somewhere safe.' } : { ok, text: 'Could not copy the code.' });
  const copy = (): void => void copyTextLater(keptCode(app)).then(done, () => done(false));
  const share = (): void =>
    void keptCode(app)
      .then((c) => shareSave(c, 'holefactory-kept-save.hfsave'))
      .then(
        (r) => r === 'shared' && setMsg({ ok: true, text: 'Shared.' }),
        () => setMsg({ ok: false, text: 'Could not read the kept save.' }),
      );
  return { msg, copy, share };
}

/** Title card, the boot the save was refused. */
export function KeptSaveCard({ app, kind }: { app: AppController; kind: KeptSave['kind'] }): JSX.Element {
  const { msg, copy } = useKeptExport(app);
  return (
    <div class="hf-install hf-kept-save" role="status">
      <div class="hf-install-head">
        <Icon name="save" size={28} />
        <span>
          <b>{keptTitle(kind)}</b>
          <small class="hf-kept-hint">{keptHint(kind)}</small>
        </span>
      </div>
      <Button kind="secondary" icon="copy" onClick={copy}>
        Copy its save code
      </Button>
      {msg && <p class={msg.ok ? 'hf-note hf-note-good' : 'hf-note hf-note-bad'}>{msg.text}</p>}
    </div>
  );
}

/** Menu → Saves, while a kept save exists. */
export function KeptSaveSection({ app, kind }: { app: AppController; kind: KeptSave['kind'] }): JSX.Element {
  const { msg, copy, share } = useKeptExport(app);
  return (
    <>
      <SectionTitle>Kept save</SectionTitle>
      <p class="hf-note hf-kept-save-note">
        <b>{keptTitle(kind)}.</b> {keptHint(kind)}
      </p>
      <div class="hf-buy-row">
        <Button icon="copy" onClick={copy}>
          Copy code
        </Button>
        {canShare() && (
          <Button icon="share" onClick={share}>
            Share
          </Button>
        )}
      </div>
      {msg && <p class={msg.ok ? 'hf-note hf-note-good' : 'hf-note hf-note-bad'}>{msg.text}</p>}
    </>
  );
}

// Saves (03 §6.7; canon §3.15): export code (copy / share as .hfsave) and import (paste → pre-check →
// overwrite confirm → app.importSave, which validates and dry-runs). A kept save this build cannot load (04 §4.11)
// keeps its own export here.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { BottomSheet } from '../BottomSheet';
import { canShare, copyText, pasteText, shareSave } from '../clipboard';
import { checkExportCode, exportFileName } from '../format';
import { KeptSaveSection } from '../KeptSave';
import { Button, SectionTitle } from '../widgets';

type ImportState = { step: 'edit'; error: string | null } | { step: 'confirm'; code: string } | { step: 'busy' };

export function SavesSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [imp, setImp] = useState<ImportState>({ step: 'edit', error: null });
  const kept = app.state.keptSave.value;

  const makeCode = async (): Promise<string> => {
    const c = code ?? (await app.exportSave());
    setCode(c);
    return c;
  };
  const onShow = async () => {
    setExportMsg(null);
    await makeCode();
  };
  const onCopy = async () => {
    const ok = await copyText(await makeCode());
    setExportMsg(ok ? 'Copied. Keep it somewhere safe.' : 'Could not copy: select the code and copy it by hand.');
  };
  const onShare = async () => {
    const d = new Date();
    const r = await shareSave(await makeCode(), exportFileName(1, d.getFullYear(), d.getMonth() + 1, d.getDate()));
    if (r === 'shared') setExportMsg('Shared.');
  };
  const onPaste = async () => {
    const t = await pasteText();
    if (t) setDraft(t);
    else setImp({ step: 'edit', error: 'Clipboard is empty or blocked: long-press the box and paste.' });
  };
  const onCheck = () => {
    const c = checkExportCode(draft);
    setImp(c.ok ? { step: 'confirm', code: c.code } : { step: 'edit', error: c.reason });
  };
  const onImport = async (c: string) => {
    setImp({ step: 'busy' });
    const r = await app.importSave(c);
    if (r.ok) {
      app.toast(r.message ?? 'Save imported', 'good');
      close();
    } else setImp({ step: 'edit', error: r.reason });
  };

  return (
    <BottomSheet
      title="Saves"
      icon="save"
      onClose={close}
      leaving={leaving}
      footer={
        <Button kind="primary" big onClick={close}>
          Done
        </Button>
      }
    >
      <p class="hf-note">Your game saves itself. Export a code to move it to another browser or keep a backup.</p>

      <SectionTitle>Export</SectionTitle>
      {code !== null && (
        <pre class="hf-code" data-scroll="">
          {code}
        </pre>
      )}
      <div class="hf-buy-row">
        {code === null && <Button onClick={onShow}>Show</Button>}
        <Button icon="copy" onClick={onCopy}>
          Copy
        </Button>
        {canShare() && (
          <Button icon="share" onClick={onShare}>
            Share
          </Button>
        )}
      </div>
      {exportMsg && <p class="hf-note hf-note-good">{exportMsg}</p>}

      <SectionTitle>Import</SectionTitle>
      <textarea
        class="hf-paste"
        data-scroll=""
        rows={3}
        placeholder="Paste a code that starts with HF1:"
        value={draft}
        spellcheck={false}
        autocapitalize="off"
        autocomplete="off"
        onInput={(e) => {
          setDraft((e.currentTarget as HTMLTextAreaElement).value);
          if (imp.step !== 'busy') setImp({ step: 'edit', error: null });
        }}
      />
      {imp.step === 'confirm' ? (
        <div class="hf-confirm" role="alert">
          <p>This replaces your current game. There is no undo.</p>
          <div class="hf-buy-row">
            <Button onClick={() => setImp({ step: 'edit', error: null })}>Cancel</Button>
            <Button kind="danger" onClick={() => onImport(imp.code)}>
              Replace my game
            </Button>
          </div>
        </div>
      ) : (
        <div class="hf-buy-row">
          <Button onClick={onPaste}>Paste</Button>
          <Button kind="secondary" disabled={imp.step === 'busy' || draft.trim() === ''} onClick={onCheck}>
            {imp.step === 'busy' ? 'Checking…' : 'Import'}
          </Button>
        </div>
      )}
      {imp.step === 'edit' && imp.error && <p class="hf-note hf-note-bad">{imp.error}</p>}

      {kept && <KeptSaveSection app={app} kind={kept.kind} />}
    </BottomSheet>
  );
}

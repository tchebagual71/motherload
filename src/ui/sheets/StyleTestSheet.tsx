// Style test (03 §9.4; canon §5.1, §5.5; INT-4, UI-4): a gallery of six time-frozen bookmarks with a 64-pt Flip
// button, then the 1–5 questionnaire and "Which look should ship?", exported with the Perf Report as one paste
// code. Looks are named A / B by seed parity so the test stays blind. Reached from the A/B chip (long-press) and
// Settings → About → Look test, in every build.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { lsKey } from '../../platform/channel';
import { local, readJson, writeJson } from '../../platform/storage';
import { BottomSheet } from '../BottomSheet';
import { copyTextLater } from '../clipboard';
import { Icon } from '../icons';
import {
  abLabel,
  emptyAnswers,
  encodeStyleResult,
  lookOf,
  sanitizeAnswers,
  STYLE_BOOKMARK_LABELS,
  STYLE_QUESTIONS,
  type AbLabel,
  type ShipChoice,
  type StyleAnswers,
} from '../styleTest';
import { Button, Segmented, SectionTitle } from '../widgets';

const ANSWERS_KEY = 'styletest';
const RATINGS = ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }));
const SHIP = [
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'both', label: 'Both' },
] as const;

function loadAnswers(): StyleAnswers {
  return sanitizeAnswers(readJson<unknown>(local, lsKey(ANSWERS_KEY)));
}

export function StyleTestSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  const [mode, setMode] = useState<'gallery' | 'questions'>('gallery');
  return mode === 'gallery' ? (
    <Gallery app={app} close={close} leaving={leaving} onQuestions={() => setMode('questions')} />
  ) : (
    <Questions app={app} close={close} leaving={leaving} onGallery={() => setMode('gallery')} />
  );
}

interface ModeProps {
  app: AppController;
  close: () => void;
  leaving?: boolean;
}

function Gallery({ app, close, leaving, onQuestions }: ModeProps & { onQuestions: () => void }): JSX.Element {
  const [mark, setMark] = useState(0);
  useEffect(() => app.styleBookmark(mark), [mark]);
  const seed = app.world.seed;
  const label = abLabel(app.state.look.value, seed);
  const other: AbLabel = label === 'A' ? 'B' : 'A';
  return (
    <div class={leaving ? 'hf-gallery hf-leaving' : 'hf-gallery'} role="dialog" aria-label="Look test gallery">
      <header class="hf-gallery-head">
        <button type="button" class="hf-close" aria-label="Close" onClick={close}>
          <Icon name="close" size={22} />
        </button>
        <h2 class="hf-sheet-title">Look test</h2>
        <Button onClick={onQuestions}>Questions</Button>
      </header>
      <div class="hf-gallery-marks" role="radiogroup" aria-label="Views" data-scroll="">
        {STYLE_BOOKMARK_LABELS.map((name, i) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={mark === i}
            class={mark === i ? 'hf-mark hf-on' : 'hf-mark'}
            onClick={() => setMark(i)}
          >
            <b>{i + 1}</b> {name}
          </button>
        ))}
      </div>
      <div class="hf-gallery-foot">
        <button type="button" class="hf-flip" onClick={() => app.setLook(lookOf(other, seed))}>
          <span class="hf-flip-now">{label}</span>
          <Icon name="flip" size={24} />
          <span>Flip to {other}</span>
        </button>
      </div>
    </div>
  );
}

function Questions({ app, close, leaving, onGallery }: ModeProps & { onGallery: () => void }): JSX.Element {
  const [answers, setAnswers] = useState<StyleAnswers>(loadAnswers);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const seed = app.world.seed;
  useEffect(() => void writeJson(local, lsKey(ANSWERS_KEY), answers), [answers]);
  const update = (f: (a: StyleAnswers) => StyleAnswers): void => setAnswers(f);
  const rate = (which: 'a' | 'b', q: number, v: string): void =>
    update((a) => {
      const list = a[which].slice();
      list[q] = Number(v);
      return { ...a, [which]: list };
    });
  const makeCode = async (): Promise<string> => {
    const perf = await app.perfReport();
    const c = encodeStyleResult({ v: 1, build: __HF_VERSION__, seed, aIs: lookOf('A', seed), answers, perf });
    setCode(c);
    return c;
  };
  return (
    <BottomSheet
      title="Look test"
      icon="help"
      onClose={close}
      leaving={leaving}
      footer={
        <Button kind="primary" big icon="copy" onClick={() => void copyTextLater(makeCode()).then(setCopied)}>
          Copy result code
        </Button>
      }
    >
      <p class="hf-note">Rate each look from 1 (poor) to 5 (great). Flip between A and B in the gallery as often as you like.</p>
      <Button icon="flip" onClick={onGallery}>
        Back to the gallery
      </Button>
      {STYLE_QUESTIONS.map((q, i) => (
        <div key={q} class="hf-question">
          <SectionTitle>{q}</SectionTitle>
          <Segmented<string> label="A" value={String(answers.a[i])} options={RATINGS} onChange={(v) => rate('a', i, v)} />
          <Segmented<string> label="B" value={String(answers.b[i])} options={RATINGS} onChange={(v) => rate('b', i, v)} />
        </div>
      ))}
      <SectionTitle>Which look should ship?</SectionTitle>
      <Segmented<ShipChoice | ''> label="Ship" value={answers.ship ?? ''} options={SHIP} onChange={(v) => update((a) => ({ ...a, ship: v || null }))} />
      <textarea
        class="hf-paste"
        data-scroll=""
        rows={2}
        placeholder="Anything else? (optional)"
        value={answers.note}
        onInput={(e) => {
          const note = (e.currentTarget as HTMLTextAreaElement).value.slice(0, 500);
          update((a) => ({ ...a, note }));
        }}
      />
      {code !== null && (
        <pre class="hf-code" data-scroll="">
          {code}
        </pre>
      )}
      {copied !== null && (
        <p class={copied ? 'hf-note hf-note-good' : 'hf-note'}>{copied ? 'Copied with the Perf Report: send it over.' : 'Could not copy: select the code above.'}</p>
      )}
      <Button kind="ghost" onClick={() => update(emptyAnswers)}>
        Clear answers
      </Button>
    </BottomSheet>
  );
}

// Settings (03 §6.7, §12 defaults): display, controls, assists (01 §6.4), audio and About (Perf Report, jetsam
// probe, look test; INT-1, UI-4).
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { isAssisted } from '../../app/settings';
import type { AppController, Settings } from '../../app/types';
import { inScope, SCOPE } from '../../config/scope';
import type { Look } from '../../shared/types';
import { BottomSheet } from '../BottomSheet';
import { copyTextLater } from '../clipboard';
import { Button, Segmented, SectionTitle, Switch } from '../widgets';

const LOOKS = [
  { value: 'toon', label: 'Clean Toon' },
  { value: 'pixel', label: 'Pixel Lab' },
] as const;
const SIZES = [
  { value: 'S', label: 'S' },
  { value: 'M', label: 'M' },
  { value: 'L', label: 'L' },
] as const;
const QUALITY = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
  { value: 'high', label: 'High' },
] as const;
/** Text scale (canon §3.12): 100 / 115 % in the MVP; 130 % is v1. */
const TEXT_SCALES = [
  { value: '1', label: '100%' },
  { value: '1.15', label: '115%' },
] as const;
const THRUST_MODES = [
  { value: 'hold', label: 'Hold' },
  { value: 'toggle', label: 'Toggle' },
] as const;
const RETURN_TICK = [
  { value: 'training', label: 'Training' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

/** The jetsam probe page (04 §10.4), opened in this context so its result reaches the Perf Report. */
export const JETSAM_URL = './jetsam.html';

export function SettingsSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  const s = app.state.settings.value;
  const look = app.state.look.value;
  const set = (patch: Partial<Settings>) => app.updateSettings(patch);
  const assisted = isAssisted(s);
  // Text scale, one-handed, THRUST toggle, assists and the Return Tick are MVP rows (canon §5.5).
  const mvp = inScope('mvp');
  return (
    <BottomSheet
      title="Settings"
      icon="gear"
      onClose={close}
      leaving={leaving}
      footer={
        <Button kind="primary" big onClick={close}>
          Done
        </Button>
      }
    >
      <SectionTitle>Display</SectionTitle>
      <Segmented<Look> label="Look" value={look} options={LOOKS} onChange={(v) => app.setLook(v)} />
      <Segmented<Settings['quality']> label="Quality" value={s.quality} options={QUALITY} onChange={(v) => set({ quality: v })} />
      {mvp && (
        <Segmented<'1' | '1.15'>
          label="Text size"
          value={s.textScale === 1.15 ? '1.15' : '1'}
          options={TEXT_SCALES}
          onChange={(v) => set({ textScale: v === '1.15' ? 1.15 : 1 })}
        />
      )}
      <Switch label="Battery mode" hint="30 fps, fewer particles" value={s.batterySaver === true} onChange={(v) => set({ batterySaver: v })} />
      <Switch label="Bright Mines" hint="Lifts the darkness underground" value={s.brightMines} onChange={(v) => set({ brightMines: v })} />
      <Switch label="Reduced motion" hint="No shake, squash or camera shots" value={s.reducedMotion} onChange={(v) => set({ reducedMotion: v })} />
      <Switch label="Performance HUD" hint="fps, frame time, draw calls" value={s.showPerf} onChange={(v) => set({ showPerf: v })} />

      <SectionTitle>Controls</SectionTitle>
      <Segmented<Settings['controlSize']> label="Control size" value={s.controlSize} options={SIZES} onChange={(v) => set({ controlSize: v })} />
      <Switch label="Left-handed" hint="Stick on the right, slots on the left" value={s.leftHanded} onChange={(v) => set({ leftHanded: v })} />
      {mvp && (
        <Switch
          label="One-handed"
          hint="Steer from a ring under Pip; tap next to Pip to dig"
          value={s.oneHanded}
          onChange={(v) => set({ oneHanded: v })}
        />
      )}
      <Switch label="THRUST button" hint="A button for full thrust" value={s.thrustButton} onChange={(v) => set({ thrustButton: v })} />
      {mvp && s.thrustButton && (
        <Segmented<Settings['thrustMode']> label="THRUST works by" value={s.thrustMode} options={THRUST_MODES} onChange={(v) => set({ thrustMode: v })} />
      )}
      {mvp && (
        // 03 §4.3: placements commit when the finger lifts; belt painting and Bulldoze still wait for ✓.
        <Switch
          label="Instant build"
          hint="Pieces place on lift, no ✓; belt paths and Bulldoze still ask"
          value={s.instantBuild === true}
          onChange={(v) => set({ instantBuild: v })}
        />
      )}

      {mvp && <Assists s={s} set={set} assisted={assisted} />}

      <SectionTitle>Audio</SectionTitle>
      <Switch label="Sound" value={s.sound} onChange={(v) => set({ sound: v })} />
      <Switch label="Music" hint="Kettle On, up on the Rim" value={s.music} onChange={(v) => set({ music: v })} />
      {mvp && (
        // 03 §11.5, §12: the radio's blip voices (default on); the cards still type without them.
        <Switch label="Voice blips" hint="Radio voices chirp as a card types" value={s.voiceBlips} onChange={(v) => set({ voiceBlips: v })} />
      )}
      <Switch
        label="Respect silent switch"
        hint="Mute when the iPhone ring switch is off"
        value={s.respectSilent}
        onChange={(v) => set({ respectSilent: v })}
      />

      <SectionTitle>About</SectionTitle>
      <About app={app} />
    </BottomSheet>
  );
}

/** Assists (01 §6.4) and the Return Tick (01 §3.5; canon §4.4). */
function Assists({ s, set, assisted }: { s: Settings; set: (p: Partial<Settings>) => void; assisted: boolean }): JSX.Element {
  return (
    <>
      <SectionTitle>Assists</SectionTitle>
      <Switch
        label="Landing Assist"
        hint="Brakes long falls to a safe speed when you let go"
        value={s.landingAssist}
        onChange={(v) => set({ landingAssist: v })}
      />
      <Switch label="Steady Drill" hint="Hold a little longer before a dig starts" value={s.steadyDrill} onChange={(v) => set({ steadyDrill: v })} />
      <Segmented<Settings['returnTick']> label="Return Tick" value={s.returnTick} options={RETURN_TICK} onChange={(v) => set({ returnTick: v })} />
      <p class="hf-note">
        The tick on the fuel bar marks the fuel to climb home at your load; the bar turns red when you are short.{' '}
        {assisted ? 'Assists keep it on.' : 'Training shows it until your first Jug tank or 10 trips.'}
      </p>
    </>
  );
}

function About({ app }: { app: AppController }): JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const onPerf = (): void => {
    // Copy inside the tap (Safari drops the activation across an await): the code is still being made.
    const report = app.perfReport();
    void report.then(setCode);
    void copyTextLater(report).then(setCopied);
  };
  return (
    <div class="hf-about">
      <p class="hf-note">
        HoleFactory {__HF_VERSION__} · {SCOPE.toUpperCase()}
      </p>
      <Button icon="copy" onClick={onPerf}>
        Copy Perf Report
      </Button>
      {code !== null && (
        <pre class="hf-code" data-scroll="">
          {code}
        </pre>
      )}
      {copied !== null && (
        <p class={copied ? 'hf-note hf-note-good' : 'hf-note'}>{copied ? 'Copied: paste it into your message.' : 'Could not copy: select the code above.'}</p>
      )}
      <div class="hf-buy-row">
        <a class="hf-btn hf-btn-secondary" href={JETSAM_URL}>
          Jetsam probe
        </a>
        <Button onClick={() => app.openSheet('styletest')}>Look test</Button>
      </div>
      <p class="hf-note">Fonts: Fredoka, Nunito and Pixelify Sans (SIL Open Font License).</p>
    </div>
  );
}

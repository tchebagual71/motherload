// Settings (03 §6.7, §12 defaults): look, controls, display, audio, perf HUD.
import type { JSX } from 'preact';
import type { AppController, Settings } from '../../app/types';
import type { Look } from '../../shared/types';
import { BottomSheet } from '../BottomSheet';
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

export function SettingsSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  const s = app.state.settings.value;
  const look = app.state.look.value;
  const set = (patch: Partial<Settings>) => app.updateSettings(patch);
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
      <Switch label="Battery mode" hint="30 fps, fewer particles" value={s.batterySaver === true} onChange={(v) => set({ batterySaver: v })} />
      <Switch label="Bright Mines" hint="Lifts the darkness underground" value={s.brightMines} onChange={(v) => set({ brightMines: v })} />
      <Switch label="Reduced motion" hint="No shake, squash or camera shots" value={s.reducedMotion} onChange={(v) => set({ reducedMotion: v })} />
      <Switch label="Performance HUD" hint="fps, frame time, draw calls" value={s.showPerf} onChange={(v) => set({ showPerf: v })} />

      <SectionTitle>Controls</SectionTitle>
      <Segmented<Settings['controlSize']> label="Control size" value={s.controlSize} options={SIZES} onChange={(v) => set({ controlSize: v })} />
      <Switch label="Left-handed" hint="Stick on the right, slots on the left" value={s.leftHanded} onChange={(v) => set({ leftHanded: v })} />
      <Switch label="THRUST button" hint="Hold a button for full thrust" value={s.thrustButton} onChange={(v) => set({ thrustButton: v })} />

      <SectionTitle>Audio</SectionTitle>
      <Switch label="Sound" value={s.sound} onChange={(v) => set({ sound: v })} />
      <Switch
        label="Respect silent switch"
        hint="Mute when the iPhone ring switch is off"
        value={s.respectSilent}
        onChange={(v) => set({ respectSilent: v })}
      />
    </BottomSheet>
  );
}

// UI entry (04 §7.1): Preact into #ui over the canvas. The root has pointer-events: none; interactive
// parts re-enable them. Root classes carry the look skin (Pixel Lab), handedness, one-handed mode, control size
// and reduced motion, and --hf-ts the text scale (canon §3.12), so CSS does the rest. Reduced motion is the
// setting alone: the OS preference is only its default (03 §12), applied when settings are created.
import { effect, type Signal } from '@preact/signals';
import type { JSX } from 'preact';
import { render } from 'preact';
import type { AppController } from '../app/types';
import { ControlZone } from './Controls';
import { Hud } from './Hud';
import { Countdown } from './overlays/Countdown';
import { DeathCard } from './overlays/DeathCard';
import { FuelVignette } from './overlays/FuelVignette';
import { InterruptCard } from './overlays/InterruptCard';
import { PerfHud } from './overlays/PerfHud';
import { RestoringCard } from './overlays/RestoringCard';
import { SafeModeCard } from './overlays/SafeModeCard';
import { StyleChip } from './overlays/StyleChip';
import { TitleScreen } from './overlays/TitleScreen';
import { Toasts } from './overlays/Toasts';
import { UprightCard } from './overlays/UprightCard';
import { RimUpdateChip } from './overlays/UpdateChip';
import { SheetHost } from './SheetHost';
import { StoryLayer } from './story/StoryLayer';
import './styles.css';
import { createViewport, type Viewport } from './viewport';
import { MapHost } from './map/MapSheet';
import { Ruler } from './map/Ruler';

/** The UI faces declared in styles.css (03 §10.5). Both looks' faces start loading at boot (≈ 45 KB,
 *  precached) instead of on first use, so an A/B flip does not flash the fallback (04 §7.1 preloads). */
const UI_FONTS = ["600 16px 'Fredoka'", "700 16px 'Nunito'", "400 16px 'Pixelify Sans'"] as const;

function loadFonts(): void {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  // Offline before the service worker cached them: the fallback stacks stay (font-display: swap).
  for (const f of UI_FONTS) fonts.load(f).catch(() => {});
}

function Root({ app, vp }: { app: AppController; vp: Signal<Viewport> }): JSX.Element {
  const overlay = app.state.overlay.value;
  const settings = app.state.settings.value;
  // The style-test gallery draws its own frame over a scratch scene: no live HUD or controls under it.
  const inGame = overlay !== 'title' && overlay !== 'upright' && overlay !== 'safemode' && app.state.sheet.value !== 'styletest';
  const chip = app.state.styleTest.value;
  return (
    <>
      <div class="hf-status-scrim" aria-hidden="true" />
      {inGame && (
        <>
          <FuelVignette app={app} />
          <Ruler app={app} vp={vp} />
          <ControlZone app={app} vp={vp} />
          {overlay === 'countdown' && <Countdown app={app} />}
          <Hud app={app} vp={vp} />
          {chip && <StyleChip app={app} />}
          <RimUpdateChip app={app} styleChip={chip} />
          {settings.showPerf && <PerfHud app={app} />}
          <Toasts app={app} />
          <StoryLayer app={app} />
        </>
      )}
      <SheetHost app={app} />
      {overlay === 'ctxlost' && <RestoringCard />}
      <MapHost app={app} />
      {overlay === 'interrupt' && <InterruptCard app={app} vp={vp} />}
      {overlay === 'death' && <DeathCard app={app} />}
      {overlay === 'title' && <TitleScreen app={app} />}
      {overlay === 'safemode' && <SafeModeCard app={app} />}
      {overlay === 'upright' && <UprightCard />}
    </>
  );
}

/** Mount the UI into `root` (#ui). Returns an unmount function. */
export function mountUI(root: HTMLElement, app: AppController): () => void {
  root.classList.add('hf-ui');
  loadFonts();
  const viewport = createViewport(root);
  const stopClasses = effect(() => {
    const s = app.state.settings.value;
    const cl = root.classList;
    cl.toggle('hf-pixel', app.state.look.value === 'pixel');
    cl.toggle('hf-left', s.leftHanded);
    cl.toggle('hf-one-handed', s.oneHanded);
    cl.toggle('hf-reduced', s.reducedMotion);
    root.style.setProperty('--hf-ts', String(s.textScale));
    cl.remove('hf-size-S', 'hf-size-M', 'hf-size-L');
    cl.add(`hf-size-${s.controlSize}`);
  });
  render(<Root app={app} vp={viewport.vp} />, root);
  return () => {
    render(null, root);
    stopClasses();
    viewport.dispose();
    root.classList.remove('hf-ui', 'hf-pixel', 'hf-left', 'hf-one-handed', 'hf-reduced', 'hf-size-S', 'hf-size-M', 'hf-size-L');
    root.style.removeProperty('--hf-ts');
  };
}

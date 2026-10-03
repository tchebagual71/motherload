// Depth ruler (canon §3.12; 03 §4.11): a 24-pt rail mapping the mine (MVP rows 0–320) onto its height, tinted
// in band colours, with the Rim, band marks, the deepest row, discovered lodes (orange diamonds), Dot's survey
// pings (pulsing rings), map-layer marks (lifts, mustard) and the pod. Play: tap → map. Build: the hit strip
// shrinks to the rail, which ends above the dock band; a drag on it scrubs the Mine build camera (to the
// discovered rows + 4) and a bracket shows the view's row. Re-renders with hudTick.
import type { Signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { STRATA } from '../../render/palette';
import type { BuildSession } from '../build/session';
import { formatDepth } from '../format';
import type { Viewport } from '../viewport';
import { scopeFloorRow } from '../../terrain/scope';
import { knownLodes, mapLayers, worldPurityKnown } from './mapModel';
import { RULER_RAIL, buildRulerGeometry, railBands, railToRow, rulerGeometry } from './rulerLayout';
import { scrubBuildCamera } from './rulerScrub';

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Percentage down the rail for a row. */
function at(row: number, floor: number): string {
  return `${(Math.max(0, Math.min(floor, row)) / floor) * 100}%`;
}

export function Ruler({ app, vp, build = null }: { app: AppController; vp: Signal<Viewport>; build?: BuildSession | null }): JSX.Element | null {
  app.state.hudTick.value; // ≤ 10 Hz refresh
  build?.version.value; // build mode state (plane)
  build?.cursorVersion.value; // the build camera moved (the view bracket)
  const s = app.state.settings.value;
  const v = vp.value;
  const scrubbing = useRef<number | null>(null);
  if (v.w === 0) return null;
  const play = app.state.mode.value === 'play';
  const scrub = !play && build !== null && build.active ? build : null;
  const g = play ? rulerGeometry(v, s) : buildRulerGeometry(v, s);
  const world = app.world;
  const floor = scopeFloorRow(world.scope);
  const podRow = Math.max(0, -world.pod.y);
  // The UI harness's fake world has no terrain.
  const lodes = world.terrain ? knownLodes(world.terrain.lodes, world.scope, world.story.deepestRow, worldPurityKnown(world)) : [];
  const railLeft = g.side === 'right' ? g.railX0 - g.hitX0 : 0;
  const bands = railBands(floor);
  const view = scrub && scrub.plane === 'mine' ? scrub.cam.cy : null;

  /** Build mode: aim the Mine camera at the row under the finger. */
  const scrubTo = (e: PointerEvent): void => {
    if (!scrub) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    scrubBuildCamera(scrub, railToRow(e.clientY, floor, r.top, r.top + r.height), world.story.deepestRow);
  };
  const down = (e: PointerEvent): void => {
    if (!scrub || scrubbing.current !== null) return;
    scrubbing.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
    scrubTo(e);
  };
  const move = (e: PointerEvent): void => {
    if (scrubbing.current === e.pointerId) scrubTo(e);
  };
  const up = (e: PointerEvent): void => {
    if (scrubbing.current !== e.pointerId) return;
    scrubbing.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <button
      type="button"
      class={`hf-ruler hf-ruler-${g.side}${play ? '' : ' hf-ruler-build'}`}
      data-tap=""
      aria-label={
        scrub ? `Depth ${formatDepth(Math.floor(view ?? podRow))}. Drag to move the view` : `Depth ${formatDepth(Math.floor(podRow))}. Open the map`
      }
      style={{ left: `${g.hitX0}px`, top: `${g.top}px`, width: `${g.hitX1 - g.hitX0}px`, height: `${g.bottom - g.top}px` }}
      onClick={() => play && app.openSheet('map')}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <span class="hf-ruler-rail" style={{ left: `${railLeft}px`, width: `${RULER_RAIL}px` }} aria-hidden="true">
        {bands.map(([a, b, i]) => (
          <i key={i} class="hf-ruler-band" style={{ top: at(a, floor), height: at(b - a, floor), background: hex(STRATA[i].front) }} />
        ))}
        {bands.slice(1).map(([a]) => (
          <i key={`t${a}`} class="hf-ruler-tick" style={{ top: at(a, floor) }} />
        ))}
        <i class="hf-ruler-rim" />
        <i class="hf-ruler-deepest" style={{ top: at(world.story.deepestRow, floor) }} />
        {mapLayers().flatMap((layer) =>
          (layer.rulerRows?.() ?? []).map((m, k) => <i key={`${layer.id}${k}`} class="hf-ruler-mark" style={{ top: at(m.row, floor), background: m.colour }} />),
        )}
        {lodes.map((l) =>
          l.discovered ? (
            <i key={l.id} class="hf-ruler-lode" style={{ top: at(l.cr, floor) }} />
          ) : (
            <i key={l.id} class="hf-ruler-ping" style={{ top: at(l.cr, floor) }} />
          ),
        )}
        <i class="hf-ruler-pod" style={{ top: at(podRow, floor) }} />
        {view !== null && <i class="hf-ruler-view" style={{ top: at(view, floor) }} />}
      </span>
    </button>
  );
}

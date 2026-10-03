// Map sheet (SheetId 'map'; 03 §6.6 MVP basic map): the canvas, the tapped marker's card and "Center on pod".
// MapHost mounts it from the UI root (with the same exit animation as SheetHost), so the shared sheet registry
// needs no entry.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { closeCurrentSheet } from '../actions';
import { BottomSheet } from '../BottomSheet';
import { formatDepth } from '../format';
import { Button } from '../widgets';
import { MapCanvas, type MapSelection } from './MapCanvas';

/** Matches the sheet exit animation (SheetHost). */
const EXIT_MS = 180;

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function SelectionCard({ sel }: { sel: MapSelection | null }): JSX.Element {
  if (!sel) return <p class="hf-map-hint">Tap a marker. Pinch to zoom, drag to pan.</p>;
  if (sel.kind === 'pod') {
    return (
      <div class="hf-map-card">
        <span class="hf-map-swatch hf-map-swatch-pod" aria-hidden="true" />
        <span class="hf-map-card-text">
          <b>Pip</b>
          <span>{sel.row > 0 ? `${formatDepth(sel.row)} down` : 'On the Rim'}</span>
        </span>
      </div>
    );
  }
  const l = sel.lode;
  return (
    <div class="hf-map-card">
      <span class="hf-map-swatch" style={l.colour === null ? undefined : { background: hex(l.colour) }} aria-hidden="true">
        <b>{l.letter}</b>
      </span>
      <span class="hf-map-card-text">
        <b>{l.title}</b>
        <span>{l.detail}</span>
      </span>
    </div>
  );
}

export function MapSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  const [sel, setSel] = useState<MapSelection | null>(null);
  const centre = useRef<(() => void) | null>(null);
  return (
    <BottomSheet
      title="Map"
      onClose={close}
      leaving={leaving}
      class="hf-map-sheet"
      footer={
        <div class="hf-map-foot">
          <SelectionCard sel={sel} />
          <Button kind="primary" onClick={() => centre.current?.()}>
            Center on Pip
          </Button>
        </div>
      }
    >
      <MapCanvas app={app} onSelect={setSel} centreRef={centre} />
    </BottomSheet>
  );
}

/** Shows MapSheet while app.state.sheet is 'map' (hidden under the title, upright and Safe Mode screens). */
export function MapHost({ app }: { app: AppController }): JSX.Element | null {
  const overlay = app.state.overlay.value;
  const covered = overlay === 'title' || overlay === 'upright' || overlay === 'safemode';
  const wanted = !covered && app.state.sheet.value === 'map';
  const [shown, setShown] = useState(wanted);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (wanted) {
      setShown(true);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const t = setTimeout(() => {
      setShown(false);
      setLeaving(false);
    }, EXIT_MS);
    return () => clearTimeout(t);
  }, [wanted]);
  if (!shown) return null;
  return <MapSheet app={app} close={() => closeCurrentSheet(app)} leaving={leaving} />;
}

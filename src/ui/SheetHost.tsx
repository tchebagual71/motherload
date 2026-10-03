// Renders the open sheet (app.state.sheet) with a short exit animation. The debug sheet is loaded on
// demand so it stays out of the main chunk.
import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppController, SheetId } from '../app/types';
import { closeCurrentSheet } from './actions';
import { debugEnabled } from './env';
import { AssaySheet } from './sheets/AssaySheet';
import { CargoSheet } from './sheets/CargoSheet';
import { GarageSheet } from './sheets/GarageSheet';
import { MenuSheet } from './sheets/MenuSheet';
import { PumpSheet } from './sheets/PumpSheet';
import { SavesSheet } from './sheets/SavesSheet';
import { SettingsSheet } from './sheets/SettingsSheet';
import { ShedSheet } from './sheets/ShedSheet';
import { OfficeSheet } from './story/OfficeSheet';
import { StyleTestSheet } from './sheets/StyleTestSheet';

export interface SheetProps {
  app: AppController;
  close: () => void;
  leaving?: boolean;
}

/** Matches the CSS exit animation. */
const EXIT_MS = 180;

const STATIC_SHEETS: Partial<Record<Exclude<SheetId, null>, ComponentType<SheetProps>>> = {
  pump: PumpSheet,
  assay: AssaySheet,
  garage: GarageSheet,
  shed: ShedSheet,
  menu: MenuSheet,
  settings: SettingsSheet,
  saves: SavesSheet,
  cargo: CargoSheet,
  office: OfficeSheet,
  styletest: StyleTestSheet,
};

let debugSheet: ComponentType<SheetProps> | null = null;

function useDebugSheet(wanted: boolean): ComponentType<SheetProps> | null {
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!wanted || debugSheet || !debugEnabled()) return;
    let live = true;
    void import('./sheets/DebugSheet').then((m) => {
      debugSheet = m.DebugSheet;
      if (live) setLoaded((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [wanted]);
  return debugSheet;
}

export function SheetHost({ app }: { app: AppController }): JSX.Element | null {
  const overlay = app.state.overlay.value;
  const wanted = overlay === 'title' || overlay === 'upright' || overlay === 'safemode' ? null : app.state.sheet.value;
  const [shown, setShown] = useState<SheetId>(wanted);
  const [leaving, setLeaving] = useState(false);
  const debug = useDebugSheet(shown === 'debug');

  useEffect(() => {
    if (wanted !== null) {
      setShown(wanted);
      setLeaving(false);
      return;
    }
    if (shown === null) return;
    setLeaving(true);
    const t = setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, EXIT_MS);
    return () => clearTimeout(t);
  }, [wanted]);

  if (shown === null) return null;
  const Sheet = shown === 'debug' ? debug : STATIC_SHEETS[shown];
  if (!Sheet) return null;
  return <Sheet key={shown} app={app} close={() => closeCurrentSheet(app)} leaving={leaving} />;
}

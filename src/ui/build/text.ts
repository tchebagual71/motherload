// Build-mode copy (03 §6.2 toast table, ≤ 40 characters; 02 §9 rung triggers; 03 §4 chips). Pure.
import { BUILDINGS, KIT_METER, RUNGS, kitUnits, type BuildingKind, type Err, type Rung } from '../../factory/api';
import { hasItem, item, kitItemId } from '../../factory/items';
import { formatCash, formatInt } from '../format';

/** "Discover a lode" for U2 (02 §9 trigger column). */
export function rungTrigger(rung: Rung | undefined): string {
  return RUNGS.find((r) => r.id === rung)?.trigger ?? 'a later update';
}

/** "Unlocks: Discover a lode" (03 §6.2 E_LOCKED). */
export function unlockText(rung: Rung | undefined): string {
  return `Unlocks: ${rungTrigger(rung)}`;
}

/** Display name of a cargo Kit id ('belt' → 'Belt Kit', 'liftRail' → 'Lift Rail'). */
export function kitName(kitId: string): string {
  const id = kitItemId(kitId);
  return hasItem(id) ? item(id).name : kitId;
}

/** Item display name ('copperIngot' → 'Copper Ingot'). */
export function itemName(id: string | null | undefined): string {
  return id && hasItem(id) ? item(id).name : (id ?? '');
}

/** Card names (64-pt cards): short forms of 02 §3.1 names. */
const SHORT: Partial<Record<BuildingKind, string>> = {
  bin: 'Bin',
  export: 'Export',
  autoDrill: 'Drill',
  lift: 'Lift',
  headframe: 'Headframe',
};

export function shortName(kind: BuildingKind): string {
  return SHORT[kind] ?? BUILDINGS[kind].name;
}

export function buildingName(kind: BuildingKind): string {
  return BUILDINGS[kind].name;
}

export interface ErrContext {
  /** The piece the check was for (E_COLUMN wording, E_LODE wording). */
  kind?: BuildingKind;
  /** E_LODE: the lode under the ghost already has a drill. */
  lodeHasDrill?: boolean;
}

/** 03 §6.2: the toast (and ghost label) for a 02 §2.5 code. */
export function errText(e: Err, ctx: ErrContext = {}): string {
  switch (e.code) {
    case 'E_LOCKED':
      return unlockText(e.rung);
    case 'E_YARD':
      return 'Outside your Yard';
    case 'E_OCCUPIED':
      return "Something's already here";
    case 'E_SOLID':
      return 'Dig this out first';
    case 'E_UNSEEN':
      return 'Explore here first';
    case 'E_FLOOR':
      return 'Needs a floor';
    case 'E_LODE':
      return ctx.lodeHasDrill ? 'This lode has a drill' : 'Drills sit on a discovered lode';
    case 'E_HEAT':
      return 'Too hot here: needs Mk III';
    case 'E_POD':
      return 'Pip is in the way';
    case 'E_COLUMN':
      return ctx.kind === 'headframe' || e.y === undefined ? 'No Headframe column here' : `Shaft blocked at row ${e.y}`;
    case 'E_ARENA':
      return 'Not in the Hollow Heart';
    case 'E_FUNDS':
      return `Need ${formatCash(e.need ?? 0)} more`;
    case 'E_PARTS':
      return `Need ${formatInt(e.need ?? 0)} ${itemName(e.item) || 'parts'}`;
    case 'E_KIT':
      return `Need ${formatInt(kitsForUnits(e.item ?? '', e.need ?? 0))} ${e.item ? kitName(e.item) : 'Kit'} in cargo`;
    case 'E_STOCKPILE_FULL':
      return 'Stockpile full: build a Bin';
    case 'E_LIMIT':
      return ctx.kind ? 'Too many ghosts (256 max)' : 'That is the limit';
    case 'E_EMPTY':
      return 'Nothing to undo';
    default:
      return "Can't build that here";
  }
}

/** Whole Kits that hold `units` of a (metered) Kit: 9 belt tiles → 2 Belt Kits. */
export function kitsForUnits(kitId: string, units: number): number {
  return Math.ceil(Math.max(0, units) / kitUnits(kitId));
}

/** "16 tiles = 2 Belt Kits" (03 §4.4) / "1 Router Kit". */
export function kitBill(kitId: string, units: number): string {
  const kits = kitsForUnits(kitId, units);
  const name = kitName(kitId);
  const plural = kits === 1 ? name : `${name}s`;
  return KIT_METER[kitId] !== undefined ? `${units} tile${units === 1 ? '' : 's'} = ${kits} ${plural}` : `${kits} ${plural}`;
}

/** Undo toast (03 §4.8): "Undid: Belt ×12 (+$60)". */
export function undoText(verb: 'Undid' | 'Redid', label: string | null, cashDelta: number): string {
  const what = label ?? 'last step';
  const cash = cashDelta === 0 ? '' : ` (${cashDelta > 0 ? '+' : '−'}${formatCash(Math.abs(cashDelta))})`;
  return `${verb}: ${what}${cash}`;
}

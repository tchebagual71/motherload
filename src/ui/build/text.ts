// Build-mode copy (03 §6.2 toast table, ≤ 40 characters; 02 §9 rung triggers; 03 §4 chips). Pure. The refusal
// texts, Kit names and rung triggers have one source, world/factoryText.ts (the pod's ghost refusals use it too);
// this module only adds what build mode knows on top: the piece in hand, whole Kits, the undo wording.
import { BUILDINGS, KIT_METER, type BuildingKind, type Err, type Rung } from '../../factory/api';
import { hasItem, item } from '../../factory/items';
import { errText as refusalText, kitCount, kitName, kitsForUnits, rungTrigger } from '../../world/factoryText';
import { formatCash } from '../format';

export { kitCount, kitName, kitsForUnits, rungTrigger };

/** "Unlocks: Discover a lode" (03 §6.2 E_LOCKED). */
export function unlockText(rung: Rung | undefined): string {
  return `Unlocks: ${rungTrigger(rung)}`;
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
  /** E_LODE / E_OCCUPIED of a drill: the lode under the ghost already has a drill (built, or a ghost). */
  lodeHasDrill?: boolean;
}

/** 03 §6.2: the toast (and ghost label) for a 02 §2.5 code; world/factoryText.ts words it, `ctx` sharpens it. */
export function errText(e: Err, ctx: ErrContext = {}): string {
  switch (e.code) {
    case 'E_LODE':
    case 'E_OCCUPIED':
      if (ctx.lodeHasDrill) return 'This lode has a drill';
      break;
    case 'E_COLUMN':
      if (ctx.kind === 'headframe') return 'No Headframe column here';
      break;
    case 'E_LIMIT':
      if (ctx.kind) return 'Too many ghosts (256 max)';
      break;
    case 'E_EMPTY':
      return 'Nothing to undo';
    default:
      break;
  }
  return refusalText(e);
}

/** "16 tiles = 2 Belt Kits" (03 §4.4) / "1 Router Kit" / "2 Auto-Drill Kits Mk II". */
export function kitBill(kitId: string, units: number): string {
  const kits = kitCount(kitId, kitsForUnits(kitId, units));
  return KIT_METER[kitId] !== undefined ? `${units} tile${units === 1 ? '' : 's'} = ${kits}` : kits;
}

/** Undo toast (03 §4.8): "Undid: Belt ×12 (+$60)". */
export function undoText(verb: 'Undid' | 'Redid', label: string | null, cashDelta: number): string {
  const what = label ?? 'last step';
  const cash = cashDelta === 0 ? '' : ` (${cashDelta > 0 ? '+' : '−'}${formatCash(Math.abs(cashDelta))})`;
  return `${verb}: ${what}${cash}`;
}

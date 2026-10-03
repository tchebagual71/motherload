// Build-mode copy (03 §6.2 toast table, ≤ 40 characters; 02 §9 rung triggers; 03 §4 chips). Pure. The refusal
// texts, Kit names and rung triggers have one source, world/factoryText.ts (the pod's ghost refusals use it too);
// this module only adds what build mode knows on top: the piece in hand, whole Kits, the undo wording.
import { BUILDINGS, KIT_METER, kitUnits, type BuildingKind, type Err, type Rung } from '../../factory/api';
import { hasItem, item } from '../../factory/items';
import { errText as refusalText, kitName, rungTrigger } from '../../world/factoryText';
import { formatCash, formatInt } from '../format';

export { kitName, rungTrigger };

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
  /** E_LODE: the lode under the ghost already has a drill. */
  lodeHasDrill?: boolean;
}

/** 03 §6.2: the toast (and ghost label) for a 02 §2.5 code; world/factoryText.ts words it, `ctx` sharpens it. */
export function errText(e: Err, ctx: ErrContext = {}): string {
  switch (e.code) {
    case 'E_LODE':
      if (ctx.lodeHasDrill) return 'This lode has a drill';
      break;
    case 'E_COLUMN':
      if (ctx.kind === 'headframe') return 'No Headframe column here';
      break;
    case 'E_KIT':
      // The factory counts metered units short; the player buys whole Kits (9 belt tiles → 2 Belt Kits).
      return `Need ${formatInt(kitsForUnits(e.item ?? '', e.need ?? 0))} ${e.item ? kitName(e.item) : 'Kit'} in cargo`;
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

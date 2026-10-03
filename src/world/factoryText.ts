// Player-facing text for factory refusals (03 §6.2 toast table, ≤ 40 characters) and rung triggers (02 §9).
// PURE MODULE.
import { RUNGS, type Err, type GhostView, type Rung } from '../factory/api';
import { hasItem, item, kitItemId } from '../factory/items';
import { grouped } from '../economy/format';

/** "Discover a lode" for U2 (02 §9 trigger column). */
export function rungTrigger(rung: Rung | undefined): string {
  return RUNGS.find((r) => r.id === rung)?.trigger ?? 'a later update';
}

/** Display name of a cargo Kit id ('belt' → 'Belt Kit'). */
export function kitName(kitId: string): string {
  const id = kitItemId(kitId);
  return hasItem(id) ? item(id).name : kitId;
}

function itemName(id: string | undefined): string {
  return id && hasItem(id) ? item(id).name : (id ?? 'parts');
}

/** 03 §6.2: the toast for a 02 §2.5 code. */
export function errText(e: Err): string {
  switch (e.code) {
    case 'E_LOCKED':
      return `Unlocks: ${rungTrigger(e.rung)}`;
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
      return 'Drills sit on a discovered lode';
    case 'E_HEAT':
      return 'Too hot here: needs Mk III';
    case 'E_POD':
      return 'Pip is in the way';
    case 'E_COLUMN':
      return e.y !== undefined ? `Shaft blocked at row ${e.y}` : 'No Headframe column here';
    case 'E_ARENA':
      return 'Not in the Hollow Heart';
    case 'E_FUNDS':
      return `Need $${grouped(e.need ?? 0)} more`;
    case 'E_PARTS':
      return `Need ${grouped(e.need ?? 0)} ${itemName(e.item)}`;
    case 'E_KIT':
      return `Need ${grouped(e.need ?? 0)} ${e.item ? kitName(e.item) : 'Kit'} in cargo`;
    case 'E_STOCKPILE_FULL':
      return 'Stockpile full: build a Bin';
    case 'E_LIMIT':
      return 'That is the limit';
    default:
      return "Can't do that here";
  }
}

/**
 * The toast when the pod's proximity build of job `g` is refused. A Lift Rail section refused at the row just
 * below it has no lift under it yet (02 §2.6): that is not a blocked shaft.
 */
export function ghostRefusalText(g: Pick<GhostView, 'part' | 'y' | 'h'>, e: Err): string {
  if (e.code === 'E_COLUMN' && g.part === 'rail' && e.y === g.y + g.h) return 'Build the lift below first';
  return errText(e);
}

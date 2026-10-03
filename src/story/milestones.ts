// Milestones on Dot's office board (01 §8: the 15 MVP entries; local only, none needs a count above 1).
// PURE MODULE.

export type MilestoneId =
  | 'toppedOff'
  | 'payday'
  | 'basketCase'
  | 'fiveHundredClub'
  | 'oldPing'
  | 'handsOff'
  | 'plated'
  | 'grand'
  | 'clink'
  | 'popGoesTheShale'
  | 'featherfall'
  | 'heavyHauler'
  | 'hotFeet'
  | 'bigIncentive'
  | 'wrongNumber';

export interface MilestoneDef {
  id: MilestoneId;
  title: string;
  /** How it is earned, as the board shows it. */
  how: string;
}

export const MILESTONES: readonly MilestoneDef[] = [
  { id: 'toppedOff', title: 'Topped Off', how: 'Refuel at the Pump House' },
  { id: 'payday', title: 'Payday', how: 'Make your first sale' },
  { id: 'basketCase', title: 'Basket Case', how: 'Buy your first tier-2 upgrade' },
  { id: 'fiveHundredClub', title: 'Five Hundred Club', how: 'Reach 500 ft' },
  { id: 'oldPing', title: 'Old Ping', how: "Find Dot's copper lode" },
  { id: 'handsOff', title: 'Hands Off', how: 'Lift lode ore to a Headframe' },
  { id: 'plated', title: 'Plated', how: 'Make your first Hull Plate' },
  { id: 'grand', title: 'Grand', how: 'Reach 1,000 ft' },
  { id: 'clink', title: 'Clink', how: 'Meet your first Hardrock' },
  { id: 'popGoesTheShale', title: 'Pop Goes the Shale', how: 'Clear Hardrock with a charge' },
  { id: 'featherfall', title: 'Featherfall', how: 'Fall 30 rows and land without a dent' },
  { id: 'heavyHauler', title: 'Heavy Hauler', how: 'Reach the Rim at 90% of your lift limit' },
  { id: 'hotFeet', title: 'Hot Feet', how: 'Survive a Magma breach' },
  { id: 'bigIncentive', title: 'Big Incentive', how: 'Reach 3,500 ft' },
  { id: 'wrongNumber', title: 'Wrong Number', how: 'Hear Channel Zero' },
];

const BY_ID = new Map(MILESTONES.map((m) => [m.id, m]));

export function milestone(id: MilestoneId): MilestoneDef {
  return BY_ID.get(id)!;
}

export function isMilestoneId(id: string): id is MilestoneId {
  return BY_ID.has(id as MilestoneId);
}

/** Featherfall: fall at least this many rows (01 §8). */
export const FEATHERFALL_ROWS = 30;
/** Heavy Hauler: arrive with cargo mass ≥ this share of the hover cap (01 §8). */
export const HEAVY_HAULER_LOAD = 0.9;

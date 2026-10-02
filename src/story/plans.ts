// Co-op Plans: the MVP unlock rungs U0–U3 as Dot's office lists them (02 §9). Rung ids are stable save flags
// (04 §4.8): `rung:<id>` in World.story.flags. The director sets them from the triggers it sees; the factory's
// own 'unlock' events set the same flags. PURE MODULE.

export type RungId = 'U0' | 'U1' | 'U2' | 'U3';

export interface RungDef {
  id: RungId;
  name: string;
  /** Trigger, as the locked entry reads (02 §9: locked entries stay visible). */
  trigger: string;
  unlocks: string;
}

export const MVP_RUNGS: readonly RungDef[] = [
  { id: 'U0', name: 'Survey set', trigger: 'New claim', unlocks: 'Yard 48 × 8, the rusted Headframe, a Storage Bin and a Smelter' },
  { id: 'U1', name: 'Survey ping', trigger: 'Dig past 400 ft', unlocks: "Dot's survey ping marks the copper lode" },
  {
    id: 'U2',
    name: 'Lode works',
    trigger: 'Discover any lode',
    unlocks: 'Auto-Drill, Bucket Lift, Lift Rail, Headframe, Belt, Bin, Smelter, Assay Stockpile, Yard Expansion I',
  },
  { id: 'U3', name: 'Assembly line', trigger: 'Produce your first ingot', unlocks: 'Assembler, Router and Export Terminal' },
];

export const rungFlag = (id: string): string => `rung:${id}`;

/** U0 comes with every claim, including saves from before the flag existed. */
export function isRungUnlocked(flags: Readonly<Record<string, boolean>>, id: RungId): boolean {
  return id === 'U0' || flags[rungFlag(id)] === true;
}

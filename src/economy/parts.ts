// Upgrade parts (canon §2.8, §4.3.5) and the per-tier bill (01 §5.1, which owns the counts). PURE MODULE.
import type { Line } from '../shared/canon';

export const PART_IDS = [
  'gear',
  'wire',
  'hullPlate',
  'coolantCoil',
  'circuit',
  'motor',
  'drillBit',
  'pressureVessel',
  'reactorCore',
  'lens',
  'opalPlating',
  'diamondBit',
] as const;
export type PartId = (typeof PART_IDS)[number];

export const PART_NAMES: Readonly<Record<PartId, string>> = {
  gear: 'Gear',
  wire: 'Wire',
  hullPlate: 'Hull Plate',
  coolantCoil: 'Coolant Coil',
  circuit: 'Circuit',
  motor: 'Motor',
  drillBit: 'Drill Bit',
  pressureVessel: 'Pressure Vessel',
  reactorCore: 'Reactor Core',
  lens: 'Lens',
  opalPlating: 'Opal Plating',
  diamondBit: 'Diamond Bit',
};

export interface PartReq {
  part: PartId;
  n: number;
}

/**
 * Where the Garage draws parts from: the Stockpile (canon §2.8: all Bins and Silos). The factory (MVP)
 * provides the real ledger; until then nothing is stockpiled.
 */
export interface PartsLedger {
  count(part: PartId): number;
  /** Remove `n` parts; callers check `count` first. */
  take(part: PartId, n: number): void;
}

export const EMPTY_PARTS: PartsLedger = {
  count: () => 0,
  take: (part, n) => {
    if (n > 0) throw new Error(`EMPTY_PARTS: cannot take ${n} ${part}`);
  },
};

const req = (...pairs: [number, PartId][]): readonly PartReq[] => pairs.map(([n, part]) => ({ part, n }));
const NONE: readonly PartReq[] = [];

/**
 * 01 §5.1 parts per line, index = tier − 1. t1–t2 are cash only; `null` = the tier does not exist
 * (Radiator t2, Bay t7, Scanner t2 and t4). Includes the ruled Keg, Drill t7 and Scanner t7 bills.
 */
export const UPGRADE_PARTS: Readonly<Record<Line, readonly (readonly PartReq[] | null)[]>> = {
  drill: [
    NONE,
    NONE,
    req([2, 'hullPlate'], [10, 'wire']),
    req([6, 'motor']),
    req([10, 'drillBit']),
    req([6, 'reactorCore'], [9, 'drillBit']),
    req([1, 'diamondBit'], [1, 'reactorCore']),
  ],
  hull: [NONE, NONE, req([5, 'hullPlate']), req([12, 'hullPlate']), req([7, 'pressureVessel']), req([9, 'reactorCore']), req([3, 'opalPlating'])],
  engine: [
    NONE,
    NONE,
    req([2, 'motor'], [5, 'wire']),
    req([5, 'motor'], [2, 'circuit']),
    req([6, 'pressureVessel'], [4, 'circuit']),
    req([10, 'reactorCore']),
    req([2, 'opalPlating'], [10, 'reactorCore']),
  ],
  tank: [
    NONE,
    NONE,
    req([4, 'hullPlate']),
    req([4, 'pressureVessel']),
    req([6, 'pressureVessel']),
    req([8, 'reactorCore']),
    req([8, 'lens'], [6, 'reactorCore']),
  ],
  radiator: [
    NONE,
    null,
    req([4, 'coolantCoil']),
    req([10, 'coolantCoil']),
    req([5, 'pressureVessel'], [6, 'circuit']),
    req([8, 'reactorCore']),
    req([10, 'lens']),
  ],
  bay: [
    NONE,
    NONE,
    req([3, 'hullPlate'], [10, 'wire']),
    req([8, 'hullPlate'], [2, 'motor']),
    req([5, 'pressureVessel'], [4, 'drillBit']),
    req([7, 'reactorCore'], [5, 'pressureVessel']),
    null,
  ],
  scanner: [
    NONE,
    null,
    req([2, 'circuit'], [5, 'wire']),
    null,
    req([10, 'circuit'], [4, 'drillBit']),
    req([8, 'reactorCore'], [6, 'circuit']),
    req([8, 'lens'], [1, 'opalPlating']),
  ],
};

// Upgrade catalogue, scope gating and fees (canon §2.6, §4.2, §4.3.5, §5.5; 01 §5.1, §6.2).
import { describe, expect, it } from 'vitest';
import {
  MAX_TIER,
  UPGRADE_PARTS,
  costToMax,
  installedValue,
  lineInScope,
  nextTier,
  partsFor,
  salvageFee,
  tierExists,
  tierInScope,
  tierName,
  tierPrice,
  tierStat,
  type PartId,
} from '../../src/economy';
import { LINES, type Line } from '../../src/shared/canon';
import type { Scope } from '../../src/shared/types';

const allAt = (tier: number, over: Partial<Record<Line, number>> = {}): Record<Line, number> =>
  ({ ...Object.fromEntries(LINES.map((l) => [l, tier])), ...over }) as Record<Line, number>;

function inScopeTiers(scope: Scope, line: Line): number[] {
  const out: number[] = [];
  for (let t = 1; t <= MAX_TIER; t++) if (tierInScope(scope, line, t)) out.push(t);
  return out;
}

describe('catalogue (canon §2.6)', () => {
  it('names and prices follow the canon table', () => {
    expect(tierName('drill', 1)).toBe('Stub Bit');
    expect(tierName('engine', 4)).toBe('Growler');
    expect(tierName('bay', 6)).toBe('Freight Hold');
    expect(tierName('scanner', 3)).toBe('Dowser');
    expect([1, 2, 3, 4, 5, 6, 7].map(tierPrice)).toEqual([0, 750, 2_000, 5_000, 20_000, 100_000, 500_000]);
  });

  it('missing tiers: Radiator t2, Bay t7, Scanner t2 and t4', () => {
    expect(tierExists('radiator', 2)).toBe(false);
    expect(tierExists('bay', 7)).toBe(false);
    expect(tierExists('scanner', 2)).toBe(false);
    expect(tierExists('scanner', 4)).toBe(false);
    expect(tierExists('drill', 0)).toBe(false);
    expect(tierExists('drill', 8)).toBe(false);
    expect(nextTier('radiator', 1)).toBe(3);
    expect(nextTier('scanner', 3)).toBe(5);
    expect(nextTier('bay', 6)).toBeNull();
  });

  it('cost to max is $3,887,750', () => {
    expect(costToMax()).toBe(3_887_750);
  });

  it('stat strings', () => {
    expect(tierStat('drill', 1)).toBe('0.48 s/tile');
    expect(tierStat('drill', 2)).toBe('0.33 s/tile');
    expect(tierStat('hull', 2)).toBe('17 HP');
    expect(tierStat('engine', 2)).toBe('160 hp · lifts 125');
    expect(tierStat('tank', 2)).toBe('15 L');
    expect(tierStat('radiator', 1)).toBe('×1.0 heat');
    expect(tierStat('radiator', 3)).toBe('×0.9 heat');
    expect(tierStat('bay', 2)).toBe('15 slots');
    expect(tierStat('scanner', 1)).toBe('adjacent lodes');
    expect(tierStat('scanner', 3)).toBe('lodes within 6');
  });
});

describe('scope gating (canon §5.5)', () => {
  it('M0 sells Drill/Engine/Tank/Bay t1–t3 only', () => {
    for (const line of ['drill', 'engine', 'tank', 'bay'] as const) {
      expect(lineInScope('m0', line)).toBe(true);
      expect(inScopeTiers('m0', line)).toEqual([1, 2, 3]);
    }
    for (const line of ['hull', 'radiator', 'scanner'] as const) {
      expect(lineInScope('m0', line)).toBe(false);
      expect(inScopeTiers('m0', line)).toEqual([]);
    }
  });

  it('MVP: six lines t1–t5 plus Tin Ear and Dowser', () => {
    expect(inScopeTiers('mvp', 'drill')).toEqual([1, 2, 3, 4, 5]);
    expect(inScopeTiers('mvp', 'hull')).toEqual([1, 2, 3, 4, 5]);
    expect(inScopeTiers('mvp', 'radiator')).toEqual([1, 3, 4, 5]);
    expect(inScopeTiers('mvp', 'bay')).toEqual([1, 2, 3, 4, 5]);
    expect(inScopeTiers('mvp', 'scanner')).toEqual([1, 3]);
  });

  it('v1: every existing tier', () => {
    expect(inScopeTiers('v1', 'drill')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(inScopeTiers('v1', 'bay')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(inScopeTiers('v1', 'scanner')).toEqual([1, 3, 5, 6, 7]);
  });
});

describe('parts (canon §4.3.5; 01 §5.1)', () => {
  it('M0 is cash only; MVP+ needs parts from t3', () => {
    expect(partsFor('m0', 'drill', 3)).toEqual([]);
    expect(partsFor('mvp', 'drill', 2)).toEqual([]);
    expect(partsFor('mvp', 'drill', 3)).toEqual([
      { part: 'hullPlate', n: 2 },
      { part: 'wire', n: 10 },
    ]);
    expect(partsFor('v1', 'tank', 4)).toEqual([{ part: 'pressureVessel', n: 4 }]);
    expect(partsFor('v1', 'scanner', 7)).toEqual([
      { part: 'lens', n: 8 },
      { part: 'opalPlating', n: 1 },
    ]);
  });

  it('per-tranche bills match the 01 §5.1 totals', () => {
    const tranche = (tier: number): Partial<Record<PartId, number>> => {
      const sum: Partial<Record<PartId, number>> = {};
      for (const line of LINES) for (const r of UPGRADE_PARTS[line][tier - 1] ?? []) sum[r.part] = (sum[r.part] ?? 0) + r.n;
      return sum;
    };
    expect(tranche(3)).toEqual({ wire: 30, hullPlate: 14, coolantCoil: 4, motor: 2, circuit: 2 });
    expect(tranche(4)).toEqual({ hullPlate: 20, motor: 13, coolantCoil: 10, pressureVessel: 4, circuit: 2 });
    expect(tranche(5)).toEqual({ pressureVessel: 29, circuit: 20, drillBit: 18 });
    expect(tranche(6)).toEqual({ reactorCore: 56, drillBit: 9, circuit: 6, pressureVessel: 5 });
    expect(tranche(7)).toEqual({ lens: 26, reactorCore: 17, opalPlating: 6, diamondBit: 1 });
  });

  it('a parts bill exists exactly where the tier exists', () => {
    for (const line of LINES) {
      for (let t = 1; t <= MAX_TIER; t++) expect(UPGRADE_PARTS[line][t - 1] !== null).toBe(tierExists(line, t));
    }
  });
});

describe('salvage fee (canon §4.2; 01 §6.2)', () => {
  it('matches the canon examples', () => {
    expect(salvageFee(allAt(1))).toBe(25);
    expect(salvageFee(allAt(1, { drill: 2, hull: 2, engine: 2, tank: 2, bay: 2 }))).toBe(300);
    expect(salvageFee(allAt(3))).toBe(1_120);
    expect(salvageFee(allAt(4, { scanner: 3 }))).toBe(2_560);
    expect(salvageFee(allAt(5))).toBe(11_200);
    expect(salvageFee(allAt(6))).toBe(56_000);
    expect(salvageFee(allAt(7, { bay: 6 }))).toBe(248_000);
  });

  it('IPV sums installed tier prices', () => {
    expect(installedValue(allAt(1))).toBe(0);
    expect(installedValue(allAt(7, { bay: 6 }))).toBe(3_100_000);
  });
});

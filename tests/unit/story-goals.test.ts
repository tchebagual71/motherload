// Goal chip, Next Goals (01 §2.3, §2.5–2.6; canon §5.2 onboarding beats 1–7) and the trip summary tracker.
import { describe, expect, it } from 'vitest';
import type { Line } from '../../src/shared/canon';
import { nextGoal, nextGoals, type GoalSnapshot, type GoalUpgrade } from '../../src/story/goals';
import { TripTracker } from '../../src/story/trip';

const TIERS: Record<Line, number> = { drill: 1, hull: 1, engine: 1, tank: 1, radiator: 1, bay: 1, scanner: 1 };

function snap(patch: Partial<GoalSnapshot> = {}, flags: string[] = []): GoalSnapshot {
  return {
    scope: 'mvp',
    flags: Object.fromEntries(flags.map((f) => [f, true])),
    podX: 7.5,
    row: 0,
    onRim: true,
    fuelFrac: 0.6,
    cargoUsed: 0,
    baySlots: 7,
    sellable: 0,
    cash: 20,
    deepestRow: 0,
    tiers: { ...TIERS },
    surveyColumn: 20,
    scriptedLodeFound: false,
    ...patch,
  };
}

const text = (s: GoalSnapshot) => nextGoal(s)?.text ?? null;
const DONE_EARLY = ['ms:0:toppedOff', 'ms:1:payday', 'ms:2:basketCase'];
const PINGED = [...DONE_EARLY, 'tx:3:S1', 'tx:4:S2'];
const FOUND = [...PINGED, 'tx:5:S5'];

describe('goal chip: onboarding beats 1–3', () => {
  it('starts with the refuel, then the first dig and sale', () => {
    expect(text(snap())).toBe('Fill up at the Pump House');
    const fuelled = ['ms:0:toppedOff'];
    expect(text(snap({}, fuelled))).toBe('Roll off the pad, then push down');
    expect(text(snap({ onRim: false, row: 3 }, fuelled))).toBe('Push down to dig for ore');
    expect(text(snap({ onRim: false, row: 3, cargoUsed: 2, sellable: 2 }, fuelled))).toBe('Fill your bay, then push up to fly');
    expect(text(snap({ onRim: false, row: 6, cargoUsed: 7, sellable: 7 }, fuelled))).toBe('Bay full — head up');
    expect(text(snap({ cargoUsed: 7, sellable: 7 }, fuelled))).toBe('Sell at the Assay Office');
  });

  it('then the first Garage upgrade, with the cash still to earn', () => {
    const sold = ['ms:0:toppedOff', 'ms:1:payday'];
    expect(nextGoal(snap({ cash: 420 }, sold))).toEqual({ text: 'Earn $750 for a Garage upgrade', progress: '$420' });
    expect(text(snap({ cash: 800 }, sold))).toBe('Upgrade at the Garage');
  });

  it('low fuel underground wins over the script step', () => {
    expect(text(snap({ onRim: false, row: 12, fuelFrac: 0.15 }, DONE_EARLY))).toBe('Fuel low: the tick shows your way home');
  });
});

describe('goal chip: beats 4–7', () => {
  it('500 ft, then Dot’s shaft (braking at the mouth), then the Starter Kit', () => {
    expect(nextGoal(snap({ deepestRow: 12 }, DONE_EARLY))).toEqual({ text: 'Dig to 500 ft for a $1,000 bonus', progress: '150 ft' });
    expect(text(snap({ podX: 5 }, PINGED))).toBe("Follow Dot's shaft down to her lode");
    expect(text(snap({ podX: 21.4 }, PINGED))).toBe("Dot's shaft: long drop. Hold ↑ to brake");
    expect(text(snap({ scriptedLodeFound: true }, FOUND))).toBe('Collect your Starter Kit at the Shed');
  });

  it('walks the factory steps of 01 §2.6 as their facts arrive', () => {
    const kit = [...FOUND, 'ob:kit'];
    const s = (row: number, extra: string[]) => text(snap({ scriptedLodeFound: true, row, onRim: row === 0 }, [...kit, ...extra]));
    expect(s(0, [])).toBe('Dig down at the chevrons');
    expect(s(45, [])).toBe('Place the drill on the lode');
    expect(s(45, ['ob:drill'])).toBe("Hang the lift in Dot's shaft");
    expect(s(30, ['ob:drill', 'ob:lift'])).toBe('Belt the drill to the lift');
    expect(s(0, ['ob:drill', 'ob:lift', 'ob:belt'])).toBe('Belt the Headframe to the Smelter');
    expect(s(0, ['ob:drill', 'ob:lift', 'ob:belt', 'tx:9:S6', 'ob:ingot'])).toBe('Build an Assembler: Wire');
    expect(s(0, ['ob:drill', 'ob:lift', 'ob:belt', 'tx:9:S6', 'ob:ingot', 'ob:assembler'])).toBe('Stockpile iron and cobalt');
    expect(s(0, ['ob:drill', 'ob:lift', 'ob:belt', 'tx:9:S6', 'ob:ingot', 'ob:assembler', 'ms:10:plated'])).toBe('Buy a tier-3 upgrade with parts');
  });

  it('after the first t3 the chip points at the next depth bonus; M0 has no chip', () => {
    const all = [...FOUND, 'ob:kit', 'ob:drill', 'ob:lift', 'ob:belt', 'tx:9:S6', 'ob:ingot', 'ob:assembler', 'ms:10:plated'];
    const t3 = { ...TIERS, drill: 3 };
    expect(nextGoal(snap({ tiers: t3, deepestRow: 50, scriptedLodeFound: true }, all))).toEqual({ text: 'Dig to 1,000 ft for a $3,000 bonus', progress: '625 ft' });
    expect(nextGoal(snap({ tiers: t3, deepestRow: 300, scriptedLodeFound: true }, all))).toBeNull();
    expect(nextGoal(snap({ scope: 'm0' }))).toBeNull();
  });
});

describe('Next Goals (≤ 3)', () => {
  const card = (line: Line, name: string, price: number, blocker: string | null, parts: GoalUpgrade['parts'] = []): GoalUpgrade => ({
    line,
    name,
    price,
    available: true,
    blocker,
    parts,
  });

  it('lists the chip, the cheapest ready upgrade and the lode', () => {
    const goals = nextGoals(snap({ cash: 900 }, PINGED), [card('drill', 'Corkscrew', 750, null), card('bay', 'Basket', 750, null), card('hull', 'Rivet Hull', 750, null)]);
    expect(goals).toEqual(["Follow Dot's shaft down to her lode", 'Corkscrew Drill: ready to buy', "Copper lode: 575 ft, beside Dot's shaft"]);
  });

  it('shows the gap and the part check when nothing is ready', () => {
    const goals = nextGoals(snap({ cash: 1_500 }, DONE_EARLY), [
      card('drill', 'Twin Screw', 2_000, 'Need $500 more', [
        { item: 'Hull Plate', need: 2, have: 0 },
        { item: 'Wire', need: 10, have: 4 },
      ]),
      card('engine', 'Thumper', 2_000, 'Need $500 more'),
    ]);
    expect(goals[1]).toBe('Twin Screw: $500 to go · Hull Plate 0/2 · Wire 4/10');
    expect(goals).toEqual(['Dig to 500 ft for a $1,000 bonus', 'Twin Screw: $500 to go · Hull Plate 0/2 · Wire 4/10']);
  });

  it('is empty in M0', () => {
    expect(nextGoals(snap({ scope: 'm0' }), [])).toEqual([]);
  });
});

describe('trip tracker', () => {
  it('sums haul, damage and fuel drops from left-rim to trip-end', () => {
    const t = new TripTracker();
    expect(t.onEvent({ t: 'left-rim' }, 10, 600)).toBeNull();
    t.onEvent({ t: 'collect', item: { kind: 'mineral', tier: 4 } }, 9.5, 700);
    t.onEvent({ t: 'collect', item: { kind: 'relic', id: 2 } }, 9.5, 710);
    t.onEvent({ t: 'damage', amount: 3, cause: 'landing' }, 9.5, 720);
    t.sampleFuel(8);
    t.sampleFuel(9); // a Jerrycan: increases are not use
    t.sampleFuel(7.5);
    const s = t.onEvent({ t: 'trip-end', trip: 4, deepestRow: 25 }, 7, 600 + 60 * 95);
    expect(s).toEqual({ trip: 4, deepestRow: 25, collected: 2, value: 10_250, fuelUsed: 4, hullLost: 3, seconds: 95 });
    expect(t.tracking).toBe(false);
  });

  it('a respawn forgets the trip', () => {
    const t = new TripTracker();
    t.onEvent({ t: 'left-rim' }, 10, 0);
    t.onEvent({ t: 'respawned', fee: 25, debt: 0, lost: [] }, 10, 100);
    expect(t.tracking).toBe(false);
  });
});

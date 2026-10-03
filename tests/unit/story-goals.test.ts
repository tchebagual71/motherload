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
    kitSlots: 0,
    drillFeedsLift: false,
    liftAtHeadframe: false,
    wireAssembler: false,
    wireStock: 0,
    drillSiteOpen: false,
    kitErrand: null,
    buildBlocked: null,
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
    const s = (row: number, extra: string[], patch: Partial<GoalSnapshot> = {}) =>
      text(snap({ scriptedLodeFound: true, row, onRim: row === 0, ...patch }, [...kit, ...extra]));
    const up = { liftAtHeadframe: true, drillFeedsLift: true };
    expect(s(0, [])).toBe('Dig down at the chevrons');
    // At the bottom of the access column the 2×2 site above the lode still has to go (01 §2.5).
    expect(s(45, [])).toBe('Dig out the drill site');
    expect(s(45, [], { drillSiteOpen: true })).toBe('Place the drill on the lode');
    expect(s(0, [], { drillSiteOpen: true })).toBe('Place the drill on the lode'); // back on the Rim (a salvage, a refuel)
    expect(s(45, ['ob:drill'])).toBe("Hang the lift in Dot's shaft");
    expect(s(30, ['ob:drill', 'ob:lift'], { liftAtHeadframe: true })).toBe('Belt the drill to the lift');
    expect(s(30, ['ob:drill', 'ob:lift', 'ob:belt'], { liftAtHeadframe: true })).toBe('Belt the Headframe to the Smelter');
    expect(s(0, ['ob:drill', 'ob:lift'], up)).toBe('Belt the Headframe to the Smelter');
    expect(s(0, ['ob:drill', 'ob:lift', 'tx:9:S6', 'ob:ingot'], up)).toBe('Build an Assembler: Wire');
    expect(s(0, ['ob:drill', 'ob:lift', 'tx:9:S6', 'ob:ingot'], { ...up, wireAssembler: true })).toBe('Stockpile iron and cobalt');
    expect(s(0, ['ob:drill', 'ob:lift', 'tx:9:S6', 'ob:ingot', 'ms:10:plated'], { ...up, wireAssembler: true })).toBe('Buy a tier-3 upgrade with parts');
  });

  it('a ghost whose Kit the bay lost names the Shed errand until the bay covers it again', () => {
    const kit = [...FOUND, 'ob:kit'];
    const s = (extra: string[], patch: Partial<GoalSnapshot>) =>
      text(snap({ scriptedLodeFound: true, row: 45, drillSiteOpen: true, ...patch }, [...kit, ...extra]));
    expect(s([], { kitErrand: 'Buy 1 Auto-Drill Kit at the Shed' })).toBe('Buy 1 Auto-Drill Kit at the Shed');
    expect(s([], { drillSiteOpen: false, kitErrand: 'Buy 1 Auto-Drill Kit at the Shed' })).toBe('Dig out the drill site');
    expect(s(['ob:drill'], { kitErrand: 'Buy 1 Lift Rail at the Shed' })).toBe('Buy 1 Lift Rail at the Shed');
    expect(s(['ob:drill'], { kitErrand: null })).toBe("Hang the lift in Dot's shaft");
    // Past the build steps an errand no longer drives the chip.
    expect(s(['ob:drill', 'tx:9:S6'], { kitErrand: 'Buy 2 Belt Kits at the Shed' })).toBe('Belt the Headframe to the Smelter');
  });

  it('the survey drill beside the lift foot needs no belt; S6 closes the drill, lift and belt steps (INT-1)', () => {
    const kit = [...FOUND, 'ob:kit', 'ob:drill', 'ob:lift'];
    const s = (extra: string[], patch: Partial<GoalSnapshot>) => text(snap({ scriptedLodeFound: true, ...patch }, [...kit, ...extra]));
    // 'ghost-complete' for the foot section sets ob:lift while the Lift Rail is still a ghost: not hung yet.
    expect(s([], { drillFeedsLift: true })).toBe("Hang the lift in Dot's shaft");
    expect(s([], { drillFeedsLift: true, liftAtHeadframe: true })).toBe('Belt the Headframe to the Smelter');
    // A drill elsewhere still needs its belt, until FirstLiftDelivery shows ore is coming up anyway.
    expect(s([], { liftAtHeadframe: true })).toBe('Belt the drill to the lift');
    expect(s(['tx:9:S6'], {})).toBe('Belt the Headframe to the Smelter');
    // The Yard's survey Smelter is never a ghost: the first ingot (and S6) moves the chip on.
    expect(s(['tx:9:S6', 'ob:ingot'], {})).toBe('Build an Assembler: Wire');
  });

  it('the Wire step is read from the factory: an Assembler on Wire, Wire in the Stockpile or a t3 (INT-1)', () => {
    const ingot = [...FOUND, 'ob:kit', 'ob:drill', 'ob:lift', 'tx:9:S6', 'ob:ingot'];
    const s = (patch: Partial<GoalSnapshot>) => text(snap({ scriptedLodeFound: true, ...patch }, ingot));
    expect(s({})).toBe('Build an Assembler: Wire');
    expect(s({ wireAssembler: true })).toBe('Stockpile iron and cobalt');
    // The Assembler switched to Hull Plate later: the Wire it made keeps the step done.
    expect(s({ wireStock: 12 })).toBe('Stockpile iron and cobalt');
    expect(s({ tiers: { ...TIERS, drill: 3 } })).toBe('Stockpile iron and cobalt');
    // No build event names it: a hand-set flag from a ghost never counts.
    expect(text(snap({ scriptedLodeFound: true }, [...ingot, 'ob:assembler']))).toBe('Build an Assembler: Wire');
  });

  it('a bay full of ore and the Starter Kit does not send the pod up from the drill site (INT-10)', () => {
    const kit = [...FOUND, 'ob:kit'];
    const full = { scriptedLodeFound: true, onRim: false, cargoUsed: 15, baySlots: 15, sellable: 10, kitSlots: 5 };
    expect(text(snap({ ...full, row: 20 }, kit))).toBe('Dig down at the chevrons');
    expect(text(snap({ ...full, row: 45, drillSiteOpen: true }, kit))).toBe('Place the drill on the lode');
    expect(text(snap({ ...full, row: 45, kitSlots: 4 }, [...kit, 'ob:drill']))).toBe("Hang the lift in Dot's shaft");
    // Drill and lift up: the Belt Kits left aboard are not needed, and the bay really is full.
    const built = { ...full, kitSlots: 2, liftAtHeadframe: true, drillFeedsLift: true };
    expect(text(snap({ ...built, row: 45 }, [...kit, 'ob:drill', 'ob:lift']))).toBe('Bay full — head up');
    // Before the Kit (beat 1–3 trips), bought Kits count like any cargo.
    expect(text(snap({ ...full, scriptedLodeFound: false, row: 6 }, DONE_EARLY))).toBe('Bay full — head up');
  });

  it('falling into Dot’s shaft early: the Kit and the factory come before the first sale and t2 (PLAYER-9)', () => {
    const early = ['tx:0:S0', 'tx:1:S1', 'tx:2:S2', 'tx:3:S5'];
    const s = (flags: string[], patch: Partial<GoalSnapshot> = {}) => text(snap({ scriptedLodeFound: true, ...patch }, flags));
    // The refuel stays first (the access dig needs the fuel); then the Starter Kit, not "Roll off the pad".
    expect(s(early)).toBe('Fill up at the Pump House');
    const fuelled = [...early, 'ms:4:toppedOff'];
    expect(s(fuelled)).toBe('Collect your Starter Kit at the Shed');
    expect(s(fuelled, { scriptedLodeFound: false })).toBe('Collect your Starter Kit at the Shed'); // S5 alone says so
    expect(s([...fuelled, 'ob:kit'])).toBe('Dig down at the chevrons');
    expect(s([...fuelled, 'ob:kit'], { onRim: false, row: 45, drillSiteOpen: true })).toBe('Place the drill on the lode');
    // Contextual hints still win: low fuel underground.
    expect(s([...fuelled, 'ob:kit'], { onRim: false, row: 30, fuelFrac: 0.1 })).toBe('Fuel low: the tick shows your way home');
    // The whole factory chain done: back to the first sale, then the t2.
    const factory = [...fuelled, 'ob:kit', 'ob:drill', 'tx:9:S6', 'ob:ingot', 'ms:10:plated'];
    expect(s(factory, { wireAssembler: true, sellable: 3 })).toBe('Sell at the Assay Office');
    expect(s([...factory, 'ms:11:payday'], { wireAssembler: true, cash: 900 })).toBe('Upgrade at the Garage');
  });

  it('a ghost job held in vain names its fix first, onboarding or not (PLAYER-6)', () => {
    const fix = 'Move Pip off the drill site so it can build';
    expect(text(snap({ buildBlocked: fix, onRim: false, row: 45, fuelFrac: 0.1 }, [...FOUND, 'ob:kit']))).toBe(fix);
    const t3 = { ...TIERS, drill: 3 };
    expect(text(snap({ buildBlocked: 'Build the lift below first', tiers: t3, deepestRow: 300 }))).toBe('Build the lift below first');
  });

  it('after the first t3 the chip points at the next depth bonus; M0 has no chip', () => {
    const all = [...FOUND, 'ob:kit', 'ob:drill', 'ob:lift', 'tx:9:S6', 'ob:ingot', 'ms:10:plated'];
    const t3 = { ...TIERS, drill: 3 };
    expect(nextGoal(snap({ tiers: t3, deepestRow: 50, scriptedLodeFound: true }, all))).toEqual({ text: 'Dig to 1,000 ft for a $3,000 bonus', progress: '625 ft' });
    expect(nextGoal(snap({ tiers: t3, deepestRow: 300, scriptedLodeFound: true }, all))).toBeNull();
    expect(nextGoal(snap({ scope: 'm0' }))).toBeNull();
    expect(nextGoal(snap({ scope: 'm0', buildBlocked: 'x' }))).toBeNull();
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

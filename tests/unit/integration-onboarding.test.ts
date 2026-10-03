// Whole-World onboarding (01 §2.5–2.6; canon §5.2 beats 5–6): the real pod, driven by intents, takes a
// generated claim from Dot's survey ping through the Starter Kit, the drill and the lift (built by proximity),
// FirstLiftDelivery and the first ingot, to Wire from the lode paying for a Garage t3.
import { describe, expect, it } from 'vitest';
import { DIR } from '../../src/factory/api';
import { NO_INTENT } from '../../src/pod/types';
import { SURVEY_PING_ROW } from '../../src/shared/canon';
import { World } from '../../src/world/world';
import { STARTER_KIT } from '../../src/world/kitShop';
import { Pilot, excavateDrillSite, runUntil } from './integration.helpers';

const SEED = 7;

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

describe('integration: survey ping → Starter Kit → first automation → first t3 (seed 7)', () => {
  it('plays the onboarding chain end to end through World.step', () => {
    const w = new World({ seed: SEED, scope: 'mvp' });
    const f = w.factory!;
    w.debugGiveCash(10_000);
    w.debugSetTier('tank', 4); // fuel is not under test here
    w.pod.fuel = w.stats().maxFuel;
    const p = new Pilot(w);
    const c = w.meta.surveyColumn;
    const lode = w.terrain.lodes[w.meta.scriptedLodeId];
    expect(f.entities().map((e) => [e.kind, e.rusted])).toEqual([
      ['headframe', true],
      ['smelter', true],
      ['bin', true],
    ]);
    expect(w.starterKitReady()).toBe(false);
    expect(w.claimStarterKit().ok).toBe(false);

    // ---- beat 5: down Dot's shaft. r32 pings the lode (once) and opens U1; the bottom finds it (U2, kit).
    p.descendShaft(c, lode.top - 1);
    expect(w.story.deepestRow).toBeGreaterThanOrEqual(SURVEY_PING_ROW);
    const pings = p.events.filter((e) => e.t === 'lode-pinged');
    expect(pings).toEqual([{ t: 'lode-pinged', lodeId: w.meta.scriptedLodeId }]);
    expect(f.isUnlocked('U1')).toBe(true);
    expect(lode.discovered).toBe(true);
    expect(f.isUnlocked('U2')).toBe(true);
    expect(p.count('starter-kit')).toBe(1);
    expect(w.starterKitReady()).toBe(true);
    expect(w.claimStarterKit()).toEqual({ ok: false, reason: 'Land on the Rim first' });

    // ---- the Supply Shed: the Starter Kit (canon §2.1: 5 slots, 14 mu), once.
    p.flyOut(c, 41);
    p.driveToPad('shed');
    const before = w.stats();
    expect(must(w.claimStarterKit()).amount).toBe(5);
    const after = w.stats();
    expect(after.slotsUsed - before.slotsUsed).toBe(5);
    expect(after.cargoMass - before.cargoMass).toBe(14);
    expect(w.pod.cargo.filter((k) => k.kind === 'kit').map((k) => (k.kind === 'kit' ? k.id : '')).sort()).toEqual([...STARTER_KIT].sort());
    expect(w.starterKitReady()).toBe(false);
    expect(w.claimStarterKit()).toEqual({ ok: false, reason: 'Starter Kit already collected' });
    expect(p.count('starter-kit')).toBe(1);

    // ---- beat 6: the access dig at the chevrons, then ghosts from build mode (the pod frozen).
    const plan = f.surveyPlan();
    p.driveRimTo(lode.x0 + 1);
    p.digDownTo(plan.drill.y - 1);
    excavateDrillSite(p, plan.drill.x, plan.drill.y);
    p.walkTo(c);
    p.run(3, NO_INTENT, false);
    const drill = must(f.placeGhost({ kind: 'autoDrill', ...plan.drill }));
    const lift = must(f.placeGhost({ kind: 'lift', ...plan.lift }));
    expect(lift.ids).toHaveLength(2); // foot + one Lift Rail (02 §2.6: the 45-row survey lift is two jobs)
    p.run(120, NO_INTENT, false);
    expect(f.ghosts()).toHaveLength(3); // nothing builds while the pod is frozen
    expect(w.ghostProgress()).toBeNull();

    // Proximity: oldest first, 60 consecutive steps each (02 §2.6). The pod stands at the shaft floor.
    p.step();
    expect(w.ghostProgress()).toEqual({ id: drill.ids[0], progress: 1 / 60 });
    const drillSteps = runUntil(p, 'drill built', () => f.ghosts().length === 2, 200);
    expect(drillSteps).toBe(59);
    expect(f.entities().some((e) => e.kind === 'autoDrill' && e.x === plan.drill.x && e.y === plan.drill.y)).toBe(true);
    runUntil(p, 'lift foot built', () => f.ghosts().length === 1, 200);
    // The rail job (rows 0–13) is out of reach from the floor: nothing counts until the pod climbs.
    p.run(90);
    expect(f.ghosts()).toHaveLength(1);
    expect(w.ghostProgress()).toBeNull();
    p.flyOut(c, c + 4);
    expect(f.ghosts()).toHaveLength(0);
    const built = f.entities().find((e) => e.kind === 'lift')!;
    expect([built.x, built.y, built.h]).toEqual([c, 0, plan.lift.foot + 1]);
    expect(p.events.filter((e) => e.t === 'ghost-complete').map((e) => (e.t === 'ghost-complete' ? e.kind : ''))).toEqual(['autoDrill', 'lift', 'lift']);
    const kits = w.pod.cargo.filter((k) => k.kind === 'kit').map((k) => (k.kind === 'kit' ? k.id : ''));
    expect(kits).toEqual(['belt', 'belt']); // the drill feeds the lift foot directly; the Belt Kits stay aboard

    // ---- the Yard crane: Headframe → Smelter → Bin with two 1-tile belts ($10).
    const hx = f.entities().find((e) => e.kind === 'headframe')!.x;
    const cash = w.wallet.cash;
    must(f.paintBelts([{ x: hx, y: 3 }], 1, DIR.S));
    must(f.paintBelts([{ x: hx, y: 6 }], 1, DIR.S));
    expect(cash - w.wallet.cash).toBe(10);

    // ---- FirstLiftDelivery, then the first ingot (U3), ingots in the survey Bin.
    runUntil(p, 'first-lift-delivery', () => p.count('first-lift-delivery') > 0, 6_000);
    expect(p.count('first-ingot')).toBe(0);
    runUntil(p, 'first-ingot', () => p.count('first-ingot') > 0, 3_000);
    expect(p.events.find((e) => e.t === 'first-ingot')).toEqual({ t: 'first-ingot', item: 'copperIngot' });
    expect(f.isUnlocked('U3')).toBe(true);
    runUntil(p, 'ingots in the Bin', () => f.stockpileCount('copperIngot') >= 2, 1_200);
    const radioBeats = p.events.filter((e) => e.t === 'radio').map((e) => (e.t === 'radio' ? e.beat : ''));
    expect(radioBeats).toContain('S6');
    expect(f.debug.conservationOk()).toBe(true);

    // ---- first Wire: Yard Expansion I at Dot's office, the Bin unloads ingots into an Assembler on A2.
    p.driveToPad('assay');
    expect(must(w.expandYard()).amount).toBe(16);
    expect(f.yardRows).toBe(16);
    const bin = f.entities().find((e) => e.kind === 'bin')!.id;
    must(f.setUnloadFilter(bin, 'copperIngot'));
    must(f.paintBelts([9, 10].map((y) => ({ x: hx + 1, y })), 1, DIR.S));
    const asm = must(f.place('assembler', 1, hx, 11, DIR.S)).id;
    must(f.setRecipe(asm, 'A2'));
    must(f.paintBelts([{ x: hx, y: 13 }], 1, DIR.S));
    must(f.place('bin', 1, hx, 14, DIR.S));

    // ---- beat 7: the Garage waits on Wire, then a t3 Bay takes 10 Wire (and 3 Hull Plate) all or nothing.
    // Hull Plate's own path (Stockpiled specimens → Smelter → A3) is the factory suite's; here it is stocked.
    must(f.stockpilePut([{ item: 'hullPlate', n: 3 }]));
    const bayCard = () => w.garageCards().find((k) => k.line === 'bay')!;
    w.debugSetTier('bay', 2);
    expect(bayCard().tier).toBe(3);
    expect(bayCard().blocker).toMatch(/Wire/);
    runUntil(p, 'ten Wire', () => f.stockpileCount('wire') >= 10, 12_000);
    const wire = f.stockpileCount('wire');
    expect(bayCard().parts.find((x) => x.item === 'Wire')).toEqual({ item: 'Wire', need: 10, have: wire });
    expect(bayCard().blocker).toBeNull();
    // All or nothing: one Hull Plate short refuses and takes no Wire.
    must(f.stockpileTake([{ item: 'hullPlate', n: 1 }]));
    expect(w.buyUpgrade('bay', 3).ok).toBe(false);
    expect(f.stockpileCount('wire')).toBe(wire);
    must(f.stockpilePut([{ item: 'hullPlate', n: 1 }]));
    p.driveToPad('garage');
    const bought = w.buyUpgrade('bay', 3);
    expect(bought.ok).toBe(true);
    expect(w.pod.tiers.bay).toBe(3);
    expect(f.stockpileCount('wire')).toBe(wire - 10);
    expect(f.stockpileCount('hullPlate')).toBe(0);
    expect(f.debug.conservationOk()).toBe(true);
  });
});

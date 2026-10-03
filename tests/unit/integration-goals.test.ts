// The goal chip end to end (01 §2.5–2.6; canon §5.2 onboarding beats 1–7): a real World driven by the pod's
// intents, its events and state read through the app's StoryFeed every step, as the player sees the chip. No ob:
// flag is set by hand here: the step facts must come from what the World and its factory actually reached
// (INT-1: the survey drill needs no belt and the Assembler is never a ghost; PLAYER-9: an early fall into Dot's
// shaft; INT-10: the Starter Kit's slots during the access dig).
import { signal } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { StoryFeed } from '../../src/app/storyFeed';
import type { GoalChip, RadioMessage, TripSummary } from '../../src/app/types';
import { DIR } from '../../src/factory/api';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { START_X } from '../../src/shared/canon';
import { World } from '../../src/world/world';
import { Pilot, excavateDrillSite, runUntil } from './integration.helpers';

const SEED = 7;

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

/** The scripted Pilot with the app's StoryFeed on top: every step's events go through it and the chip is sampled. */
class ChipPilot extends Pilot {
  /** The chip texts in the order they showed (consecutive repeats folded). */
  readonly chips: string[] = [];
  readonly state = { radio: signal<RadioMessage[]>([]), goal: signal<GoalChip | null>(null), tripSummary: signal<TripSummary | null>(null) };
  private readonly feed: StoryFeed;
  private now = 0;
  private fed = 0;

  constructor(w: World) {
    super(w);
    this.feed = new StoryFeed({ state: this.state, world: () => w, toast: () => {} });
  }

  get chip(): string | null {
    return this.state.goal.value?.text ?? null;
  }

  override step(intent: PodIntent = NO_INTENT, running = true): void {
    super.step(intent, running);
    this.now += 1_000 / 60;
    this.feed.onEvents(this.events.slice(this.fed), this.now);
    this.fed = this.events.length;
    this.feed.refresh(); // every step, so a chip shown for less than the 0.5 s refresh is not missed
    this.feed.tick(this.now);
    const t = this.chip ?? '(none)';
    if (this.chips.at(-1) !== t) this.chips.push(t);
  }

  /** Chips shown since `mark` (an index into `chips`), the one showing at the mark included. */
  since(mark: number): string[] {
    return this.chips.slice(Math.max(0, mark - 1));
  }

  /** Fuel is not under test: top the tank up without a Pump House visit (and without a purchase event). */
  topUp(): void {
    this.w.pod.fuel = this.w.stats().maxFuel;
  }
}

/** Kit ids aboard. */
function kitsAboard(w: World): string[] {
  return w.pod.cargo.filter((c) => c.kind === 'kit').map((c) => (c.kind === 'kit' ? c.id : ''));
}

type Plan = ReturnType<NonNullable<World['factory']>['surveyPlan']>;

/** The Starter Kit at the Shed, the access dig at the chevrons and the 2×2 drill site. Returns the survey plan. */
function claimAndDig(p: ChipPilot): Plan {
  const w = p.w;
  const f = w.factory!;
  const lode = w.terrain.lodes[w.meta.scriptedLodeId];
  p.driveToPad('shed');
  expect(p.chip).toBe('Collect your Starter Kit at the Shed');
  must(w.claimStarterKit());
  p.step();
  expect(p.chip).toBe('Dig down at the chevrons');
  // The access dig fills a small bay around the Kit's 5 slots: the chip keeps the dig and the drill (INT-10).
  p.topUp();
  const plan = f.surveyPlan();
  p.driveRimTo(lode.x0 + 1);
  p.digDownTo(plan.drill.y - 1);
  excavateDrillSite(p, plan.drill.x, plan.drill.y);
  expect(p.chip).toBe('Place the drill on the lode');
  return plan;
}

/**
 * From the drill site to the first ingot: the drill and lift ghosts from the shaft floor (built by proximity, the
 * rail on the way up), the two Yard belts Headframe → Smelter → Bin, FirstLiftDelivery, the first ingot.
 */
function buildToIngot(p: ChipPilot, plan: Plan): void {
  const w = p.w;
  const f = w.factory!;
  const c = w.meta.surveyColumn;
  p.walkTo(c);
  expect(p.chip).toBe('Place the drill on the lode');

  // Build mode (the pod frozen) puts both ghosts down; proximity builds the drill, then the lift foot.
  p.run(3, NO_INTENT, false);
  if (f.ghosts().length === 0) must(f.placeGhost({ kind: 'autoDrill', ...plan.drill }));
  must(f.placeGhost({ kind: 'lift', ...plan.lift }));
  runUntil(p, 'drill built', () => f.entities().some((e) => e.kind === 'autoDrill'), 400);
  expect(p.chip).toBe("Hang the lift in Dot's shaft");
  runUntil(p, 'lift foot built', () => f.ghosts().length === 1, 400);
  // The foot section stands beside the drill, but the Lift Rail above is still a ghost: not hung yet.
  expect(p.chip).toBe("Hang the lift in Dot's shaft");
  p.topUp();
  p.flyOut(c, c + 4);
  expect(f.ghosts()).toHaveLength(0);
  // The drill feeds the lift foot directly (02 §3.4): no belt step, and its Belt Kits stay aboard.
  expect(kitsAboard(w)).toEqual(['belt', 'belt']);
  expect(p.chip).toBe('Belt the Headframe to the Smelter');

  const hx = f.entities().find((e) => e.kind === 'headframe')!.x;
  for (const y of [3, 6]) must(f.paintBelts([{ x: hx, y }], 1, DIR.S));
  runUntil(p, 'first-lift-delivery', () => p.count('first-lift-delivery') > 0, 6_000);
  expect(p.chip).toBe('Belt the Headframe to the Smelter');
  runUntil(p, 'first-ingot', () => p.count('first-ingot') > 0, 3_000);
  p.step();
  expect(p.chip).toBe('Build an Assembler: Wire');
}

/** Yard Expansion I, the survey Bin unloading Copper Ingots into an Assembler on Wire (A2), then a Hull Plate. */
function wireThenPlate(p: ChipPilot): void {
  const w = p.w;
  const f = w.factory!;
  const hx = f.entities().find((e) => e.kind === 'headframe')!.x;
  w.debugGiveCash(3_500); // Expansion I + the Assembler + belts; a sale would be a story event of its own
  p.driveToPad('assay');
  must(w.expandYard());
  const bin = f.entities().find((e) => e.kind === 'bin')!.id;
  must(f.setUnloadFilter(bin, 'copperIngot'));
  must(f.paintBelts([9, 10].map((y) => ({ x: hx + 1, y })), 1, DIR.S));
  const asm = must(f.place('assembler', 1, hx, 11, DIR.S)).id;
  p.step();
  expect(p.chip).toBe('Build an Assembler: Wire'); // an Assembler with no recipe is not on Wire yet
  must(f.setRecipe(asm, 'A2'));
  p.step();
  expect(p.chip).toBe('Stockpile iron and cobalt');
  must(f.paintBelts([{ x: hx, y: 13 }], 1, DIR.S));
  must(f.place('bin', 1, hx, 14, DIR.S));
  runUntil(p, 'Wire stocked', () => f.stockpileCount('wire') > 0, 6_000);
  // Hull Plate's own path (Stockpiled specimens → Smelter → A3) is the factory suite's; here it is stocked.
  must(f.stockpilePut([{ item: 'hullPlate', n: 1 }]));
  runUntil(p, 'Plated', () => p.events.some((e) => e.t === 'milestone' && e.id === 'plated'), 120);
  p.step();
}

describe('integration: the goal chip through the scripted onboarding (seed 7)', () => {
  it('beats 1–7 in order: sale and t2, Dot’s lode, the Kit, drill, lift, Smelter, Wire, Hull Plate, t3', () => {
    const w = new World({ seed: SEED, scope: 'mvp' });
    const p = new ChipPilot(w);
    const c = w.meta.surveyColumn;
    const lode = w.terrain.lodes[w.meta.scriptedLodeId];

    // ---- beats 1–3: refuel, a first dig in the Tutorial Patch and its sale, a t2 Bay (Basket, 15 slots).
    p.step();
    expect(p.chip).toBe('Fill up at the Pump House');
    p.driveToPad('pump');
    must(w.buyFuel('fill'));
    p.step();
    expect(p.chip).toBe('Roll off the pad, then push down');
    p.driveRimTo(START_X);
    p.digDownTo(8);
    expect(w.pod.cargo.length).toBeGreaterThan(0);
    p.flyOut(START_X, 12);
    p.driveToPad('assay');
    expect(p.chip).toBe('Sell at the Assay Office');
    must(w.sellAll());
    w.debugGiveCash(1_000);
    p.driveToPad('garage');
    expect(p.chip).toBe('Upgrade at the Garage');
    must(w.buyUpgrade('bay', 2));
    p.step();
    const mark = p.chips.length;
    expect(p.chip).toBe('Dig to 500 ft for a $1,000 bonus');

    // ---- beats 4–5: down Dot's shaft (S1 at r32 names it, S5 at the bottom finds the lode), up to the Shed.
    p.topUp();
    p.descendShaft(c, lode.top - 1);
    expect(p.chip).toBe('Collect your Starter Kit at the Shed');
    p.topUp();
    p.flyOut(c, 41);

    // ---- beat 6 and the parts loop.
    buildToIngot(p, claimAndDig(p));
    wireThenPlate(p);
    expect(p.chip).toBe('Buy a tier-3 upgrade with parts');

    expect(p.since(mark)).toEqual([
      'Dig to 500 ft for a $1,000 bonus',
      "Follow Dot's shaft down to her lode",
      'Collect your Starter Kit at the Shed',
      'Dig down at the chevrons',
      'Dig out the drill site',
      'Place the drill on the lode',
      "Hang the lift in Dot's shaft",
      'Belt the Headframe to the Smelter',
      'Build an Assembler: Wire',
      'Stockpile iron and cobalt',
      'Buy a tier-3 upgrade with parts',
    ]);
    expect(p.chips).not.toContain('Belt the drill to the lift');
    expect(Object.keys(w.story.flags).filter((k) => k.startsWith('rung:'))).toEqual(['rung:U0', 'rung:U1', 'rung:U2', 'rung:U3']);
  });

  it('an early fall into Dot’s shaft (01 §2.5): the refuel, then the Kit and the factory before the first sale (PLAYER-9)', () => {
    const w = new World({ seed: SEED, scope: 'mvp' });
    const p = new ChipPilot(w);
    const c = w.meta.surveyColumn;
    const lode = w.terrain.lodes[w.meta.scriptedLodeId];

    // A new claim drives straight to the shaft and drops in: S1, S2 and S5 on the way down.
    p.step();
    expect(p.chip).toBe('Fill up at the Pump House');
    p.descendShaft(c, lode.top - 1);
    expect(lode.discovered).toBe(true);
    expect(p.chip).toBe('Fill up at the Pump House');
    p.flyOut(c, 3);
    p.driveToPad('pump');
    must(w.buyFuel('fill'));
    p.step();
    // Not "Roll off the pad, then push down": the Starter Kit is simply ready sooner.
    expect(p.chip).toBe('Collect your Starter Kit at the Shed');

    // The Satchel (7 slots) holds the Kit's 5: the access dig fills it at once, and the chip stays on the build.
    const plan = claimAndDig(p);
    expect(w.stats().slotsUsed).toBe(w.stats().baySlots);
    expect(p.count('bay-full')).toBeGreaterThan(0);
    buildToIngot(p, plan);
    wireThenPlate(p);

    // The factory steps are done: back to beats 2–3, then beat 7.
    expect(p.chip).toBe(w.pod.cargo.some((k) => k.kind !== 'kit') ? 'Sell at the Assay Office' : 'Roll off the pad, then push down');
    expect(p.chips).toEqual([
      'Fill up at the Pump House',
      'Collect your Starter Kit at the Shed',
      'Dig down at the chevrons',
      'Dig out the drill site',
      'Place the drill on the lode',
      "Hang the lift in Dot's shaft",
      'Belt the Headframe to the Smelter',
      'Build an Assembler: Wire',
      'Stockpile iron and cobalt',
      p.chip,
    ]);
    p.driveToPad('assay');
    must(w.sellAll());
    w.debugGiveCash(1_000);
    p.driveToPad('garage');
    expect(p.chip).toBe('Upgrade at the Garage');
    must(w.buyUpgrade('bay', 2));
    p.step();
    expect(p.chip).toBe('Buy a tier-3 upgrade with parts');
  });

  it('Pip standing in the drill footprint holds the build ring, and the chip names the fix (PLAYER-6)', () => {
    const w = new World({ seed: SEED, scope: 'mvp' });
    const p = new ChipPilot(w);
    const f = w.factory!;
    const c = w.meta.surveyColumn;
    p.descendShaft(c, w.terrain.lodes[w.meta.scriptedLodeId].top - 1);
    p.flyOut(c, 41);
    must(w.buyFuel('fill'));
    const plan = claimAndDig(p);
    // The pod stands inside the 2×2 it just dug and puts the drill ghost down on itself.
    const at = p.cell();
    expect(at.x - plan.drill.x).toBeGreaterThanOrEqual(0);
    expect(at.x - plan.drill.x).toBeLessThan(2);
    p.run(3, NO_INTENT, false);
    must(f.placeGhost({ kind: 'autoDrill', ...plan.drill }));
    runUntil(p, 'the ring holds on E_POD', () => w.ghostProgress()?.blocked === 'E_POD', 200);
    p.step();
    expect(p.chip).toBe('Move Pip off the drill site so it can build');
    // Into the shaft beside it: the hold clears on the ring's next re-check (≤ 0.5 s) and the job completes.
    p.walkTo(c);
    runUntil(p, 'the ring resumes', () => w.ghostProgress()?.blocked === null, 40);
    expect(p.chip).toBe('Place the drill on the lode');
    buildToIngot(p, plan);
    expect(p.chips).toContain('Move Pip off the drill site so it can build');
  });
});

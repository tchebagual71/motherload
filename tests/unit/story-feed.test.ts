// Story → app state (StoryFeed, wired into GameApp.handleEvents / tick / setWorld): the radio queue, milestone
// toasts, the trip summary on Rim arrival and the ≤ 2 Hz goal chip, against the real MVP World.
import { signal } from '@preact/signals';
import { describe, expect, it, vi } from 'vitest';
import { GameApp, type ControllerOptions } from '../../src/app/controller';
import { defaultSettings } from '../../src/app/settings';
import { GOAL_REFRESH_MS, StoryFeed, WIRE_RECIPE, blockedGoalText, drillSiteOpen, factoryFacts, kitErrand, surveyColumnOf } from '../../src/app/storyFeed';
import type { GoalChip, RadioMessage, TripSummary } from '../../src/app/types';
import type { BuildingKind, EntityView, ErrCode, FactoryApi, GhostView } from '../../src/factory/api';
import { RIM_BUILDINGS } from '../../src/shared/canon';
import { T, type Scope } from '../../src/shared/types';
import { StoryLedger } from '../../src/story';
import type { WorldApi } from '../../src/world/api';
import { World } from '../../src/world/world';

function feedFor(scope: Scope = 'mvp') {
  let world = new World({ seed: 7, scope });
  const state = { radio: signal<RadioMessage[]>([]), goal: signal<GoalChip | null>(null), tripSummary: signal<TripSummary | null>(null) };
  const toast = vi.fn();
  const feed = new StoryFeed({ state, world: () => world, toast });
  return {
    feed,
    state,
    toast,
    get world() {
      return world;
    },
    setWorld(w: World) {
      world = w;
      feed.reset();
    },
  };
}

describe('StoryFeed', () => {
  it('queues radio beats with ids and toasts milestones', () => {
    const f = feedFor();
    f.feed.onEvents(f.world.drainEvents(), 1_000);
    expect(f.state.radio.value).toEqual([{ id: 1, beat: 'S0', sender: 'Dot', cards: [expect.stringContaining('Pump House')], at: 1_000 }]);
    f.world.debugTeleport(33);
    f.world.step({ sx: 0, sy: 0, thrust: false, fireSlot: -1 }, true);
    f.feed.onEvents(f.world.drainEvents(), 2_000);
    expect(f.state.radio.value.map((m) => `${m.id}:${m.beat}`)).toEqual(['1:S0', '2:S1']);
    f.feed.onEvents([{ t: 'milestone', id: 'payday', title: 'Payday' }], 3_000);
    expect(f.toast).toHaveBeenCalledWith('Milestone: Payday', 'good');
  });

  it('raises the trip summary on trip end, with Next Goals', () => {
    const f = feedFor();
    f.world.drainEvents();
    f.feed.onEvents([{ t: 'left-rim' }, { t: 'collect', item: { kind: 'mineral', tier: 4 } }, { t: 'damage', amount: 2, cause: 'landing' }], 0);
    f.world.pod.fuel = 4.5;
    f.feed.tick(100);
    f.feed.onEvents([{ t: 'trip-end', trip: 1, deepestRow: 18 }], 200);
    expect(f.state.tripSummary.value).toMatchObject({ trip: 1, deepestRow: 18, collected: 1, value: 250, hullLost: 2, fuelUsed: 1.5 });
    expect(f.state.tripSummary.value!.nextGoals[0]).toBe('Fill up at the Pump House');
  });

  it('a pending trip summary keeps its Next Goals current: a sale on the Assay pad counts (PLAYER-7)', () => {
    const f = feedFor();
    const w = f.world;
    new StoryLedger(w.story.flags).recordMilestone('toppedOff');
    const assay = RIM_BUILDINGS[1];
    w.pod.x = w.pod.prevX = (assay.x0 + assay.x1 + 1) / 2;
    for (let i = 0; i < 6; i++) w.pod.cargo.push({ kind: 'mineral', tier: 3 });
    w.drainEvents();
    f.feed.onEvents([{ t: 'left-rim' }], 0);
    f.feed.tick(0);
    f.feed.onEvents([{ t: 'trip-end', trip: 1, deepestRow: 18 }], 100);
    const before = f.state.tripSummary.value!;
    expect(before.nextGoals[0]).toBe('Sell at the Assay Office');
    // The pad's sheet opened on landing; the player sells there, then closes it (the app asks for a refresh).
    expect(w.sellAll().ok).toBe(true);
    f.feed.onEvents(w.drainEvents(), 200);
    f.feed.refresh();
    f.feed.tick(201);
    const after = f.state.tripSummary.value!;
    expect(after).toMatchObject({ trip: 1, deepestRow: 18 });
    expect(after.nextGoals).not.toContain('Sell at the Assay Office');
    expect(after.nextGoals).not.toEqual(before.nextGoals);
    // The same list the goal chip offers right now (its action, then its Next Goals).
    expect(after.nextGoals).toEqual([f.state.goal.value!.text, ...f.state.goal.value!.next!]);
  });

  it('refreshes the goal chip at most twice a second', () => {
    const f = feedFor();
    f.feed.tick(0);
    expect(f.state.goal.value).toMatchObject({ text: 'Fill up at the Pump House' });
    expect(f.state.goal.value!.next!.length).toBeGreaterThan(0);
    f.world.story.flags['ms:9:toppedOff'] = true;
    f.feed.tick(GOAL_REFRESH_MS - 1);
    expect(f.state.goal.value!.text).toBe('Fill up at the Pump House');
    f.feed.tick(GOAL_REFRESH_MS);
    expect(f.state.goal.value!.text).toBe('Roll off the pad, then push down');
  });

  it('a new world clears the old one’s radio, goal and summary; M0 stays silent', () => {
    const f = feedFor();
    f.feed.onEvents(f.world.drainEvents(), 0);
    f.feed.tick(0);
    f.setWorld(new World({ seed: 8, scope: 'mvp' }));
    expect(f.state.radio.value).toEqual([]);
    expect(f.state.goal.value).toBeNull();
    const m0 = feedFor('m0');
    m0.feed.onEvents([{ t: 'radio', beat: 'S0', sender: 'Dot', cards: ['x'] }, { t: 'milestone', id: 'payday', title: 'Payday' }], 0);
    m0.feed.tick(0);
    expect(m0.state.radio.value).toEqual([]);
    expect(m0.state.goal.value).toBeNull();
    expect(m0.toast).not.toHaveBeenCalled();
  });

  it('finds Dot’s survey shaft from the SURVEY flags', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    expect(surveyColumnOf(w)).toBe(w.meta.surveyColumn);
  });
});

describe('StoryFeed: what the factory reached (INT-1) and a held ghost job (PLAYER-6)', () => {
  const ent = (kind: BuildingKind, x: number, y: number, w: number, h: number, extra: Partial<EntityView> = {}): EntityView => ({
    id: 1,
    kind,
    mk: 1,
    plane: kind === 'autoDrill' || kind === 'lift' ? 'mine' : 'yard',
    x,
    y,
    w,
    h,
    dir: 0,
    status: 'idle',
    recipe: null,
    progress: 0,
    rusted: false,
    ...extra,
  });
  const factory = (ents: EntityView[], wire = 0, ghosts: GhostView[] = []) =>
    ({ entities: () => ents, ghosts: () => ghosts, stockpileCount: (id: string) => (id === 'wire' ? wire : 0) }) as unknown as FactoryApi;
  // Dot's shaft at x 20 under its Headframe (x 20–21); the survey drill at x 21–22, rows 44–45; the lift foot at r45.
  const headframe = ent('headframe', 20, 1, 2, 2);
  const drill = ent('autoDrill', 21, 44, 2, 2);

  it('the drill beside the lift foot feeds it; a lift reaches its Headframe only once its top is row 0', () => {
    expect(factoryFacts(null)).toEqual({ drillFeedsLift: false, liftAtHeadframe: false, wireAssembler: false, wireStock: 0 });
    // The foot section alone (rows 14–45): beside the drill, not up yet.
    expect(factoryFacts(factory([headframe, drill, ent('lift', 20, 14, 1, 32)]))).toMatchObject({ drillFeedsLift: true, liftAtHeadframe: false });
    expect(factoryFacts(factory([headframe, drill, ent('lift', 20, 0, 1, 46)]))).toMatchObject({ drillFeedsLift: true, liftAtHeadframe: true });
    // A lift with its foot above the drill needs a belt; so does one a column off (and no Headframe stands over it).
    expect(factoryFacts(factory([headframe, drill, ent('lift', 20, 0, 1, 40)]))).toMatchObject({ drillFeedsLift: false, liftAtHeadframe: true });
    expect(factoryFacts(factory([headframe, drill, ent('lift', 19, 0, 1, 46)]))).toMatchObject({ drillFeedsLift: false, liftAtHeadframe: false });
    expect(factoryFacts(factory([headframe, drill, ent('lift', 23, 0, 1, 46)]))).toMatchObject({ drillFeedsLift: true, liftAtHeadframe: false });
  });

  it('an Assembler counts for the Wire step only on the Wire recipe; Wire in the Stockpile is read too', () => {
    expect(WIRE_RECIPE).toBe('A2');
    expect(factoryFacts(factory([ent('assembler', 5, 10, 2, 2)])).wireAssembler).toBe(false);
    expect(factoryFacts(factory([ent('assembler', 5, 10, 2, 2, { recipe: 'A3' })])).wireAssembler).toBe(false);
    expect(factoryFacts(factory([ent('assembler', 5, 10, 2, 2, { recipe: 'A2' })])).wireAssembler).toBe(true);
    expect(factoryFacts(factory([], 7)).wireStock).toBe(7);
  });

  it('names the fix for a held job: Pip in an occupant’s footprint, else the refusal toast', () => {
    const job = (kind: BuildingKind, x: number, y: number, w: number, h: number, part: GhostView['part'] = null, kit = 'autoDrill'): GhostView =>
      ({ id: 9, kind, mk: 1, x, y, w, h, dir: 0, part, kit, kitUnits: 1, order: 1 });
    const world = (blocked: ErrCode | null, ghosts: GhostView[], ents: EntityView[] = [], solid = -1) =>
      ({
        ghostProgress: () => ({ id: 9, progress: 0, blocked }),
        factory: factory(ents, 0, ghosts),
        terrain: { get: (_x: number, r: number) => (r === solid ? T.DIRT : T.AIR) },
      }) as unknown as WorldApi;
    expect(blockedGoalText(world(null, [job('autoDrill', 21, 44, 2, 2)]))).toBeNull();
    expect(blockedGoalText({ ghostProgress: () => null } as unknown as WorldApi)).toBeNull();
    expect(blockedGoalText(world('E_POD', [job('autoDrill', 21, 44, 2, 2)]))).toBe('Move Pip off the drill site so it can build');
    expect(blockedGoalText(world('E_POD', [job('depot', 21, 44, 3, 2, null, 'depot')]))).toBe('Move Pip off the Depot site so it can build');
    expect(blockedGoalText(world('E_POD', []))).toBe('Move Pip off the build site so it can build');
    // A Lift Rail with no lift under it yet (02 §2.6), then one whose shaft is blocked.
    const rail = job('lift', 20, 0, 1, 14, 'rail', 'liftRail');
    expect(blockedGoalText(world('E_COLUMN', [rail]))).toBe('Build the lift below first');
    expect(blockedGoalText(world('E_COLUMN', [rail], [ent('lift', 20, 14, 1, 32)], 6))).toBe('Shaft blocked at row 6');
    expect(blockedGoalText(world('E_FLOOR', [job('belt', 10, 30, 3, 1, null, 'belt')]))).toBe('Needs a floor');
    expect(blockedGoalText(world('E_KIT', [job('belt', 10, 30, 3, 1, null, 'belt')]))).toMatch(/Belt Kit/);
  });

  it('names the Shed errand for ghost Kits the bay lacks (a salvage lost them), and reads the drill site', () => {
    const job = (kit: string, kitUnits: number): GhostView =>
      ({ id: 9, kind: 'lift', mk: 1, x: 20, y: 0, w: 1, h: 14, dir: 0, part: 'rail', kit, kitUnits, order: 1 });
    const world = (ghosts: GhostView[], cargo: unknown[], stocked = 0, solid = false) =>
      ({
        factory: { ...factory([], 0, ghosts), surveyPlan: () => ({ drill: { x: 21, y: 44 }, lift: { x: 20, foot: 45, top: 0 } }) },
        pod: { cargo },
        kitShop: () => [{ id: 'liftRail', inStockpile: stocked }, { id: 'belt', inStockpile: stocked }],
        terrain: { get: (x: number, r: number) => (solid && x === 22 && r === 45 ? T.DIRT : T.AIR) },
      }) as unknown as WorldApi;
    expect(kitErrand(world([], []))).toBeNull();
    expect(kitErrand(world([job('liftRail', 1)], [{ kind: 'kit', id: 'liftRail' }]))).toBeNull();
    expect(kitErrand(world([job('liftRail', 1)], []))).toBe('Buy 1 Lift Rail at the Shed');
    expect(kitErrand(world([job('liftRail', 1)], [], 1))).toBe('Load 1 Lift Rail at the Shed');
    // Metered Belt Kits: 9 tiles against a part-used Kit of 3 units is 6 short, one whole Kit.
    expect(kitErrand(world([job('belt', 9)], [{ kind: 'kit', id: 'belt', units: 3 }]))).toBe('Buy 1 Belt Kit at the Shed');
    expect(kitErrand(world([job('belt', 20)], []))).toBe('Buy 3 Belt Kits at the Shed');
    expect(drillSiteOpen(world([], []))).toBe(true);
    expect(drillSiteOpen(world([], [], 0, true))).toBe(false);
    expect(drillSiteOpen({ factory: null } as unknown as WorldApi)).toBe(true);
  });

  it('the chip shows the held job’s fix over the script step, and drops it once the ring moves again', () => {
    const f = feedFor();
    const w = f.world;
    w.ghostProgress = () => ({ id: 1, progress: 0, blocked: 'E_POD' });
    f.feed.tick(0);
    expect(f.state.goal.value?.text).toBe('Move Pip off the build site so it can build');
    w.ghostProgress = () => null;
    f.feed.refresh();
    f.feed.tick(1);
    expect(f.state.goal.value?.text).toBe('Fill up at the Pump House');
  });
});

describe('GameApp wiring', () => {
  function app(world: World) {
    const opts: ControllerOptions = {
      world,
      worlds: { create: (seed) => new World({ seed, scope: 'mvp' }), deserialize: (b) => World.deserialize(b) },
      codes: { encode: () => 'HF1:abc', decode: () => ({ ok: false, reason: 'nope' }) },
      settings: defaultSettings(393, 852),
      look: 'toon',
      settingsStore: { loadSettings: vi.fn(), saveSettings: vi.fn(), loadLook: vi.fn(), saveLook: vi.fn() } as unknown as ControllerOptions['settingsStore'],
      styleTest: false,
      standalone: true,
      canInstall: false,
      coldLoad: false,
      resolveQuality: () => 'mid',
      now: () => 0,
      randomSeed: () => 42,
    };
    return new GameApp(opts);
  }

  it('drained events reach the radio queue; dismissRadio removes one; a new game starts with S0 again', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    const a = app(w);
    a.handleEvents(w.drainEvents());
    expect(a.state.radio.value.map((m) => m.beat)).toEqual(['S0']);
    a.dismissRadio(a.state.radio.value[0].id);
    expect(a.state.radio.value).toEqual([]);
    a.tick(16, 1_000);
    expect(a.state.goal.value?.text).toBe('Fill up at the Pump House');
    a.newGame();
    expect(a.state.goal.value).toBeNull();
    a.handleEvents(a.world.drainEvents());
    expect(a.state.radio.value.map((m) => m.beat)).toEqual(['S0']);
  });

  it('a purchase and a sheet closing refresh the goal chip at once, not up to 0.5 s later', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    const a = app(w);
    a.handleEvents(w.drainEvents());
    a.tick(16, 1_000);
    expect(a.state.goal.value?.text).toBe('Fill up at the Pump House');
    const pump = RIM_BUILDINGS[0];
    w.pod.x = w.pod.prevX = (pump.x0 + pump.x1 + 1) / 2;
    a.openSheet('pump');
    a.afterAction(w.buyFuel('fill'));
    a.handleEvents(w.drainEvents());
    a.tick(16, 1_001);
    expect(a.state.goal.value?.text).not.toBe('Fill up at the Pump House');
    const shown = a.state.goal.value;
    a.closeSheet();
    a.tick(16, 1_002); // recomputed (same result) even though only 2 ms have passed
    expect(a.state.goal.value).toEqual(shown);
  });
});

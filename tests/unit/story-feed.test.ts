// Story → app state (StoryFeed, wired into GameApp.handleEvents / tick / setWorld): the radio queue, milestone
// toasts, the trip summary on Rim arrival and the ≤ 2 Hz goal chip, against the real MVP World.
import { signal } from '@preact/signals';
import { describe, expect, it, vi } from 'vitest';
import { GameApp, type ControllerOptions } from '../../src/app/controller';
import { defaultSettings } from '../../src/app/settings';
import { GOAL_REFRESH_MS, StoryFeed, surveyColumnOf } from '../../src/app/storyFeed';
import type { GoalChip, RadioMessage, TripSummary } from '../../src/app/types';
import { RIM_BUILDINGS } from '../../src/shared/canon';
import type { Scope } from '../../src/shared/types';
import { StoryLedger } from '../../src/story';
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

// The story hosted by the real World (01 §7.4; canon §2.12 #1): the game-start card on new games only, depth
// pings, the scripted lode, Recorder sales, and flags that survive a save.
import { signal } from '@preact/signals';
import { describe, expect, it, vi } from 'vitest';
import { StoryFeed } from '../../src/app/storyFeed';
import type { GoalChip, RadioMessage, TripSummary } from '../../src/app/types';
import { NO_INTENT } from '../../src/pod/types';
import { POD_H, RIM_BUILDINGS } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import type { Scope } from '../../src/shared/types';
import { RECORDER_RELIC } from '../../src/story/script';
import { StoryLedger } from '../../src/story/ledger';
import { World } from '../../src/world/world';

const radios = (ev: GameEvent[]) => ev.filter((e): e is Extract<GameEvent, { t: 'radio' }> => e.t === 'radio');
const beatIds = (ev: GameEvent[]) => radios(ev).map((e) => e.beat);

function run(w: World, n: number): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    w.step(NO_INTENT, true);
    out.push(...w.drainEvents());
  }
  return out;
}

const world = (scope: Scope = 'mvp', seed = 7) => new World({ seed, scope });

describe('the World hosts the story', () => {
  it('a new MVP claim opens with the refuel card, once', () => {
    const w = world();
    const first = w.drainEvents();
    expect(radios(first)).toEqual([
      { t: 'radio', beat: 'S0', sender: 'Dot', cards: ["Pip's tank is nearly dry, Seven. Roll left to the Pump House and fill her up."] },
    ]);
    expect(beatIds(run(w, 120))).toEqual([]);
  });

  it('a restored claim never hears the game-start card again; M0 hears nothing', () => {
    const w = world();
    w.drainEvents();
    const r = World.deserialize(w.serialize());
    expect(radios(r.drainEvents())).toEqual([]);
    expect(radios(run(r, 60))).toEqual([]);
    expect(radios(world('m0').drainEvents())).toEqual([]);
  });

  it('falling down Dot’s shaft pings the lode at r32, pays 500 ft and finds the lode at the bottom', () => {
    const w = world();
    w.drainEvents();
    // Drop into the open survey shaft at row 30 (debugTeleport deliberately avoids the shaft column).
    const pod = w.pod as { x: number; y: number; vx: number; vy: number; prevX: number; prevY: number; grounded: boolean };
    pod.x = pod.prevX = w.meta.surveyColumn + 0.5;
    pod.y = pod.prevY = -30.5;
    pod.vx = pod.vy = 0;
    pod.grounded = false;
    const ev = run(w, 600);
    expect(beatIds(ev)).toEqual(['S1', 'S2', 'S5']);
    expect(ev).toContainEqual({ t: 'lode-pinged', lodeId: w.meta.scriptedLodeId });
    expect(ev.filter((e) => e.t === 'milestone').map((e) => (e as { id: string }).id)).toEqual(expect.arrayContaining(['fiveHundredClub', 'oldPing']));
    expect(w.terrain.lodes[w.meta.scriptedLodeId].discovered).toBe(true);
  });

  it('the goal chip asks to collect the Starter Kit from lode discovery until the claim at the Shed (PLAYER-1)', () => {
    const w = world();
    w.drainEvents();
    const state = { radio: signal<RadioMessage[]>([]), goal: signal<GoalChip | null>(null), tripSummary: signal<TripSummary | null>(null) };
    const feed = new StoryFeed({ state, world: () => w, toast: vi.fn() });
    // Beats 1–3 done (the early steps would otherwise take the chip), then down Dot's shaft to the lode.
    const L = new StoryLedger(w.story.flags);
    for (const m of ['toppedOff', 'payday', 'basketCase']) L.recordMilestone(m);
    const pod = w.pod as { x: number; y: number; vx: number; vy: number; prevX: number; prevY: number; grounded: boolean };
    pod.x = pod.prevX = w.meta.surveyColumn + 0.5;
    pod.y = pod.prevY = -30.5;
    pod.vx = pod.vy = 0;
    pod.grounded = false;
    feed.onEvents(run(w, 600), 0);
    expect(w.terrain.lodes[w.meta.scriptedLodeId].discovered).toBe(true);
    expect(w.starterKitReady()).toBe(true);
    feed.tick(1_000);
    expect(state.goal.value?.text).toBe('Collect your Starter Kit at the Shed');
    // Back on the Rim before the claim: still the Shed, never the access dig.
    const shed = RIM_BUILDINGS[3];
    pod.x = pod.prevX = (shed.x0 + shed.x1 + 1) / 2;
    pod.y = pod.prevY = POD_H / 2;
    pod.grounded = true;
    feed.onEvents(run(w, 2), 2_000);
    feed.tick(3_000);
    expect(state.goal.value?.text).toBe('Collect your Starter Kit at the Shed');
    expect(w.claimStarterKit().ok).toBe(true);
    feed.onEvents(w.drainEvents(), 4_000);
    feed.tick(5_000);
    // Beat 6 begins: the access dig (its wording may change with the chevrons, 03 §4.6).
    expect(state.goal.value?.text).not.toBe('Collect your Starter Kit at the Shed');
    expect(state.goal.value?.text).toMatch(/^Dig down|drill/);
  });

  it('flags carry the story through a save: nothing repeats after a reload', () => {
    const w = world();
    w.debugTeleport(33);
    run(w, 30);
    const r = World.deserialize(w.serialize());
    const log = new StoryLedger(r.story.flags).entries().map((e) => e.id);
    expect(log).toEqual(expect.arrayContaining(['S0', 'S1']));
    r.debugTeleport(34);
    expect(beatIds(run(r, 30))).not.toContain('S1');
  });

  it('each Recorder sold plays the next Deepreach log; the sale itself reaches the director before the drain', () => {
    const w = world();
    w.drainEvents();
    w.pod.cargo.push({ kind: 'relic', id: RECORDER_RELIC }, { kind: 'mineral', tier: 1 }, { kind: 'relic', id: RECORDER_RELIC });
    expect(w.sellAll().ok).toBe(true);
    const ev = w.drainEvents();
    expect(radios(ev).map((e) => `${e.beat}:${e.sender}`)).toEqual(['L1:Deepreach log', 'L2:Deepreach log']);
    expect(ev).toContainEqual({ t: 'milestone', id: 'payday', title: 'Payday' });
    w.pod.cargo.push({ kind: 'relic', id: RECORDER_RELIC });
    w.sellAll();
    expect(beatIds(w.drainEvents())).toEqual(['L3']);
  });

  it('a refused sale plays nothing', () => {
    const w = world();
    w.drainEvents();
    w.debugTeleport(5);
    w.pod.cargo.push({ kind: 'relic', id: RECORDER_RELIC });
    expect(w.sellAll().ok).toBe(false);
    expect(beatIds(w.drainEvents())).toEqual([]);
  });

  it('the factory hook wakes the count for a tall lift (S8)', () => {
    const w = world();
    w.drainEvents();
    w.noteLiftBuilt(130);
    expect(beatIds(w.drainEvents())).toEqual(['S8', 'S8']);
  });
});

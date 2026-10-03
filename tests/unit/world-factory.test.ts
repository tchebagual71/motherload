// World ↔ factory hosting (04 §3.1; 02 §2.6–2.7, §9; canon §2.1, §4.8–§4.9): discovery, U1, tileChanged, away,
// proximity ghost completion with metered Kits, deconstruct refunds, the Shed's Kits, the Assay Stockpile and
// the Yard expansion.
import { describe, expect, it, vi } from 'vitest';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { POD_H, START_CASH } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import { F, T, type CargoItem } from '../../src/shared/types';
import { DIR, type FactoryApi, type GhostView, type KitSource } from '../../src/factory/api';
import type { PodState } from '../../src/pod/types';
import { GhostBuilder } from '../../src/world/ghostJob';
import { World } from '../../src/world/world';

const intent = (p: Partial<PodIntent>): PodIntent => ({ ...NO_INTENT, ...p });

function newWorld(seed = 7): World {
  return new World({ seed, scope: 'mvp' });
}

/** Stand the pod still in cell (x, r); r = −1 is the Rim surface. */
function standAt(w: World, x: number, r: number): void {
  const p = w.pod;
  p.x = p.prevX = x + 0.5;
  p.y = p.prevY = -(r + 1) + POD_H / 2;
  p.vx = p.vy = 0;
  p.grounded = true;
  p.dig = null;
  p.row = Math.max(0, r);
}

function run(w: World, n: number, input: PodIntent = NO_INTENT, running = true): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    w.step(input, running);
    out.push(...w.drainEvents());
  }
  return out;
}

/** Air, seen cells x0..x1 on row r with a dirt floor and roof (a test corridor). */
function corridor(w: World, x0: number, x1: number, r: number): void {
  const g = w.terrain;
  for (let x = x0; x <= x1; x++) {
    g.set(x, r - 1, T.DIRT);
    g.set(x, r + 1, T.DIRT);
    g.set(x, r, T.AIR);
    g.flags[g.idx(x, r)] |= F.SEEN;
  }
}

/** The scripted lode's drill site carved and seen, the lode discovered (U2). */
function drillSite(w: World): { x: number; y: number } {
  const f = w.factory!;
  const g = w.terrain;
  const plan = f.surveyPlan();
  for (let r = plan.drill.y; r < plan.drill.y + 2; r++) {
    for (let x = plan.drill.x; x < plan.drill.x + 2; x++) {
      g.set(x, r, T.AIR);
      g.flags[g.idx(x, r)] |= F.SEEN;
    }
  }
  for (let r = 0; r <= plan.lift.foot; r++) g.flags[g.idx(plan.lift.x, r)] |= F.SEEN;
  f.discoverLode(w.meta.scriptedLodeId, true);
  return plan.drill;
}

const kits = (w: World): CargoItem[] => w.pod.cargo.filter((c) => c.kind === 'kit');

describe('hosting: world events reach the factory (04 §3.1)', () => {
  it('a discovery passes purityKnown: fixed-purity lodes always, rolled ones only with a Dowser', () => {
    const w = newWorld();
    const f = w.factory!;
    const spy = vi.spyOn(f, 'discoverLode');
    const scripted = w.terrain.lodes[w.meta.scriptedLodeId];
    const rolled = w.terrain.lodes.find((l) => !l.scripted && l.metal === 'hematite')!;
    standAt(w, scripted.x0 - 1, scripted.top - 1);
    run(w, 1);
    expect(spy).toHaveBeenLastCalledWith(scripted.id, true);
    standAt(w, rolled.x0 - 1, rolled.top);
    run(w, 1);
    expect(spy).toHaveBeenLastCalledWith(rolled.id, false);
    const w2 = newWorld();
    w2.debugSetTier('scanner', 3);
    const spy2 = vi.spyOn(w2.factory!, 'discoverLode');
    const rolled2 = w2.terrain.lodes.find((l) => !l.scripted && l.metal === 'hematite')!;
    standAt(w2, rolled2.x0 - 1, rolled2.top);
    run(w2, 1);
    expect(spy2).toHaveBeenCalledWith(rolled2.id, true);
    expect(w2.factory!.isUnlocked('U2')).toBe(true);
  });

  it('a lode found with Tin Ear shows its purity after a later Dowser-or-better scan in range (02 §3.6)', () => {
    const w = newWorld();
    const f = w.factory!;
    const rolled = w.terrain.lodes.find((l) => !l.scripted && l.metal === 'hematite')!;
    standAt(w, rolled.x0 - 1, rolled.top);
    run(w, 2);
    expect(rolled.discovered).toBe(true);
    expect(f.purityKnown(rolled.id)).toBe(false);
    w.debugSetTier('scanner', 3); // Dowser: radius 6
    standAt(w, rolled.x0, rolled.top - 7);
    run(w, 1);
    expect(f.purityKnown(rolled.id)).toBe(false); // out of the scan's reach
    standAt(w, rolled.x0, rolled.top - 6);
    run(w, 1);
    expect(f.purityKnown(rolled.id)).toBe(true);
    expect(World.deserialize(w.serialize(), 'mvp').factory!.purityKnown(rolled.id)).toBe(true);
  });

  it('the scripted lode offers the Starter Kit once (starter-kit event, starterKitReady)', () => {
    const w = newWorld();
    const lode = w.terrain.lodes[w.meta.scriptedLodeId];
    expect(w.starterKitReady()).toBe(false);
    standAt(w, lode.x0 - 1, lode.top - 1);
    const ev = run(w, 3);
    expect(ev.filter((e) => e.t === 'starter-kit')).toHaveLength(1);
    expect(w.starterKitReady()).toBe(true);
    // A non-scripted lode never offers it.
    const other = newWorld();
    const hem = other.terrain.lodes.find((l) => l.metal === 'hematite')!;
    standAt(other, hem.x0 - 1, hem.top);
    expect(run(other, 2).some((e) => e.t === 'starter-kit')).toBe(false);
    expect(other.starterKitReady()).toBe(false);
  });

  it('passing r32 opens U1 and Dot pings the scripted lode exactly once', () => {
    const w = newWorld();
    w.debugTeleport(31);
    let ev = run(w, 2);
    expect(w.factory!.isUnlocked('U1')).toBe(false);
    expect(ev.some((e) => e.t === 'lode-pinged')).toBe(false);
    w.debugTeleport(40);
    ev = run(w, 2);
    expect(w.factory!.isUnlocked('U1')).toBe(true);
    expect(ev.filter((e) => e.t === 'unlock' && e.rung === 'U1')).toHaveLength(1);
    expect(ev.filter((e) => e.t === 'lode-pinged')).toEqual([{ t: 'lode-pinged', lodeId: w.meta.scriptedLodeId }]);
    w.debugTeleport(20);
    run(w, 2);
    w.debugTeleport(45);
    expect(run(w, 2).some((e) => e.t === 'lode-pinged' || (e.t === 'unlock' && e.rung === 'U1'))).toBe(false);
  });

  it('digs and blasts call tileChanged with the changed cells', () => {
    const w = newWorld();
    const spy = vi.spyOn(w.factory!, 'tileChanged');
    corridor(w, 14, 18, 10);
    w.terrain.set(16, 11, T.DIRT);
    standAt(w, 16, 10);
    let dug = false;
    for (let i = 0; i < 80 && !dug; i++) dug = run(w, 1, intent({ sy: -1 })).some((e) => e.t === 'dug');
    expect(dug).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual([{ x: 16, y: 11 }]); // a reused one-cell list (no per-dig allocation)
    spy.mockClear();
    standAt(w, 16, 10);
    w.pod.consumables.pop = 1;
    w.pod.quickSlots[0] = 'pop';
    const ev = run(w, 2, intent({ fireSlot: 0 }));
    const blast = ev.find((e) => e.t === 'explosion');
    expect(blast).toBeDefined();
    const cells = spy.mock.calls.at(-1)![0];
    expect(cells).toHaveLength(9);
    expect(cells).toContainEqual({ x: 16, y: 10 });
  });

  it('setAway sleeps the factory (MVP, 02 §8) and a restored World is never away', () => {
    const w = newWorld();
    const f = w.factory!;
    run(w, 30);
    const t = f.tickNo;
    w.setAway(true);
    expect(f.away).toBe(true);
    run(w, 30);
    expect(f.tickNo).toBe(t);
    const back = World.deserialize(w.serialize(), 'mvp');
    expect(back.factory!.away).toBe(false);
    w.setAway(false);
    run(w, 30);
    expect(f.tickNo).toBe(t + 10);
  });
});

describe('ghost completion from the pod (02 §2.6)', () => {
  it('builds after 60 consecutive steps within 2 tiles, metering Belt Kits least-full first', () => {
    const w = newWorld();
    const f = w.factory!;
    f.discoverLode(w.meta.scriptedLodeId, true);
    corridor(w, 12, 24, 10);
    const ids = f.placeGhost({ kind: 'belt', x: 16, y: 10, dir: 0, length: 5 });
    expect(ids.ok).toBe(true);
    w.pod.cargo.push({ kind: 'kit', id: 'belt' }, { kind: 'kit', id: 'belt', units: 3 });
    standAt(w, 13, 10); // 3 tiles from the run: out of reach
    run(w, 120);
    expect(f.ghosts()).toHaveLength(1);
    expect(w.ghostProgress()).toBeNull();
    standAt(w, 14, 10);
    run(w, 59);
    expect(w.ghostProgress()?.progress).toBeCloseTo(59 / 60);
    expect(f.ghosts()).toHaveLength(1);
    const ev = run(w, 1);
    expect(ev).toContainEqual({ t: 'ghost-complete', kind: 'belt' });
    expect(f.ghosts()).toHaveLength(0);
    expect(kits(w)).toEqual([{ kind: 'kit', id: 'belt', units: 6 }]);
    expect(w.ghostProgress()).toBeNull();
  });

  it('needs the Kit aboard and holds still while the pod is paused', () => {
    const w = newWorld();
    const f = w.factory!;
    f.discoverLode(w.meta.scriptedLodeId, true);
    corridor(w, 12, 24, 10);
    f.placeGhost({ kind: 'belt', x: 16, y: 10, dir: 0, length: 3 });
    standAt(w, 15, 10);
    w.pod.cargo.push({ kind: 'kit', id: 'belt', units: 2 });
    run(w, 90);
    expect(f.ghosts()).toHaveLength(1); // 2 units for a 3-tile run
    w.pod.cargo.push({ kind: 'kit', id: 'belt', units: 2 });
    run(w, 30);
    run(w, 200, NO_INTENT, false); // a sheet: the timer neither runs nor resets
    expect(w.ghostProgress()?.progress).toBeCloseTo(30 / 60);
    run(w, 30);
    expect(f.ghosts()).toHaveLength(0);
    expect(kits(w)).toEqual([{ kind: 'kit', id: 'belt', units: 1 }]);
  });

  it('E_POD: refused with nothing consumed, toasted once, the timer restarts; leaving the footprint builds it', () => {
    const w = newWorld();
    const f = w.factory!;
    const site = drillSite(w);
    const ghost = f.placeGhost({ kind: 'autoDrill', ...site });
    expect(ghost.ok).toBe(true);
    w.pod.cargo.push({ kind: 'kit', id: 'autoDrill' });
    standAt(w, site.x, site.y + 1); // inside the 2×2
    const ev = run(w, 200);
    const toasts = ev.filter((e) => e.t === 'toast');
    expect(toasts).toEqual([{ t: 'toast', text: 'Pip is in the way', tone: 'warn' }]);
    expect(f.ghosts()).toHaveLength(1);
    expect(kits(w)).toEqual([{ kind: 'kit', id: 'autoDrill' }]);
    expect(w.ghostProgress()!.progress).toBeLessThan(1);
    standAt(w, w.meta.surveyColumn, site.y + 1); // beside it, in Dot's shaft
    const done = run(w, 60);
    expect(done).toContainEqual({ t: 'ghost-complete', kind: 'autoDrill' });
    expect(kits(w)).toEqual([]);
  });

  it('a dig under a planned belt drops that job, so newer jobs in reach still build (tileChanged re-checks support)', () => {
    const w = newWorld();
    const f = w.factory!;
    f.discoverLode(w.meta.scriptedLodeId, true);
    corridor(w, 12, 24, 10);
    expect(f.placeGhost({ kind: 'belt', x: 16, y: 10, dir: 0, length: 1 }).ok).toBe(true);
    expect(f.placeGhost({ kind: 'belt', x: 18, y: 10, dir: 0, length: 1 }).ok).toBe(true);
    // No Kit aboard yet: the pod digs out the floor under the older job (only a ghost: nothing anchors it).
    standAt(w, 16, 10);
    let dug = false;
    for (let i = 0; i < 80 && !dug; i++) dug = run(w, 1, intent({ sy: -1 })).some((e) => e.t === 'dug');
    expect(dug).toBe(true);
    expect(w.terrain.get(16, 11)).toBe(T.AIR);
    expect(f.ghosts().map((g) => g.x)).toEqual([18]);
    // With a Belt Kit aboard, in reach of both cells, the remaining job builds.
    w.pod.cargo.push({ kind: 'kit', id: 'belt' });
    standAt(w, 17, 10);
    w.terrain.set(17, 11, T.DIRT);
    const ev = run(w, 120);
    expect(ev.filter((e) => e.t === 'toast')).toEqual([]);
    expect(ev).toContainEqual({ t: 'ghost-complete', kind: 'belt' });
    expect(f.ghosts()).toEqual([]);
    expect(f.beltWords('mine')[10 * 48 + 18]).not.toBe(0);
  });

  it('a belt completed beside the pod mid-dig cancels the dig into its floor (02 §2.3)', () => {
    const w = newWorld();
    const f = w.factory!;
    f.discoverLode(w.meta.scriptedLodeId, true);
    corridor(w, 12, 24, 10);
    expect(f.placeGhost({ kind: 'belt', x: 16, y: 10, dir: 0, length: 1 }).ok).toBe(true);
    w.pod.cargo.push({ kind: 'kit', id: 'belt' });
    standAt(w, 16, 10);
    run(w, 45); // most of the 60-step hold, standing still
    const ev = run(w, 120, intent({ sy: -1 })); // then push down into the job's floor
    const at = (t: GameEvent['t']): number => ev.findIndex((e) => e.t === t);
    expect(at('dig-start')).toBeGreaterThanOrEqual(0);
    expect(at('ghost-complete')).toBeGreaterThan(at('dig-start')); // completed while the dig ran
    expect(at('dug')).toBe(-1);
    expect(ev.filter((e) => e.t === 'dig-refused')).toEqual([{ t: 'dig-refused', x: 16, r: 11, reason: 'anchored' }]);
    expect(f.beltWords('mine')[10 * 48 + 16]).not.toBe(0);
    expect(w.terrain.get(16, 11)).toBe(T.DIRT);
    expect(w.terrain.hasFlag(16, 11, F.ANCHORED)).toBe(true);
  });

  it('deconstructing a built lift foot leaves no rail job waiting for it', () => {
    const w = newWorld();
    const f = w.factory!;
    f.discoverLode(w.meta.scriptedLodeId, true);
    const c = w.meta.surveyColumn;
    for (let r = 0; r <= 45; r++) w.terrain.flags[w.terrain.idx(c, r)] |= F.SEEN;
    expect(f.placeGhost({ kind: 'lift', x: c, foot: 45, top: 0 }).ok).toBe(true);
    w.pod.cargo.push({ kind: 'kit', id: 'liftFoot' }, { kind: 'kit', id: 'liftRail' });
    standAt(w, c, 45);
    run(w, 60);
    expect(f.ghosts().map((g) => g.part)).toEqual(['rail']);
    const lift = f.entities().find((e) => e.kind === 'lift')!;
    expect(w.deconstructUnderground(lift.id).ok).toBe(true);
    expect(f.ghosts()).toEqual([]);
    expect(kits(w).map((k) => (k.kind === 'kit' ? k.id : ''))).toEqual(['liftRail', 'liftFoot']);
  });

  it('a Lift Rail job with no lift under it yet says so, and the job under it still builds', () => {
    const w = newWorld();
    const f = w.factory!;
    f.discoverLode(w.meta.scriptedLodeId, true);
    const c = w.meta.surveyColumn;
    for (let r = 0; r <= 45; r++) w.terrain.flags[w.terrain.idx(c, r)] |= F.SEEN;
    expect(f.placeGhost({ kind: 'lift', x: c, foot: 45, top: 0 }).ok).toBe(true);
    w.pod.cargo.push({ kind: 'kit', id: 'liftRail' });
    const ev: GameEvent[] = [];
    for (let i = 0; i < 150; i++) {
      standAt(w, c, 13); // beside the rail (rows 0–13) and the foot's top (row 14): only the rail's Kit is aboard
      ev.push(...run(w, 1));
    }
    expect(ev.filter((e) => e.t === 'toast')).toEqual([{ t: 'toast', text: 'Build the lift below first', tone: 'warn' }]);
    w.pod.cargo.push({ kind: 'kit', id: 'liftFoot' });
    for (let i = 0; i < 130; i++) {
      standAt(w, c, 13);
      ev.push(...run(w, 1));
    }
    expect(ev.filter((e) => e.t === 'ghost-complete')).toHaveLength(2);
    expect(f.entities().find((e) => e.kind === 'lift')).toMatchObject({ y: 0, h: 46 });
  });
});

describe('GhostBuilder: one job that cannot complete never holds up the rest (02 §2.6)', () => {
  const view = (id: number, x: number): GhostView => ({ id, order: id, kind: 'belt', mk: 1, x, y: 10, w: 1, h: 1, dir: 0, part: null, kit: 'belt', kitUnits: 1 });

  it('a refused job yields to the next oldest in reach; alone, it is retried; each refusal toasts once', () => {
    let jobs = [view(1, 16), view(2, 18)];
    const fake = {
      topologyVersion: 0,
      ghosts: () => jobs,
      completeGhost(id: number) {
        if (id === 1) return { ok: false, code: 'E_FLOOR', x: 16, y: 10 };
        jobs = jobs.filter((j) => j.id !== id);
        this.topologyVersion++;
        return { ok: true, id: 0 };
      },
    };
    const f = fake as unknown as FactoryApi;
    const pod = { x: 17.5, y: -10.5 } as PodState;
    const cargo: KitSource = { count: () => 8, take: () => {} };
    const toasts: string[] = [];
    const b = new GhostBuilder();
    const done: number[] = [];
    for (let i = 0; i < 300; i++) {
      const r = b.step(f, pod, cargo, (e) => e.t === 'toast' && toasts.push(e.text));
      if (r.done) done.push(r.job.id);
    }
    expect(done).toEqual([2]); // job 2 built 60 steps after job 1's refusal
    expect(toasts).toEqual(['Needs a floor']);
    expect(b.progress()?.id).toBe(1); // alone in reach, job 1 keeps being retried
  });
});

describe('deconstructUnderground (02 §2.7 refunds)', () => {
  function builtDrill(): { w: World; id: number; site: { x: number; y: number } } {
    const w = newWorld();
    const f = w.factory!;
    const site = drillSite(w);
    f.placeGhost({ kind: 'autoDrill', ...site });
    w.pod.cargo.push({ kind: 'kit', id: 'autoDrill' });
    standAt(w, w.meta.surveyColumn, site.y + 1);
    run(w, 60);
    const id = f.entities().find((e) => e.kind === 'autoDrill')!.id;
    return { w, id, site };
  }

  it('the Kit goes to the bay when the pod is within 2 tiles', () => {
    const { w, id } = builtDrill();
    expect(w.deconstructUnderground(id).ok).toBe(true);
    expect(kits(w)).toEqual([{ kind: 'kit', id: 'autoDrill' }]);
    expect(w.factory!.stockpileCount('kit:autoDrill')).toBe(0);
  });

  it('far away, or with a full bay, the Kit goes to the Stockpile', () => {
    const far = builtDrill();
    standAt(far.w, 7, -1);
    expect(far.w.deconstructUnderground(far.id).ok).toBe(true);
    expect(kits(far.w)).toEqual([]);
    expect(far.w.factory!.stockpileCount('kit:autoDrill')).toBe(1);

    const full = builtDrill();
    while (full.w.stats().slotsUsed < full.w.stats().baySlots) full.w.pod.cargo.push({ kind: 'mineral', tier: 1 });
    expect(full.w.deconstructUnderground(full.id).ok).toBe(true);
    expect(kits(full.w)).toEqual([]);
    expect(full.w.factory!.stockpileCount('kit:autoDrill')).toBe(1);
  });

  it('underground belt tiles refund Belt Kit units that merge into a partial Kit', () => {
    const w = newWorld();
    const f = w.factory!;
    f.discoverLode(w.meta.scriptedLodeId, true);
    corridor(w, 12, 24, 10);
    f.placeGhost({ kind: 'belt', x: 16, y: 10, dir: 0, length: 4 });
    w.pod.cargo.push({ kind: 'kit', id: 'belt' });
    standAt(w, 15, 10);
    run(w, 60);
    expect(kits(w)).toEqual([{ kind: 'kit', id: 'belt', units: 4 }]);
    expect(w.removeUndergroundBelts([16, 17, 18].map((x) => ({ x, y: 10 }))).ok).toBe(true);
    expect(kits(w)).toEqual([{ kind: 'kit', id: 'belt', units: 7 }]);
  });

  it('a Yard id falls through to the crane deconstruct', () => {
    const w = newWorld();
    const bin = w.factory!.entities().find((e) => e.kind === 'bin')!;
    expect(w.deconstructUnderground(bin.id).ok).toBe(true);
    expect(w.factory!.entity(bin.id)).toBeNull();
  });
});

describe('the Starter Kit at the Supply Shed (canon §2.1)', () => {
  function readyWorld(): World {
    const w = newWorld();
    const lode = w.terrain.lodes[w.meta.scriptedLodeId];
    standAt(w, lode.x0 - 1, lode.top - 1);
    run(w, 2);
    standAt(w, 41, -1);
    return w;
  }

  it('is refused whole, with the slot count, when the bay lacks 5 slots', () => {
    const w = readyWorld();
    for (let i = 0; i < 3; i++) w.pod.cargo.push({ kind: 'mineral', tier: 1 });
    const before = w.pod.cargo.length;
    expect(w.claimStarterKit()).toEqual({ ok: false, reason: 'Need 5 free bay slots (have 4)' });
    expect(w.pod.cargo.length).toBe(before);
    expect(w.starterKitReady()).toBe(true);
    w.pod.cargo.length = 0;
    expect(w.claimStarterKit().ok).toBe(true);
    expect(kits(w).map((k) => (k.kind === 'kit' ? k.id : ''))).toEqual(['autoDrill', 'liftFoot', 'liftRail', 'belt', 'belt']);
  });

  it('counts as collected for the goal chip only when claimed (ob:kit), also for older saves', () => {
    const w = readyWorld();
    expect(w.story.flags['ob:kit']).toBeUndefined(); // "Collect your Starter Kit at the Shed" still shows
    expect(w.claimStarterKit().ok).toBe(true);
    w.drainEvents();
    expect(w.story.flags['ob:kit']).toBe(true);
    // A save from before the fix marked it at discovery; while it still waits at the Shed, the goal returns.
    const old = readyWorld();
    old.story.flags['ob:kit'] = true;
    const back = World.deserialize(old.serialize(), 'mvp');
    expect(back.story.flags['ob:kit']).toBeUndefined();
    expect(World.deserialize(w.serialize(), 'mvp').story.flags['ob:kit']).toBe(true);
  });

  it('survives a save: ready and claimed are story flags', () => {
    const w = readyWorld();
    const back = World.deserialize(w.serialize(), 'mvp');
    expect(back.starterKitReady()).toBe(true);
    expect(back.claimStarterKit().ok).toBe(true);
    const again = World.deserialize(back.serialize(), 'mvp');
    expect(again.starterKitReady()).toBe(false);
    expect(again.claimStarterKit().ok).toBe(false);
  });
});

describe('Supply Shed Kits (02 §3.1, §3.7)', () => {
  it('lists the MVP Kits with prices from the item registry and rung locks', () => {
    const w = newWorld();
    const shop = w.kitShop();
    expect(shop.map((k) => [k.id, k.name, k.price, k.slots, k.mass])).toEqual([
      ['belt', 'Belt Kit', 80, 1, 1],
      ['router', 'Router Kit', 60, 1, 1],
      ['autoDrill', 'Auto-Drill Kit', 500, 1, 5],
      ['liftFoot', 'Lift Foot Kit', 400, 1, 5],
      ['liftRail', 'Lift Rail', 100, 1, 2],
    ]);
    expect(shop.every((k) => !k.available)).toBe(true);
    expect(shop.find((k) => k.id === 'belt')!.blocker).toBe('Unlocks: Discover a lode');
    expect(shop.find((k) => k.id === 'liftRail')!.blocker).toBe('Unlocks: Discover a lode');
    w.factory!.discoverLode(w.meta.scriptedLodeId, true);
    const open = w.kitShop();
    expect(open.filter((k) => k.available).map((k) => k.id)).toEqual(['belt', 'autoDrill', 'liftFoot', 'liftRail']);
    expect(open.find((k) => k.id === 'router')!.blocker).toBe('Unlocks: Produce an ingot');
  });

  it('buys to the bay or to the Stockpile, loads from the Stockpile, and refuses cleanly', () => {
    const w = newWorld();
    const f = w.factory!;
    expect(w.buyKit('belt', 1, 'cargo')).toEqual({ ok: false, reason: 'Unlocks: Discover a lode' });
    f.discoverLode(w.meta.scriptedLodeId, true);
    expect(w.buyKit('belt', 1, 'cargo')).toEqual({ ok: false, reason: `Need $${80 - START_CASH} more` });
    w.debugGiveCash(5_000);
    const cash = w.wallet.cash;
    expect(w.buyKit('belt', 2, 'cargo').ok).toBe(true);
    expect(w.wallet.cash).toBe(cash - 160);
    expect(w.kitShop().find((k) => k.id === 'belt')!.inCargo).toBe(2);
    expect(w.buyKit('liftFoot', 3, 'stockpile').ok).toBe(true);
    expect(f.stockpileCount('kit:liftFoot')).toBe(3);
    expect(w.kitShop().find((k) => k.id === 'liftFoot')!.inStockpile).toBe(3);
    expect(w.loadKit('liftFoot', 2).ok).toBe(true);
    expect(f.stockpileCount('kit:liftFoot')).toBe(1);
    expect(w.loadKit('liftFoot', 2)).toEqual({ ok: false, reason: 'Only 1 in the Stockpile' });
    expect(w.pod.cargo.filter((c) => c.kind === 'kit' && c.id === 'liftFoot')).toHaveLength(2);
    // Bay: 7 slots, 4 used.
    expect(w.buyKit('autoDrill', 4, 'cargo')).toEqual({ ok: false, reason: 'Bay has room for 3 slots' });
    expect(w.wallet.cash).toBe(cash - 160 - 1_200);
    expect(w.buyKit('router', 1, 'cargo')).toEqual({ ok: false, reason: 'Unlocks: Produce an ingot' });
    w.debugTeleport(5);
    expect(w.buyKit('belt', 1, 'cargo')).toEqual({ ok: false, reason: 'Land on the Rim first' });
  });
});

describe('Assay "Stockpile" (canon §4.9; 02 §4.3)', () => {
  it('puts bulk specimens into the Bins; gems and relics stay Assay-only; locked before U2', () => {
    const w = newWorld();
    const f = w.factory!;
    w.pod.cargo.push({ kind: 'mineral', tier: 1 }, { kind: 'mineral', tier: 1 }, { kind: 'mineral', tier: 3 }, { kind: 'mineral', tier: 7 }, { kind: 'relic', id: 0 });
    expect(w.stockpileCargo({ kind: 'mineral', tier: 1 }, 'all')).toEqual({ ok: false, reason: 'Unlocks: Discover a lode' });
    f.discoverLode(w.meta.scriptedLodeId, true);
    expect(w.stockpileCargo({ kind: 'mineral', tier: 1 }, 'all')).toMatchObject({ ok: true, amount: 2 });
    expect(w.stockpileCargo({ kind: 'mineral', tier: 3 }, 1)).toMatchObject({ ok: true, amount: 1 });
    expect(f.stockpileCount('spec1')).toBe(2);
    expect(f.stockpileCount('spec3')).toBe(1);
    expect(w.stockpileCargo({ kind: 'mineral', tier: 7 }, 'all').ok).toBe(false);
    expect(w.stockpileCargo({ kind: 'relic', id: 0 }, 'all').ok).toBe(false);
    expect(w.stockpileCargo({ kind: 'mineral', tier: 2 }, 'all')).toEqual({ ok: false, reason: 'Nothing like that aboard' });
    expect(w.pod.cargo).toEqual([
      { kind: 'mineral', tier: 7 },
      { kind: 'relic', id: 0 },
    ]);
  });

  it('fills what the Bins hold and keeps the rest aboard', () => {
    const w = newWorld();
    const f = w.factory!;
    f.discoverLode(w.meta.scriptedLodeId, true);
    f.stockpilePut([{ item: 'gear', n: f.stockpileFree() - 2 }]);
    for (let i = 0; i < 5; i++) w.pod.cargo.push({ kind: 'mineral', tier: 2 });
    expect(w.stockpileCargo({ kind: 'mineral', tier: 2 }, 'all')).toEqual({ ok: true, message: '2 to the Stockpile · Bins full', amount: 2 });
    expect(w.pod.cargo).toHaveLength(3);
    expect(w.stockpileCargo({ kind: 'mineral', tier: 2 }, 'all')).toEqual({ ok: false, reason: 'Stockpile full: build a Bin' });
  });

  it('Stockpiled tier 1–4 specimens unloaded from a Bin smelt into ingots (S7–S10), and an Assembler makes Hull Plates', () => {
    const w = newWorld();
    const f = w.factory!;
    f.discoverLode(w.meta.scriptedLodeId, true); // U2
    w.debugGiveCash(10_000);
    expect(w.expandYard().ok).toBe(true); // 16 rows
    const survey = f.entities().find((e) => e.kind === 'bin')!;
    const x = survey.x; // the survey Bin (rows 7–8) faces S, unloading at (x + 1, 9)
    const must = <T extends { ok: boolean }>(r: T): T => {
      if (!r.ok) throw new Error(JSON.stringify(r));
      return r;
    };
    // Survey Bin → belt → Smelter (rows 10–11, S) → belt → Bin B (rows 13–14, E) → belts → Assembler → belts → Bin C.
    must(f.paintBelts([{ x: x + 1, y: 9 }], 1, DIR.S));
    const smelter = (must(f.place('smelter', 1, x, 10, DIR.S)) as { id: number }).id;
    must(f.paintBelts([{ x: x + 1, y: 12 }], 1, DIR.S));
    const binB = (must(f.place('bin', 1, x, 13, DIR.E)) as { id: number }).id;
    // Specimens bought nothing: they came up in the bay and the Assay's toggle stockpiles them into the survey Bin.
    for (const tier of [1, 1, 2, 3, 4]) w.pod.cargo.push({ kind: 'mineral', tier });
    for (const tier of [1, 2, 3, 4]) expect(w.stockpileCargo({ kind: 'mineral', tier }, 'all').ok).toBe(true);
    expect(f.inspect(survey.id)!.contents.map((c) => [c.item, c.n])).toEqual([
      ['spec1', 2],
      ['spec2', 1],
      ['spec3', 1],
      ['spec4', 1],
    ]);
    const held = (id: number, item: string): number => f.inspect(id)?.contents.find((c) => c.item === item)?.n ?? 0;
    for (const tier of [1, 2, 3, 4]) {
      must(f.setUnloadFilter(survey.id, `spec${tier}`));
      for (let i = 0; i < 3_000 && held(survey.id, `spec${tier}`) > 0; i++) w.step(NO_INTENT, true);
    }
    // 5 crafts of 6 s, one recipe at a time (the next specimen waits at the line head until the buffer empties).
    for (let i = 0; i < 6_000 && held(binB, 'goldIngot') < 2; i++) w.step(NO_INTENT, true);
    // 1 specimen → 2 ingots of its metal (the lossy path, 02 §4.2).
    expect(['ironIngot', 'copperIngot', 'cobaltIngot', 'goldIngot'].map((i) => held(binB, i))).toEqual([4, 2, 2, 2]);
    expect(f.entity(smelter)!.status).toBe('idle');
    // The first ingot opened U3: an Assembler on A3 (2 Iron Ingots + 1 Cobalt Ingot → Hull Plate).
    expect(f.isUnlocked('U3')).toBe(true);
    must(f.paintBelts([{ x: x + 2, y: 14 }, { x: x + 3, y: 14 }], 1, DIR.E));
    const asm = (must(f.place('assembler', 1, x + 4, 13, DIR.E)) as { id: number }).id;
    must(f.setRecipe(asm, 'A3'));
    must(f.paintBelts([{ x: x + 6, y: 14 }, { x: x + 7, y: 14 }], 1, DIR.E));
    const binC = (must(f.place('bin', 1, x + 8, 13, DIR.E)) as { id: number }).id;
    for (const ingot of ['ironIngot', 'cobaltIngot']) {
      must(f.setUnloadFilter(binB, ingot));
      for (let i = 0; i < 3_000 && held(binB, ingot) > 0; i++) w.step(NO_INTENT, true);
    }
    for (let i = 0; i < 6_000 && held(binC, 'hullPlate') < 2; i++) w.step(NO_INTENT, true);
    expect(held(binC, 'hullPlate')).toBe(2);
    expect(f.stockpileCount('hullPlate')).toBe(2);
    expect(w.garageCards().length).toBeGreaterThan(0);
    expect(f.debug.conservationOk()).toBe(true);
  });

  it('sellAll keeps rows the toggle holds back', () => {
    const w = newWorld();
    w.pod.cargo.push({ kind: 'mineral', tier: 1 }, { kind: 'mineral', tier: 2 }, { kind: 'mineral', tier: 1 });
    const r = w.sellAll([{ kind: 'mineral', tier: 1 }]);
    expect(r).toMatchObject({ ok: true, amount: 60 });
    expect(w.pod.cargo).toEqual([
      { kind: 'mineral', tier: 1 },
      { kind: 'mineral', tier: 1 },
    ]);
  });
});

describe("Yard Expansion I at Dot's office (canon §3.1)", () => {
  it('opens with U2, costs $2,500 once, and the next step waits for v1', () => {
    const w = newWorld();
    const f = w.factory!;
    expect(w.expandYard()).toEqual({ ok: false, reason: 'Unlocks: Discover a lode' });
    f.discoverLode(w.meta.scriptedLodeId, true);
    expect(w.expandYard()).toEqual({ ok: false, reason: 'Need $2,480 more' });
    w.debugGiveCash(3_000);
    const ev: GameEvent[] = [];
    expect(w.expandYard()).toEqual({ ok: true, message: 'Yard expanded to 48 × 16', amount: 16 });
    ev.push(...w.drainEvents());
    expect(ev).toContainEqual({ t: 'purchase', kind: 'yard', amount: 2_500 });
    expect(f.yardRows).toBe(16);
    expect(w.wallet.cash).toBe(START_CASH + 500);
    expect(w.expandYard()).toEqual({ ok: false, reason: 'More Yard comes in the next update' });
  });
});

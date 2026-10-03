// StoryDirector (01 §7.4, §8; canon §3.9): beats and milestones fire once from events and the pod snapshot, and
// everything they decide lives in the flags a save carries.
import { describe, expect, it } from 'vitest';
import type { Line } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import type { Scope } from '../../src/shared/types';
import { STARTER_KIT_PURCHASE, StoryDirector } from '../../src/story/director';
import { StoryLedger } from '../../src/story/ledger';
import { isRungUnlocked } from '../../src/story/plans';
import type { StoryContext, StorySnapshot } from '../../src/story/types';

const TIERS: Record<Line, number> = { drill: 1, hull: 1, engine: 1, tank: 1, radiator: 1, bay: 1, scanner: 1 };
const SCRIPTED = 0;
const IRIDIUM = 9;

interface Rig {
  dir: StoryDirector;
  flags: Record<string, boolean>;
  out: GameEvent[];
  snap: StorySnapshot;
  ctx: StoryContext & { load: number; plates: number };
  /** One step: these events, then the snapshot as patched. */
  step(events?: GameEvent[], patch?: Partial<StorySnapshot>): GameEvent[];
}

function rig(scope: Scope = 'mvp', flags: Record<string, boolean> = {}): Rig {
  const ctx = {
    scope,
    scriptedLodeId: SCRIPTED,
    iridiumLodeId: IRIDIUM,
    load: 0,
    plates: 0,
    loadFrac: () => ctx.load,
    partCount: (p: string) => (p === 'hullPlate' ? ctx.plates : 0),
    billHasPart: (_line: Line, tier: number, part: string) => tier >= 3 && part === 'hullPlate',
  };
  const out: GameEvent[] = [];
  const dir = new StoryDirector(ctx);
  const snap: StorySnapshot = { stepNo: 1, row: 0, depthFt: 0, grounded: true, onRim: true, alive: true, magmaPending: 0, trips: 0, cash: 20, tiers: TIERS };
  const r: Rig = {
    dir,
    flags,
    out,
    snap,
    ctx,
    step(events = [], patch = {}) {
      Object.assign(snap, patch);
      const mark = out.length;
      dir.onEvents(events, snap, flags, (e) => out.push(e));
      snap.stepNo++;
      return out.slice(mark);
    },
  };
  return r;
}

const radios = (ev: GameEvent[]) => ev.filter((e): e is Extract<GameEvent, { t: 'radio' }> => e.t === 'radio');
const milestones = (ev: GameEvent[]) => ev.filter((e) => e.t === 'milestone').map((e) => (e as Extract<GameEvent, { t: 'milestone' }>).id);
const beats = (ev: GameEvent[]) => radios(ev).map((e) => `${e.beat}:${e.sender}:${e.cards.length}`);

describe('game start and depth beats', () => {
  it('a new claim hears S0 once and opens rung U0', () => {
    const r = rig();
    r.dir.start(r.flags, (e) => r.out.push(e));
    r.dir.start(r.flags, (e) => r.out.push(e));
    expect(beats(r.out)).toEqual(['S0:Dot:1']);
    expect(radios(r.out)[0].cards[0]).toMatch(/Pump House/);
    expect(isRungUnlocked(r.flags, 'U0')).toBe(true);
  });

  it('M0 has no story at all (01 §2.8)', () => {
    const r = rig('m0');
    r.dir.start(r.flags, (e) => r.out.push(e));
    r.step([{ t: 'incentive', row: 40, ft: 500, cash: 1_000 }], { row: 40 });
    r.dir.recordersSold(2, r.flags, (e) => r.out.push(e));
    expect(r.out).toEqual([]);
    expect(r.flags).toEqual({});
  });

  it('the first pass of r32 pings the scripted lode (S1, U1), once', () => {
    const r = rig();
    expect(r.step([], { row: 31, grounded: false })).toEqual([]);
    const ev = r.step([], { row: 32 });
    expect(beats(ev)).toEqual(['S1:Dot:3']);
    expect(ev).toContainEqual({ t: 'lode-pinged', lodeId: SCRIPTED });
    expect(isRungUnlocked(r.flags, 'U1')).toBe(true);
    expect(r.flags[`ping:${SCRIPTED}`]).toBe(true);
    expect(r.step([], { row: 40 })).toEqual([]);
  });

  it('first reach of r180 is Gran’s note on the Poor Iridium lode (S9)', () => {
    const r = rig();
    const ev = r.step([], { row: 180 });
    expect(beats(ev)).toEqual(['S1:Dot:3', 'S9:Dot:2']);
    expect(ev).toContainEqual({ t: 'lode-pinged', lodeId: IRIDIUM });
  });

  it('incentives carry their beat and milestone (S2–S4)', () => {
    const r = rig();
    r.step([], { row: 33 });
    const a = r.step([{ t: 'incentive', row: 40, ft: 500, cash: 1_000 }], { row: 40 });
    expect(beats(a)).toEqual(['S2:Dot:1']);
    expect(milestones(a)).toEqual(['fiveHundredClub']);
    const b = r.step([{ t: 'incentive', row: 80, ft: 1_000, cash: 3_000 }], { row: 80 });
    expect(beats(b)).toEqual(['S3:Dot:1']);
    expect(milestones(b)).toEqual(['grand']);
    r.step([], { row: 200 });
    const c = r.step([{ t: 'incentive', row: 280, ft: 3_500, cash: 25_000 }], { row: 280 });
    expect(beats(c)).toEqual(['S4:Dot:1']);
    expect(milestones(c)).toEqual(['bigIncentive']);
  });

  it('the MVP Seal answers a push into r320 or a landing on it (S11); v1 has no S11', () => {
    const r = rig();
    const ev = r.step([{ t: 'dig-refused', x: 7, r: 320, reason: 'floor' }], { row: 319 });
    expect(beats(ev)).toContain('S11:Dot:1');
    const v = rig('v1');
    expect(beats(v.step([{ t: 'dig-refused', x: 7, r: 320, reason: 'floor' }], { row: 319 }))).not.toContain('S11:Dot:1');
    const land = rig();
    land.flags['tx:0:S1'] = land.flags['tx:1:S9'] = true;
    expect(beats(land.step([], { row: 319, grounded: true }))).toEqual(['S11:Dot:1']);
  });
});

describe('system beats', () => {
  it('finding the scripted lode is S5 + Old Ping; any lode opens U2', () => {
    const r = rig();
    const other = r.step([{ t: 'lode-discovered', lodeId: 3 }]);
    expect(radios(other)).toEqual([]);
    expect(isRungUnlocked(r.flags, 'U2')).toBe(true);
    const ev = r.step([{ t: 'lode-discovered', lodeId: SCRIPTED }]);
    expect(beats(ev)).toEqual(['S5:Dot:3']);
    expect(milestones(ev)).toEqual(['oldPing']);
  });

  it('the first Hardrock refusal is Channel Zero in chains and links, then Dot (S7)', () => {
    const r = rig();
    r.step([], { row: 33 }); // S1 out of the way
    const depthFt = 130.5 * 12.5; // 1,631.25 ft = 2,472 links
    const ev = r.step([{ t: 'dig-refused', x: 9, r: 131, reason: 'hardrock' }], { row: 130, depthFt });
    expect(beats(ev)).toEqual(['S7:Channel Zero:1', 'S7:Dot:2']);
    expect(radios(ev)[0].cards[0]).toBe('…24 chains, 72 links. 24 chains, 73 links. Mark.');
    expect(milestones(ev)).toEqual(['clink', 'wrongNumber']);
    expect(r.step([{ t: 'dig-refused', x: 9, r: 131, reason: 'hardrock' }])).toEqual([]);
    expect(new StoryLedger(r.flags).beatValue('S7')).toBe(2_472);
  });

  it('a lift taller than 100 rows wakes the count (S8)', () => {
    const r = rig();
    r.dir.liftBuilt(45, r.flags, (e) => r.out.push(e));
    expect(r.out).toEqual([]);
    r.dir.liftBuilt(120, r.flags, (e) => r.out.push(e));
    expect(beats(r.out)).toEqual(['S8:Channel Zero:1', 'S8:Dot:2']);
    expect(radios(r.out)[0].cards[0]).toBe('…120 buckets. 120 links. Mark.');
    expect(radios(r.out)[1].cards[0]).toMatch(/^120\. /);
  });

  it('FirstLiftDelivery is S6 + Hands Off; the first ingot opens U3; unlock events set their rung', () => {
    const r = rig();
    const ev = r.step([{ t: 'first-lift-delivery' }]);
    expect(beats(ev)).toEqual(['S6:Dot:2']);
    expect(milestones(ev)).toEqual(['handsOff']);
    r.step([{ t: 'first-ingot', item: 'copperIngot' }, { t: 'ghost-complete', kind: 'autoDrill' }]);
    expect(isRungUnlocked(r.flags, 'U3')).toBe(true);
    expect(r.flags['ob:ingot'] && r.flags['ob:drill']).toBe(true);
    // The Starter Kit counts as collected when it is handed over at the Shed, not when it becomes available.
    r.step([{ t: 'starter-kit' }, { t: 'purchase', kind: 'kit', amount: 80, kit: 'belt' }]);
    expect(r.flags['ob:kit']).toBeUndefined();
    r.step([{ t: 'purchase', kind: 'kit', amount: 0, kit: STARTER_KIT_PURCHASE }]);
    expect(r.flags['ob:kit']).toBe(true);
    r.step([{ t: 'unlock', rung: 'U2', label: 'Lode works' }]);
    expect(isRungUnlocked(r.flags, 'U2')).toBe(true);
  });

  it('possession recipes announced by unlock events (A5–A8) leave no rung flag in the save (INT-9)', () => {
    const r = rig();
    r.step([
      { t: 'unlock', rung: 'A5', label: 'Circuit' },
      { t: 'unlock', rung: 'A8', label: 'Pressure Vessel' },
      { t: 'unlock', rung: 'U10', label: 'Mk III' },
    ]);
    expect(Object.keys(r.flags).filter((k) => k.startsWith('rung:'))).toEqual(['rung:U10']);
  });

  it('Recorders sold play Deepreach logs 1–6 in order, then nothing (01 §7.5)', () => {
    const r = rig();
    const emit = (e: GameEvent) => r.out.push(e);
    r.dir.recordersSold(2, r.flags, emit);
    r.dir.recordersSold(5, r.flags, emit);
    expect(radios(r.out).map((e) => e.beat)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(radios(r.out).every((e) => e.sender === 'Deepreach log')).toBe(true);
    expect(new StoryLedger(r.flags).logsHeard()).toBe(6);
  });
});

describe('milestones (01 §8)', () => {
  it('first refuel, sale and upgrade; a Hull Plate bill is Plated', () => {
    const r = rig();
    expect(milestones(r.step([{ t: 'purchase', kind: 'fuel', amount: 4 }]))).toEqual(['toppedOff']);
    expect(milestones(r.step([{ t: 'sale', amount: 300, count: 7 }]))).toEqual(['payday']);
    expect(milestones(r.step([{ t: 'purchase', kind: 'upgrade', amount: 750, line: 'bay', tier: 2 }]))).toEqual(['basketCase']);
    expect(milestones(r.step([{ t: 'purchase', kind: 'upgrade', amount: 2_000, line: 'drill', tier: 3 }]))).toEqual(['plated']);
  });

  it('Co-op Credit also tops you off; a stockpiled Hull Plate is Plated on the next poll', () => {
    const r = rig();
    expect(milestones(r.step([{ t: 'coop-credit', liters: 5 }]))).toEqual(['toppedOff']);
    r.ctx.plates = 1;
    let got: string[] = [];
    for (let i = 0; i < 31 && got.length === 0; i++) got = milestones(r.step());
    expect(got).toEqual(['plated']);
  });

  it('Pop Goes the Shale: a charge whose blast covers a refused Hardrock cell', () => {
    const r = rig();
    r.step([{ t: 'dig-refused', x: 10, r: 140, reason: 'hardrock' }], { depthFt: 1_750 });
    expect(milestones(r.step([{ t: 'explosion', x: 10, r: 139, radius: 1 }]))).toEqual([]); // methane-style, no charge
    expect(milestones(r.step([{ t: 'consumable-used', id: 'pop' }, { t: 'explosion', x: 5, r: 139, radius: 1 }]))).toEqual([]);
    expect(milestones(r.step([{ t: 'consumable-used', id: 'pop' }, { t: 'explosion', x: 10, r: 139, radius: 1 }]))).toEqual(['popGoesTheShale']);
  });

  it('Featherfall: 30 rows of fall and a landing without damage', () => {
    const r = rig();
    r.step([], { grounded: false, row: 2 });
    for (let row = 3; row <= 33; row++) r.step([], { grounded: false, row });
    expect(milestones(r.step([{ t: 'landed', v: 2 }], { grounded: true, row: 34 }))).toEqual(['featherfall']);

    const hard = rig();
    hard.step([], { grounded: false, row: 1 });
    expect(milestones(hard.step([{ t: 'landed', v: 9 }, { t: 'damage', amount: 5, cause: 'landing' }], { grounded: true, row: 40 }))).toEqual([]);

    const short = rig();
    short.step([], { grounded: false, row: 10 });
    expect(milestones(short.step([{ t: 'landed', v: 2 }], { grounded: true, row: 39 }))).toEqual([]);
  });

  it('Hot Feet: surviving the second Magma hit', () => {
    const r = rig();
    expect(milestones(r.step([{ t: 'damage', amount: 29, cause: 'magma' }], { magmaPending: 6 }))).toEqual([]);
    expect(milestones(r.step([{ t: 'damage', amount: 29, cause: 'magma' }], { magmaPending: 0 }))).toEqual(['hotFeet']);
    const dead = rig();
    dead.step([{ t: 'damage', amount: 29, cause: 'magma' }], { magmaPending: 6 });
    expect(milestones(dead.step([{ t: 'damage', amount: 29, cause: 'magma' }], { magmaPending: 0, alive: false }))).toEqual([]);
  });

  it('Heavy Hauler: a Rim arrival at ≥ 90% of the hover cap', () => {
    const r = rig();
    r.ctx.load = 0.85;
    expect(milestones(r.step([{ t: 'trip-end', trip: 1, deepestRow: 30 }]))).toEqual([]);
    r.ctx.load = 0.92;
    expect(milestones(r.step([{ t: 'trip-end', trip: 2, deepestRow: 30 }]))).toEqual(['heavyHauler']);
  });
});

describe('persistence through flags', () => {
  it('a restored director never repeats what the flags record; the log keeps firing order', () => {
    const r = rig();
    r.dir.start(r.flags, (e) => r.out.push(e));
    r.step([{ t: 'purchase', kind: 'fuel', amount: 4 }], { row: 35 });
    const copy = JSON.parse(JSON.stringify(r.flags)) as Record<string, boolean>;
    const again = rig('mvp', copy);
    expect(again.step([{ t: 'purchase', kind: 'fuel', amount: 4 }], { row: 36 })).toEqual([]);
    const log = new StoryLedger(copy).entries().map((e) => `${e.kind}:${e.id}`);
    expect(log).toEqual(['beat:S0', 'milestone:toppedOff', 'beat:S1']);
  });

  it('ignores the events it emits itself when they are passed back', () => {
    const r = rig();
    const ev = r.step([], { row: 32 });
    expect(r.step(ev)).toEqual([]);
  });
});

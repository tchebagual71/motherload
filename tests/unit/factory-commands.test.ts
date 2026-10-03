import { describe, expect, it } from 'vitest';
import { F, T } from '../../src/shared/types';
import { Factory } from '../../src/factory/factory';
import { Cargo, ONBOARD, POD_AWAY, Wallet, addLode, carve, cloneGrid, onboardingGrid, rig } from './factory.helpers';

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

/** Underground test bench: a 12 × 4 hall at rows 20–23, x 30–41, floored by dirt at row 24. */
function hall() {
  const g = onboardingGrid();
  carve(g, 30, 20, 41, 23);
  const r = rig({}, g);
  r.f.discoverLode(0, false);
  r.f.unlockRung('U3');
  return r;
}

describe('factory commands: §2.5 placement codes', () => {
  it('E_LOCKED: building or Mk not unlocked, or out of scope', () => {
    const { f } = rig();
    expect(f.canPlace('smelter', 1, 30, 5, 0)).toEqual({ ok: false, code: 'E_LOCKED', rung: 'U2' });
    f.discoverLode(0, false);
    expect(f.canPlace('smelter', 1, 30, 5, 0)).toBeNull();
    expect(f.canPlace('assembler', 1, 30, 5, 0)).toEqual({ ok: false, code: 'E_LOCKED', rung: 'U3' });
    expect(f.canPlace('silo', 1, 30, 5, 0)).toEqual({ ok: false, code: 'E_LOCKED', rung: 'U8' });
    expect(f.paintBelts([{ x: 30, y: 5 }], 2)).toEqual({ ok: false, code: 'E_LOCKED', rung: 'U8' });
    expect(f.canPlaceGhost({ kind: 'autoDrill', mk: 2, x: 20, y: 44 })).toEqual({ ok: false, code: 'E_LOCKED', rung: 'U8' });
  });

  it('E_YARD: outside purchased rows, on the Rim strip, or under a Rim building', () => {
    const { f } = rig();
    f.discoverLode(0, false);
    expect(f.canPlace('bin', 1, 30, 8, 0)).toMatchObject({ code: 'E_YARD', x: 30, y: 9 });
    expect(f.paintBelts([{ x: 25, y: 0 }], 1)).toMatchObject({ code: 'E_YARD' });
    expect(f.canPlace('smelter', 1, 3, 3, 0)).toMatchObject({ code: 'E_YARD' }); // Pump House, rows 1–3
    must(f.expandYard());
    expect(f.yardRows).toBe(16);
    expect(f.canPlace('bin', 1, 30, 8, 0)).toBeNull();
  });

  it('E_OCCUPIED: Yard cell taken; underground mount or ghost already there', () => {
    const r = hall();
    const { f } = r;
    expect(f.canPlace('bin', 1, ONBOARD.column, 7, 0)).toMatchObject({ code: 'E_OCCUPIED' });
    must(f.paintBelts([{ x: 30, y: 6 }], 1));
    expect(f.canPlace('smelter', 1, 29, 5, 0)).toMatchObject({ code: 'E_OCCUPIED', x: 30, y: 6 });
    must(f.placeGhost({ kind: 'router', x: 33, y: 23 }));
    expect(f.canPlaceGhost({ kind: 'belt', x: 32, y: 23, dir: 0, length: 3 })).toMatchObject({ code: 'E_OCCUPIED', x: 33, y: 23 });
  });

  it('E_SOLID / E_UNSEEN: underground cells must be excavated and seen', () => {
    const r = hall();
    r.grid.flags[r.grid.idx(29, 23)] |= F.SEEN; // seen but still dirt
    expect(r.f.canPlaceGhost({ kind: 'router', x: 29, y: 23 })).toMatchObject({ code: 'E_SOLID', x: 29, y: 23 });
    r.grid.flags[r.grid.idx(42, 23)] &= ~F.SEEN;
    r.grid.terrain[r.grid.idx(42, 23)] = T.AIR;
    expect(r.f.canPlaceGhost({ kind: 'router', x: 42, y: 23 })).toMatchObject({ code: 'E_UNSEEN', x: 42, y: 23 });
  });

  it('E_FLOOR: floor mounts need a solid cell below', () => {
    const r = hall();
    expect(r.f.canPlaceGhost({ kind: 'belt', x: 30, y: 22, dir: 0, length: 2 })).toMatchObject({ code: 'E_FLOOR', x: 30, y: 22 });
    expect(r.f.canPlaceGhost({ kind: 'belt', x: 30, y: 23, dir: 0, length: 2 })).toBeNull();
    expect(r.f.canPlaceGhost({ kind: 'belt', x: 30, y: 23, dir: 1, length: 2 })).toMatchObject({ code: 'E_INVALID' });
  });

  it('E_LODE: drills sit on a discovered lode top, one per lode', () => {
    const g = onboardingGrid();
    const hidden = addLode(g, 'hematite', 'poor', 34, 30);
    carve(g, 34, 28, 36, 29);
    const r = rig({}, g);
    const { f } = r;
    f.discoverLode(0, false);
    const plan = f.surveyPlan();
    expect(f.canPlaceGhost({ kind: 'autoDrill', x: plan.drill.x, y: plan.drill.y - 1 })).toMatchObject({ code: 'E_LODE' });
    expect(f.canPlaceGhost({ kind: 'autoDrill', x: 34, y: 28 })).toMatchObject({ code: 'E_LODE' }); // undiscovered
    f.discoverLode(hidden.id, false);
    expect(f.canPlaceGhost({ kind: 'autoDrill', x: 35, y: 28 })).toBeNull();
    const id = must(f.placeGhost({ kind: 'autoDrill', x: 35, y: 28 })).ids[0];
    must(f.completeGhost(id, POD_AWAY, new Cargo({ autoDrill: 1 })));
    expect(f.canPlaceGhost({ kind: 'autoDrill', x: 34, y: 28 })).toMatchObject({ code: 'E_LODE' }); // lode has a drill
  });

  it('E_POD: an occupant cannot complete on a cell the pod touches, including a pod straddling two cells', () => {
    const r = rig();
    r.f.discoverLode(0, false);
    const { drill } = r.f.surveyPlan();
    const id = must(r.f.placeGhost({ kind: 'autoDrill', x: drill.x, y: drill.y })).ids[0];
    const cargo = new Cargo({ autoDrill: 1 });
    // Pod centred on the left edge of the footprint: x spans drill.x − 0.43 … drill.x + 0.43 (two columns).
    const straddle = { minX: drill.x - 0.43, maxX: drill.x + 0.43, minY: -(drill.y + 0.9), maxY: -(drill.y + 0.1) };
    expect(r.f.completeGhost(id, straddle, cargo)).toMatchObject({ code: 'E_POD' });
    // Just left of the footprint (touching only column drill.x − 1): fine.
    const beside = { minX: drill.x - 0.95, maxX: drill.x - 0.09, minY: -(drill.y + 0.9), maxY: -(drill.y + 0.1) };
    expect(cargo.count('autoDrill')).toBe(1);
    must(r.f.completeGhost(id, beside, cargo));
  });

  it('E_COLUMN: lift column blocked or crossing a mount; Headframe off rows 1–2', () => {
    const r = hall();
    const g = r.grid;
    g.terrain[g.idx(ONBOARD.column, 30)] = T.DIRT;
    expect(r.f.canPlaceGhost({ kind: 'lift', x: ONBOARD.column, foot: 45, top: 0 })).toEqual({ ok: false, code: 'E_COLUMN', x: ONBOARD.column, y: 30 });
    g.terrain[g.idx(ONBOARD.column, 30)] = T.AIR;
    must(r.f.placeGhost({ kind: 'router', x: 31, y: 23 }));
    const id = r.f.ghosts()[0].id;
    must(r.f.completeGhost(id, POD_AWAY, new Cargo({ router: 1 })));
    expect(r.f.canPlaceGhost({ kind: 'lift', x: 31, foot: 23, top: 20 })).toMatchObject({ code: 'E_COLUMN', x: 31, y: 23 });
    expect(r.f.canPlace('headframe', 1, 25, 4, 0)).toMatchObject({ code: 'E_COLUMN' });
    expect(r.f.canPlace('headframe', 1, 25, 1, 0)).toBeNull();
  });

  it('E_COLUMN: a lift reaching row 0 needs a valid Headframe column (02 §2.2, §2.5)', () => {
    const g = onboardingGrid();
    carve(g, 0, 0, 0, 6);
    carve(g, 5, 0, 5, 6);
    const r = rig({}, g);
    r.f.discoverLode(0, false);
    // Column 0: no Headframe fits over it (columns 1–4 lie under the Pump House), so the lift could never deliver.
    expect(r.f.canPlaceGhost({ kind: 'lift', x: 0, foot: 6, top: 0 })).toEqual({ ok: false, code: 'E_COLUMN', x: 0 });
    expect(r.f.canPlaceGhost({ kind: 'lift', x: 0, foot: 6, top: 1 })).toBeNull(); // stops short of the Yard
    expect(r.f.canPlaceGhost({ kind: 'lift', x: 5, foot: 6, top: 0 })).toBeNull();
  });

  it('E_ARENA: nothing at or below the Seal row', () => {
    const g = onboardingGrid();
    carve(g, 10, 583, 12, 590);
    const r = rig({}, g);
    r.f.discoverLode(0, false);
    expect(r.f.canPlaceGhost({ kind: 'lift', x: 11, foot: 586, top: 583 })).toMatchObject({ code: 'E_ARENA' });
  });

  it('E_FUNDS / E_PARTS / E_KIT: cash, Stockpile parts or Kit short', () => {
    const r = rig({}, onboardingGrid(), 120);
    r.f.discoverLode(0, false);
    expect(r.f.canPlace('smelter', 1, 30, 5, 0)).toEqual({ ok: false, code: 'E_FUNDS', need: 180 });
    expect(r.f.place('smelter', 1, 30, 5, 0)).toMatchObject({ code: 'E_FUNDS' });
    expect(r.wallet.cashNow).toBe(120);
    expect(r.f.stockpileTake([{ item: 'gear', n: 2 }])).toEqual({ ok: false, code: 'E_PARTS', need: 2, item: 'gear' });
    const v1 = rig({ scope: 'v1' });
    v1.f.discoverLode(0, false);
    v1.f.unlockRung('U8');
    expect(v1.f.paintBelts([{ x: 30, y: 5 }, { x: 31, y: 5 }], 2)).toEqual({ ok: false, code: 'E_PARTS', need: 2, item: 'gear' });
    const id = must(r.f.placeGhost({ kind: 'autoDrill', ...r.f.surveyPlan().drill })).ids[0];
    expect(r.f.completeGhost(id, POD_AWAY, new Cargo())).toEqual({ ok: false, code: 'E_KIT', need: 1, item: 'autoDrill' });
  });
});

describe('factory commands: completeGhost atomicity (02 §2.6, §10.11 #8)', () => {
  it('a failed completion consumes nothing; a success swaps the Kit for the building; saves see exactly one', () => {
    const r = rig();
    r.f.discoverLode(0, false);
    const id = must(r.f.placeGhost({ kind: 'autoDrill', ...r.f.surveyPlan().drill })).ids[0];
    const cargo = new Cargo({ autoDrill: 1 });
    const pod = { minX: 20.2, maxX: 21.0, minY: -45.9, maxY: -45.1 };
    expect(r.f.completeGhost(id, pod, cargo)).toMatchObject({ code: 'E_POD' });
    expect(cargo.count('autoDrill')).toBe(1);
    expect(r.f.ghosts()).toHaveLength(1);
    const before = r.f.serialize();
    must(r.f.completeGhost(id, POD_AWAY, cargo));
    const after = r.f.serialize();
    expect(cargo.count('autoDrill')).toBe(0);
    const load = (bytes: Uint8Array): Factory => Factory.deserialize(bytes, { grid: cloneGrid(r.grid), wallet: new Wallet(), emit: () => {} }, { scope: 'mvp', surveyColumn: ONBOARD.column, scriptedLodeId: 0 });
    const a = load(before);
    expect([a.ghosts().length, a.entities().filter((e) => e.kind === 'autoDrill').length]).toEqual([1, 0]);
    const b = load(after);
    expect([b.ghosts().length, b.entities().filter((e) => e.kind === 'autoDrill').length]).toEqual([0, 1]);
    expect(r.events).toContainEqual({ t: 'ghost-complete', kind: 'autoDrill' });
  });

  it('drops ghosts whose cells become solid (tileChanged)', () => {
    const r = hall();
    must(r.f.placeGhost({ kind: 'belt', x: 30, y: 23, dir: 0, length: 4 }));
    r.grid.terrain[r.grid.idx(32, 23)] = T.DIRT;
    r.f.tileChanged([{ x: 32, y: 23 }]);
    expect(r.f.ghosts()).toHaveLength(0);
  });

  it('re-checks support: a floor mount whose floor is dug or blasted away is dropped (tileChanged, 02 §10.10)', () => {
    const r = hall();
    const { f, grid } = r;
    must(f.placeGhost({ kind: 'belt', x: 30, y: 23, dir: 0, length: 2 }));
    must(f.placeGhost({ kind: 'router', x: 34, y: 23 }));
    must(f.placeGhost({ kind: 'belt', x: 36, y: 23, dir: 0, length: 2 }));
    const v = f.topologyVersion;
    // A dig clears the floor under the first run's second tile: that job could never complete.
    grid.terrain[grid.idx(31, 24)] = T.AIR;
    f.tileChanged([{ x: 31, y: 24 }]);
    expect(f.ghosts().map((g) => [g.kind, g.x])).toEqual([
      ['router', 34],
      ['belt', 36],
    ]);
    expect(f.topologyVersion).toBeGreaterThan(v);
    // A blast square: only the job whose floor went is dropped; jobs beside it keep theirs.
    grid.terrain[grid.idx(34, 24)] = T.AIR;
    f.tileChanged([33, 34, 35, 36].flatMap((x) => [22, 23, 24].map((y) => ({ x, y }))));
    expect(f.ghosts().map((g) => [g.kind, g.x])).toEqual([['belt', 36]]);
    // The records keep the dropped jobs' shapes, re-checked on redo: the floor is still gone.
    must(f.undo()); // the run at x 36
    must(f.undo()); // the Router: already dropped, nothing to remove
    expect(f.redo()).toMatchObject({ ok: false, code: 'E_FLOOR', x: 34, y: 23 });
    expect(f.ghosts()).toEqual([]);
  });
});

describe('factory commands: refunds and Kits (02 §2.7)', () => {
  it('Yard deconstruct refunds 100% cash and sends contents to the Stockpile, or blocks without room', () => {
    const r = rig({ yardRows: 16 });
    const { f, wallet } = r;
    f.discoverLode(0, false);
    const bin = must(f.place('bin', 1, 30, 5, 0)).id;
    expect(wallet.cashNow).toBe(100_000 - 250);
    must(f.stockpilePut([{ item: 'gear', n: 200 }, { item: 'wire', n: 10 }]));
    expect(f.deconstruct(bin)).toEqual({ ok: false, code: 'E_STOCKPILE_FULL', need: 10 });
    must(f.stockpileTake([{ item: 'gear', n: 10 }]));
    expect(f.deconstruct(bin)).toEqual({ ok: true, refund: 250 });
    expect(wallet.cashNow).toBe(100_000);
    expect(f.stockpileCount('wire')).toBe(10);
    // The rusted survey set cost $0 and refunds $0.
    const smelter = f.entities().find((e) => e.kind === 'smelter')!.id;
    expect(f.deconstruct(smelter)).toEqual({ ok: true, refund: 0 });
  });

  it('underground deconstruct returns the Kit to cargo when the pod can take it, else to the Stockpile; belt Kits are metered', () => {
    const r = hall();
    const { f } = r;
    const cargo = new Cargo({ router: 2, belt: 8 });
    const ids = [...must(f.placeGhost({ kind: 'router', x: 30, y: 23 })).ids, ...must(f.placeGhost({ kind: 'belt', x: 31, y: 23, dir: 0, length: 8 })).ids];
    for (const id of ids) must(f.completeGhost(id, POD_AWAY, cargo));
    expect(cargo.kits).toEqual({ router: 1, belt: 0 });
    expect(r.grid.hasFlag(33, 24, F.ANCHORED)).toBe(true);
    const router = f.entities().find((e) => e.kind === 'router')!.id;
    must(f.deconstruct(router, { toCargo: cargo }));
    expect(cargo.kits.router).toBe(2);
    must(f.removeBelts('mine', [31, 32, 33].map((x) => ({ x, y: 23 }))));
    expect(f.stockpileCount('kit:belt')).toBe(0);
    expect(r.grid.hasFlag(33, 24, F.ANCHORED)).toBe(false);
    must(f.removeBelts('mine', [34, 35, 36, 37, 38].map((x) => ({ x, y: 23 }))));
    expect(f.stockpileCount('kit:belt')).toBe(1);
    expect(r.grid.mount[r.grid.idx(35, 23)]).toBe(0);
  });
});

describe('factory commands: undo / redo (02 §2.7; canon §4.11)', () => {
  it('place → undo refunds → redo re-places, and redo is cleared by a new command', () => {
    const { f, wallet } = rig();
    f.discoverLode(0, false);
    const id = must(f.place('smelter', 1, 30, 5, 0)).id;
    expect(wallet.cashNow).toBe(99_700);
    must(f.undo());
    expect(f.entity(id)).toBeNull();
    expect(wallet.cashNow).toBe(100_000);
    must(f.redo());
    expect(f.entities().filter((e) => e.kind === 'smelter')).toHaveLength(2);
    expect(wallet.cashNow).toBe(99_700);
    must(f.undo());
    must(f.place('bin', 1, 36, 5, 0));
    expect(f.redo()).toEqual({ ok: false, code: 'E_EMPTY' });
  });

  it('a re-created building gets a new id when its old one was reused; records follow the incarnation', () => {
    const g = onboardingGrid();
    carve(g, 30, 20, 41, 23);
    const r = rig({}, g);
    const { f } = r;
    f.discoverLode(0, false);
    f.unlockRung('U3');
    const ghost = must(f.placeGhost({ kind: 'router', x: 33, y: 23 })).ids[0];
    const smelter = must(f.place('smelter', 1, 30, 5, 0)).id;
    must(f.deconstruct(smelter));
    // Not an undo step: the pod builds the router, which takes the freed id.
    const router = must(f.completeGhost(ghost, POD_AWAY, new Cargo({ router: 1 }))).id;
    expect(router).toBe(smelter);
    must(f.undo()); // un-deconstruct: the smelter comes back under a new id
    const again = f.entities().find((e) => e.kind === 'smelter' && e.x === 30)!;
    expect(again.id).not.toBe(router);
    must(f.undo()); // un-place: removes the smelter, not the router that holds its old id
    expect(f.entity(again.id)).toBeNull();
    expect(f.entity(router)?.kind).toBe('router');
    must(f.undo()); // un-ghost: the built router is deconstructed, its Kit to the Stockpile
    expect(f.entity(router)).toBeNull();
    expect(f.stockpileCount('kit:router')).toBe(1);
  });

  it('paint with a T makes a Router; undo restores belts and cash exactly', () => {
    const r = rig({ yardRows: 16 });
    const { f, wallet } = r;
    f.discoverLode(0, false);
    f.unlockRung('U3');
    must(f.paintBelts([30, 31, 32, 33, 34].map((x) => ({ x, y: 10 })), 1));
    const cash = wallet.cashNow;
    const words = Uint16Array.from(f.beltWords('yard'));
    // A stroke ending on the side of the line: the tile it points into becomes a Router.
    must(f.paintBelts([{ x: 32, y: 13 }, { x: 32, y: 12 }, { x: 32, y: 11 }], 1));
    expect(f.entities().filter((e) => e.kind === 'router').map((e) => [e.x, e.y])).toEqual([[32, 10]]);
    expect(wallet.cashNow).toBe(cash - 15 - 40 + 5);
    // A straight crossing becomes a Junction.
    must(f.paintBelts([9, 10, 11].map((y) => ({ x: 31, y })), 1));
    expect(f.beltWords('yard')[10 * 48 + 31] & 0x4000).toBe(0x4000);
    must(f.undo());
    must(f.undo());
    expect(Array.from(f.beltWords('yard'))).toEqual(Array.from(words));
    expect(wallet.cashNow).toBe(cash);
    expect(f.entities().some((e) => e.kind === 'router')).toBe(false);
  });

  it('underground: ghost → built → undo deconstructs (Kit to the Stockpile); undo of a deconstruct re-places the ghost', () => {
    const r = hall();
    const { f } = r;
    const gid = must(f.placeGhost({ kind: 'router', x: 35, y: 23 })).ids[0];
    must(f.completeGhost(gid, POD_AWAY, new Cargo({ router: 1 })));
    must(f.undo());
    expect(f.entities().some((e) => e.kind === 'router')).toBe(false);
    expect(f.stockpileCount('kit:router')).toBe(1);
    must(f.redo());
    expect(f.ghosts().map((g) => [g.kind, g.x, g.y])).toEqual([['router', 35, 23]]);
    must(f.completeGhost(f.ghosts()[0].id, POD_AWAY, new Cargo({ router: 1 })));
    const router = f.entities().find((e) => e.kind === 'router')!.id;
    must(f.deconstruct(router));
    must(f.undo());
    expect(f.ghosts().map((g) => [g.kind, g.x, g.y])).toEqual([['router', 35, 23]]);
  });

  it('undo of a placement follows Deconstruct: blocked without Stockpile room, never scrapping contents (02 §2.7)', () => {
    const r = rig({ yardRows: 16 });
    const { f, wallet } = r;
    f.discoverLode(0, false);
    const bin = must(f.place('bin', 1, 30, 5, 0)).id;
    must(f.stockpilePut([{ item: 'copperIngot', n: 300 }])); // 200 fill the survey Bin, 100 land in the new one
    expect(f.deconstruct(bin)).toEqual({ ok: false, code: 'E_STOCKPILE_FULL', need: 100 });
    expect(f.undo()).toEqual({ ok: false, code: 'E_STOCKPILE_FULL', need: 100 });
    expect(f.entity(bin)).not.toBeNull();
    expect(f.stockpileCount('copperIngot')).toBe(300);
    expect(f.debug.counts.scrapped).toBe(0);
    expect(f.canUndo).toBe(true); // the step stays for later
    must(f.stockpileTake([{ item: 'copperIngot', n: 150 }]));
    expect(f.undo()).toEqual({ ok: true, refund: 250 });
    expect(f.entity(bin)).toBeNull();
    expect(f.stockpileCount('copperIngot')).toBe(150);
    expect(wallet.cashNow).toBe(100_000);
    expect(f.debug.conservationOk()).toBe(true);
  });

  it('redo of a deconstruct is blocked the same way', () => {
    const r = rig({ yardRows: 16 });
    const { f } = r;
    f.discoverLode(0, false);
    must(f.deconstruct(must(f.place('bin', 1, 30, 5, 0)).id));
    must(f.undo());
    const again = f.entities().find((e) => e.kind === 'bin' && e.x === 30)!.id;
    must(f.stockpilePut([{ item: 'gear', n: 300 }]));
    expect(f.redo()).toEqual({ ok: false, code: 'E_STOCKPILE_FULL', need: 100 });
    expect(f.inspect(again)?.contents).toEqual([{ item: 'gear', n: 100 }]);
    expect(f.debug.counts.scrapped).toBe(0);
    expect(f.canRedo).toBe(true);
  });

  it('deconstructing a lift takes its pending rail jobs along; one undo brings foot and rails back (02 §2.6)', () => {
    const r = rig();
    const { f } = r;
    f.discoverLode(0, false);
    const ids = must(f.placeGhost({ kind: 'lift', ...f.surveyPlan().lift })).ids;
    expect(f.ghosts().map((g) => [g.part, g.y, g.h])).toEqual([
      ['foot', 14, 32],
      ['rail', 0, 14],
    ]);
    must(f.completeGhost(ids[0], POD_AWAY, new Cargo({ liftFoot: 1 })));
    must(f.deconstruct(f.entities().find((e) => e.kind === 'lift')!.id));
    // No rail job is left waiting for a lift that is gone (it could never complete).
    expect(f.ghosts()).toEqual([]);
    expect(f.stockpileCount('kit:liftFoot')).toBe(1);
    must(f.undo());
    expect(f.ghosts().map((g) => [g.part, g.y, g.h])).toEqual([
      ['foot', 14, 32],
      ['rail', 0, 14],
    ]);
    const cargo = new Cargo({ liftFoot: 1, liftRail: 1 });
    for (const g of f.ghosts()) must(f.completeGhost(g.id, POD_AWAY, cargo));
    expect(f.entities().find((e) => e.kind === 'lift')).toMatchObject({ y: 0, h: 46 });
    // The same full shaft can be laid again after a deconstruct (no stray rail job holds its column).
    must(f.deconstruct(f.entities().find((e) => e.kind === 'lift')!.id));
    expect(f.canPlaceGhost({ kind: 'lift', ...f.surveyPlan().lift })).toBeNull();
  });

  it('removing a pending lift job drops the rail jobs stacked on it; undo re-adds them', () => {
    const r = rig();
    const { f } = r;
    f.discoverLode(0, false);
    must(f.placeGhost({ kind: 'lift', ...f.surveyPlan().lift }));
    must(f.removeGhost(f.ghosts().find((g) => g.part === 'foot')!.id));
    expect(f.ghosts()).toEqual([]);
    must(f.undo());
    expect(f.ghosts().map((g) => g.part)).toEqual(['foot', 'rail']);
    // A rail job alone goes alone; the foot under it stays.
    must(f.removeGhost(f.ghosts().find((g) => g.part === 'rail')!.id));
    expect(f.ghosts().map((g) => g.part)).toEqual(['foot']);
  });

  it('keeps at least 50 steps', () => {
    const r = rig({ yardRows: 16 });
    const { f } = r;
    f.discoverLode(0, false);
    for (let i = 0; i < 70; i++) must(f.paintBelts([{ x: 14 + (i % 30), y: 10 + Math.floor(i / 30) }], 1, 0));
    let n = 0;
    while (f.undo().ok) n++;
    expect(n).toBeGreaterThanOrEqual(50);
  });
});

describe('factory commands: unlocks, Yard, Stockpile, away', () => {
  it('U2 on the first discovery only; Expansion I needs U2 and cash; II is v1', () => {
    const { f, events, wallet } = rig();
    expect(f.expandYard()).toEqual({ ok: false, code: 'E_LOCKED', rung: 'U2' });
    f.discoverLode(0, true);
    f.discoverLode(0, true);
    expect(events.filter((e) => e.t === 'unlock')).toHaveLength(1);
    must(f.expandYard());
    expect(wallet.cashNow).toBe(97_500);
    expect(f.expandYard()).toEqual({ ok: false, code: 'E_LOCKED', rung: 'U8' });
  });

  it('lode purity: unknown after a Tin Ear discovery until the first drilled ore (02 §3.6), and saved', () => {
    const r = rig();
    const { f } = r;
    f.discoverLode(0, false);
    expect(f.purityKnown(0)).toBe(false);
    must(f.completeGhost(must(f.placeGhost({ kind: 'autoDrill', ...f.surveyPlan().drill })).ids[0], POD_AWAY, new Cargo({ autoDrill: 1 })));
    const load = (bytes: Uint8Array): Factory => Factory.deserialize(bytes, { grid: cloneGrid(r.grid), wallet: new Wallet(), emit: () => {} }, { scope: 'mvp', surveyColumn: ONBOARD.column, scriptedLodeId: 0 });
    expect(load(f.serialize()).purityKnown(0)).toBe(false);
    const drill = f.entities().find((e) => e.kind === 'autoDrill')!.id;
    for (let t = 0; t < 2_000 && (f.inspect(drill)?.output.length ?? 0) === 0; t++) {
      expect(f.purityKnown(0)).toBe(false);
      f.tick();
    }
    expect(f.inspect(drill)?.output).toEqual([{ item: 'copperOre', n: 1 }]);
    expect(f.purityKnown(0)).toBe(true);
    expect(load(f.serialize()).purityKnown(0)).toBe(true);
    // A discovery that shows it (fixed purity, or a Dowser) sets it at once.
    const known = rig();
    known.f.discoverLode(0, true);
    expect(known.f.purityKnown(0)).toBe(true);
  });

  it('PartsLedger reads and takes Stockpile parts', () => {
    const { f } = rig();
    must(f.stockpilePut([{ item: 'hullPlate', n: 5 }]));
    const ledger = f.partsLedger();
    expect(ledger.count('hullPlate')).toBe(5);
    ledger.take('hullPlate', 2);
    expect(f.stockpileCount('hullPlate')).toBe(3);
    expect(() => ledger.take('motor', 1)).toThrow();
    expect(f.debug.conservationOk()).toBe(true);
  });

  it('sleeps while away: ticks change nothing', () => {
    const { f } = rig();
    const h = f.stateHash();
    f.setAway(true);
    for (let i = 0; i < 100; i++) f.tick();
    expect(f.stateHash()).toBe(h);
    expect(f.tickNo).toBe(0);
    f.setAway(false);
    f.tick();
    expect(f.tickNo).toBe(1);
  });
});

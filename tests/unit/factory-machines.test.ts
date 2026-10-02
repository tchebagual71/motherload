import { describe, expect, it } from 'vitest';
import type { BuildingKind } from '../../src/factory/api';
import type { Factory } from '../../src/factory/factory';
import { rig, ticks, type Rig } from './factory.helpers';

/** Source Bin (2, 8) → belt row 9 → machine (7, 8) facing E → belt row 9 → sink Bin (11, 8). */
function chain(kind: BuildingKind, fill: { item: string; n: number }[]): { r: Rig; src: number; machine: number; sink: number } {
  const r = rig({ yardRows: 16 });
  const { f } = r;
  f.discoverLode(0, false);
  f.unlockRung('U3');
  f.stockpilePut([{ item: 'ironIngot', n: 200 }]); // fill the survey Bin so the source holds the feed
  const src = ok(f.place('bin', 1, 2, 8, 0));
  if (fill.length) ok(f.stockpilePut(fill));
  ok(f.setUnloadFilter(src.id, fill[0]?.item ?? null));
  ok(f.paintBelts([4, 5, 6].map((x) => ({ x, y: 9 })), 1));
  const machine = ok(f.place(kind, 1, 7, 8, 0));
  ok(f.paintBelts([9, 10].map((x) => ({ x, y: 9 })), 1));
  const sink = ok(f.place('bin', 1, 11, 8, 0));
  return { r, src: src.id, machine: machine.id, sink: sink.id };
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

function has(f: Factory, bin: number, id: string): number {
  return f.inspect(bin)?.contents.find((c) => c.item === id)?.n ?? 0;
}

describe('factory: Smelter (02 §4.2, §10.5)', () => {
  it('switches recipe on a mixed line: the first item into an empty buffer sets it', () => {
    const { r, src, sink, machine } = chain('smelter', [
      { item: 'copperOre', n: 20 },
      { item: 'hematiteOre', n: 20 },
    ]);
    const { f } = r;
    while (has(f, src, 'copperOre') > 10) f.tick();
    ok(f.setUnloadFilter(src, 'hematiteOre'));
    const recipes = new Set<string>();
    for (let t = 0; t < 3_000; t++) {
      f.tick();
      const rec = f.entity(machine)?.recipe;
      if (rec) recipes.add(rec);
    }
    expect([...recipes].sort()).toEqual(['S1', 'S2']);
    expect(has(f, sink, 'copperIngot')).toBe(5);
    expect(has(f, sink, 'ironIngot')).toBe(10);
    expect(f.debug.conservationOk()).toBe(true);
  });

  it('smelts 1 specimen → 2 ingots per 120 ticks (10 specimens → 20 ingots per minute)', () => {
    const { r, sink } = chain('smelter', [{ item: 'spec1', n: 60 }]);
    ticks(r.f, 600);
    const before = has(r.f, sink, 'ironIngot');
    ticks(r.f, 1_200);
    expect(has(r.f, sink, 'ironIngot') - before).toBe(20);
  });

  it('refuses Iridium specimens: they wait at the line head and nothing is made', () => {
    const { r, sink, machine } = chain('smelter', [{ item: 'spec5', n: 10 }]);
    ticks(r.f, 2_400);
    expect(r.f.inspect(machine)?.contents).toEqual([]);
    expect(r.f.inspect(sink)?.contents).toEqual([]);
    expect(r.f.entity(machine)?.status).toBe('idle');
    expect(r.f.debug.conservationOk()).toBe(true);
  });

  it('fires first-ingot once and opens U3 (Assembler, Router, Export)', () => {
    const r = rig({ yardRows: 16 });
    const { f, events } = r;
    f.discoverLode(0, false);
    expect(f.canPlace('assembler', 1, 2, 12, 0)).toEqual({ ok: false, code: 'E_LOCKED', rung: 'U3' });
    f.stockpilePut([{ item: 'ironIngot', n: 200 }]);
    const src = ok(f.place('bin', 1, 2, 8, 0));
    ok(f.stockpilePut([{ item: 'spec2', n: 6 }]));
    ok(f.setUnloadFilter(src.id, 'spec2'));
    ok(f.paintBelts([4, 5, 6].map((x) => ({ x, y: 9 })), 1));
    ok(f.place('smelter', 1, 7, 8, 0));
    ok(f.paintBelts([9, 10].map((x) => ({ x, y: 9 })), 1));
    ok(f.place('bin', 1, 11, 8, 0));
    ticks(f, 2_400);
    expect(f.stockpileCount('copperIngot')).toBe(12);
    expect(events.filter((e) => e.t === 'first-ingot')).toEqual([{ t: 'first-ingot', item: 'copperIngot' }]);
    expect(events.filter((e) => e.t === 'unlock').map((e) => (e.t === 'unlock' ? e.rung : ''))).toEqual(['U2', 'U3']);
    expect(f.canPlace('assembler', 1, 2, 12, 0)).toBeNull();
  });
});

describe('factory: Assembler (02 §4.2, F1)', () => {
  it('runs A1 at 2 s per craft: 1 Iron Ingot → 2 Gears', () => {
    const { r, machine, sink } = chain('assembler', [{ item: 'ironIngot', n: 100 }]);
    const { f } = r;
    ok(f.setRecipe(machine, 'A1'));
    ticks(f, 1_200);
    const g0 = has(f, sink, 'gear');
    ticks(f, 1_200);
    // Inputs arrive at 60/min but each craft takes 40 ticks: 30 crafts → 60 Gears per minute.
    expect(has(f, sink, 'gear') - g0).toBe(60);
    expect(f.entity(machine)?.recipe).toBe('A1');
  });

  it('opens A5–A8 only once every input type has existed (possession, F1)', () => {
    const { r, machine } = chain('assembler', []);
    const { f, events } = r;
    expect(f.setRecipe(machine, 'A5')).toMatchObject({ ok: false, code: 'E_LOCKED' });
    expect(f.recipes('assembler').find((x) => x.id === 'A5')?.unlocked).toBe(false);
    ok(f.stockpilePut([{ item: 'wire', n: 3 }]));
    expect(f.setRecipe(machine, 'A5')).toMatchObject({ ok: false, code: 'E_LOCKED' });
    ok(f.stockpilePut([{ item: 'goldIngot', n: 1 }]));
    expect(events).toContainEqual({ t: 'unlock', rung: 'A5', label: 'Circuit' });
    ok(f.setRecipe(machine, 'A5'));
    expect(f.recipes('assembler').filter((x) => x.unlocked).map((x) => x.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
  });

  it('sends buffered inputs to the Stockpile on a recipe change, and undo restores the recipe', () => {
    const { r, src, machine } = chain('assembler', [{ item: 'copperIngot', n: 50 }]);
    const { f } = r;
    ok(f.setRecipe(machine, 'A2'));
    ok(f.setUnloadFilter(src, 'copperIngot'));
    ticks(f, 200);
    const stock0 = f.stockpileCount('copperIngot');
    const buffered = f.inspect(machine)?.contents.reduce((n, c) => n + c.n, 0) ?? 0;
    expect(buffered).toBeGreaterThan(0);
    ok(f.setRecipe(machine, 'A1'));
    expect(f.inspect(machine)?.contents).toEqual([]);
    expect(f.stockpileCount('copperIngot')).toBe(stock0 + buffered);
    ok(f.undo());
    expect(f.entity(machine)?.recipe).toBe('A2');
    expect(f.debug.conservationOk()).toBe(true);
  });
});

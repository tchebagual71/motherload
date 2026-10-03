// The factory-facing Rim sheets over a real MVP World (03 §6.3): the Supply Shed's Starter Kit, Kits shelf and
// Shopping list, the Assay's Sell / Stockpile toggle, and Dot's office Yard Expansion.
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppController } from '../../src/app/types';
import { POD_H } from '../../src/shared/canon';
import { createFakeApp } from '../../src/ui/fakes';
import { SheetHost } from '../../src/ui/SheetHost';
import { World } from '../../src/world/world';
import { flush, installFakeDom, text, type FakeDom, type FakeElement } from './ui-dom.helpers';

let dom: FakeDom;
let world: World;
let app: AppController;
let toasts: string[];

beforeEach(() => {
  dom = installFakeDom();
  const fake = createFakeApp({ scope: 'mvp', look: 'toon', styleTest: false });
  world = new World({ seed: 7, scope: 'mvp' });
  toasts = [];
  app = {
    ...fake,
    world,
    afterAction: (r) => {
      toasts.push(r.ok ? (r.message ?? '') : r.reason);
    },
  };
});

afterEach(async () => {
  await flush(() => render(null, dom.root as unknown as HTMLElement));
  dom.restore();
});

const mount = () => flush(() => render(h(SheetHost, { app }), dom.root as unknown as HTMLElement));
const tick = () => flush(() => app.state.hudTick.value++);
const buttons = (): FakeElement[] => dom.root.querySelectorAll('button');
const button = (label: string): FakeElement => {
  const b = buttons().find((x) => text(x) === label || x.getAttribute('aria-label') === label);
  if (!b) throw new Error(`no button "${label}" in: ${buttons().map((x) => text(x)).join(' | ')}`);
  return b;
};
const click = async (label: string) => {
  await flush(() => button(label).click());
  await tick();
};

/** The scripted lode found with the pod standing beside it, then back on the Rim at x. */
function findLode(x = 41): void {
  const lode = world.terrain.lodes[world.meta.scriptedLodeId];
  const p = world.pod;
  const stand = (cx: number, r: number) => {
    p.x = p.prevX = cx + 0.5;
    p.y = p.prevY = -(r + 1) + POD_H / 2;
    p.vx = p.vy = 0;
    p.grounded = true;
  };
  stand(lode.x0 - 1, lode.top - 1);
  world.step({ sx: 0, sy: 0, thrust: false, fireSlot: -1 }, true);
  world.drainEvents();
  stand(x, -1);
}

describe('Supply Shed (MVP)', () => {
  it('offers the Starter Kit once the scripted lode is found and hands it over', async () => {
    app.state.sheet.value = 'shed';
    await mount();
    expect(dom.root.querySelector('.hf-starter')).toBeNull();
    findLode();
    await tick();
    expect(text(dom.root.querySelector('.hf-starter'))).toContain('Auto-Drill Kit, Lift Foot Kit, Lift Rail, 2 Belt Kits · 5 slots · 14 mu');
    await click('Collect Starter Kit');
    expect(toasts.at(-1)).toBe('Starter Kit aboard: 5 Kits');
    expect(world.pod.cargo.filter((c) => c.kind === 'kit')).toHaveLength(5);
    expect(dom.root.querySelector('.hf-starter')).toBeNull();
  });

  it('disables the claim with the slot count when the bay is too full', async () => {
    findLode();
    for (let i = 0; i < 4; i++) world.pod.cargo.push({ kind: 'mineral', tier: 1 });
    app.state.sheet.value = 'shed';
    await mount();
    expect(button('Collect Starter Kit').disabled).toBe(true);
    expect(text(dom.root.querySelector('.hf-starter-block'))).toBe('Needs 5 free bay slots (you have 3)');
  });

  it('sells Kits to the bay or the Stockpile, loads them back, and shows locks', async () => {
    findLode();
    world.debugGiveCash(2_000);
    app.state.sheet.value = 'shed';
    await mount();
    await click('Kits');
    const titles = dom.root.querySelectorAll('.hf-kit .hf-card-title').map((e) => text(e));
    expect(titles).toEqual(['Belt Kit', 'Router Kit', 'Auto-Drill Kit', 'Lift Foot Kit', 'Lift Rail']);
    const router = dom.root.querySelectorAll('.hf-kit').find((c) => text(c).includes('Router Kit'))!;
    expect(text(router)).toContain('Unlocks: Produce an ingot');
    await click('Buy a Belt Kit to the bay');
    expect(toasts.at(-1)).toBe('1 Belt Kit to the bay');
    await click('Buy a Lift Rail to the Stockpile');
    expect(world.factory!.stockpileCount('kit:liftRail')).toBe(1);
    const rail = () => dom.root.querySelectorAll('.hf-kit').find((c) => text(c).includes('Lift Rail'))!;
    expect(text(rail())).toContain('Bay 0 · Stock 1');
    await click('Load a Lift Rail from the Stockpile');
    expect(text(rail())).toContain('Bay 1 · Stock 0');
  });

  it('lists the Kits pending ghosts still need and buys the missing ones in one tap', async () => {
    findLode();
    world.debugGiveCash(2_000);
    const f = world.factory!;
    const plan = f.surveyPlan();
    const g = world.terrain;
    for (let r = 0; r <= plan.lift.foot; r++) g.flags[g.idx(plan.lift.x, r)] |= 1; // SEEN
    expect(f.placeGhost({ kind: 'lift', ...plan.lift }).ok).toBe(true);
    world.pod.cargo.push({ kind: 'kit', id: 'liftFoot' });
    app.state.sheet.value = 'shed';
    await mount();
    await click('Kits');
    expect(text(dom.root.querySelector('.hf-shop-list'))).toContain('1 × Lift Rail');
    expect(text(dom.root.querySelector('.hf-shop-list'))).not.toContain('Lift Foot');
    await click('Buy the missing Kits to the bay, 100 dollars');
    expect(world.pod.cargo.filter((c) => c.kind === 'kit' && c.id === 'liftRail')).toHaveLength(1);
    expect(dom.root.querySelector('.hf-shop-list')).toBeNull();
  });
});

describe('Assay Office: Sell / Stockpile toggle (MVP)', () => {
  it('appears for bulk specimens once a lode is found and stockpiles those rows while selling the rest', async () => {
    world.pod.cargo.push({ kind: 'mineral', tier: 1 }, { kind: 'mineral', tier: 1 }, { kind: 'mineral', tier: 2 }, { kind: 'mineral', tier: 8 });
    world.pod.x = 11.5;
    app.state.sheet.value = 'assay';
    await mount();
    expect(dom.root.querySelector('.hf-assay-toggle')).toBeNull();
    findLode(11);
    await tick();
    expect(dom.root.querySelectorAll('.hf-assay-toggle')).toHaveLength(2); // Hematite and Copper; Fire Opal is a gem
    const hem = dom.root.querySelectorAll('.hf-assay-row').find((r) => text(r).includes('Hematite'))!;
    await flush(() => hem.querySelectorAll('button').find((b) => text(b) === 'Stockpile')!.click());
    await tick();
    const foot = () => text(dom.root.querySelector('.hf-sheet-foot'));
    expect(foot()).toBe('Sell $20,060 · Stockpile 2');
    await flush(() => (dom.root.querySelector('.hf-sheet-foot button') as FakeElement).click());
    expect(world.factory!.stockpileCount('spec1')).toBe(2);
    expect(world.pod.cargo).toEqual([]);
    expect(toasts).toEqual(['2 Hematite to the Stockpile', 'Sold 2 items for $20,060']);
  });
});

describe("Dot's office: Yard Expansion (MVP)", () => {
  const tab = (label: string) => dom.root.querySelectorAll('[role="tab"]').find((b) => text(b) === label)!;

  it('shows the lock, then buys Expansion I', async () => {
    world.pod.x = 11.5;
    app.state.sheet.value = 'office';
    await mount();
    await flush(() => tab('Plans').click());
    const card = () => text(dom.root.querySelector('.hf-office-yard'));
    expect(card()).toContain('Yard Expansion I');
    expect(card()).toContain('48 × 8 → 16');
    expect(card()).toContain('Locked · Discover a lode');
    findLode(11);
    world.debugGiveCash(3_000);
    await tick();
    expect(card()).not.toContain('Locked');
    await click('Buy Yard Expansion I, 2500 dollars');
    expect(toasts.at(-1)).toBe('Yard expanded to 48 × 16');
    expect(world.factory!.yardRows).toBe(16);
    expect(card()).toContain('More Yard comes in the next update.');
  });
});

describe('Garage: t3 parts from the Stockpile (canon §4.3.5; 01 §2.6 beat 7)', () => {
  it('shows "Wire 10/10 from your lode ✓" from the Bins and takes the bill all or nothing', async () => {
    const f = world.factory!;
    findLode(31);
    world.debugGiveCash(5_000);
    world.debugSetTier('bay', 2);
    f.stockpilePut([
      { item: 'wire', n: 10 },
      { item: 'hullPlate', n: 2 },
    ]);
    app.state.sheet.value = 'garage';
    await mount();
    const bay = () => dom.root.querySelectorAll('.hf-card').find((c) => text(c).startsWith('Cargo bay'))!;
    const chips = () => bay().querySelectorAll('.hf-chip').map((c) => text(c));
    expect(chips()).toEqual(['Hull Plate 2/3 ✗', 'Wire 10/10 from your lode ✓']);
    expect(text(bay())).toContain('Needs 3 Hull Plate (have 2)');
    f.stockpilePut([{ item: 'hullPlate', n: 1 }]);
    await tick();
    expect(chips()).toEqual(['Hull Plate 3/3 from your lode ✓', 'Wire 10/10 from your lode ✓']);
    const buy = bay().querySelector('.hf-btn-primary') as FakeElement;
    expect(buy.disabled).toBe(false);
    await flush(() => buy.click());
    expect(world.pod.tiers.bay).toBe(3);
    expect(f.stockpileCount('wire')).toBe(0);
    expect(f.stockpileCount('hullPlate')).toBe(0);
  });
});

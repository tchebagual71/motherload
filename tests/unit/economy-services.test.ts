// Rim services as pure functions: Pump House, Assay Office, Garage, Supply Shed, salvage
// (canon §2.4, §2.7, §3.8, §4.2; 01 §3.10, §5.1, §6.2).
import { describe, expect, it } from 'vitest';
import {
  BLOCK_MAXED,
  BLOCK_NEXT_UPDATE,
  BLOCK_OUT_OF_SCOPE,
  EMPTY_PARTS,
  buyConsumable,
  buyFuel,
  buyUpgrade,
  cargoGroups,
  cargoValue,
  dollars,
  fuelQuote,
  garageCards,
  grantCoopCredit,
  litres,
  repairAll,
  repairQuote,
  salvage,
  sellAll,
  setQuickSlot,
  shedItems,
  type EconomyCtx,
  type PartId,
  type PartsLedger,
} from '../../src/economy';
import { createPod } from '../../src/pod';
import { COOP_CREDIT_COOLDOWN_STEPS, START_CASH } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import type { CargoItem, Scope } from '../../src/shared/types';
import { newStory } from '../../src/world/rules';

function makeCtx(scope: Scope = 'm0', cash = START_CASH, parts: PartsLedger = EMPTY_PARTS): EconomyCtx & { events: GameEvent[] } {
  const events: GameEvent[] = [];
  return { pod: createPod(), wallet: { cash, debt: 0, lifetimeEarned: 0 }, scope, parts, emit: (e) => events.push(e), events };
}

function stockpile(counts: Partial<Record<PartId, number>>): PartsLedger & { counts: Partial<Record<PartId, number>> } {
  return {
    counts,
    count: (p) => counts[p] ?? 0,
    take: (p, n) => {
      counts[p] = (counts[p] ?? 0) - n;
    },
  };
}

const ore = (tier: number, n: number): CargoItem[] => Array.from({ length: n }, () => ({ kind: 'mineral', tier }));

describe('format', () => {
  it('groups thousands', () => {
    expect(dollars(0)).toBe('$0');
    expect(dollars(1_250)).toBe('$1,250');
    expect(dollars(3_887_750)).toBe('$3,887,750');
    expect(dollars(-300)).toBe('-$300');
  });

  it('litres round DOWN to 0.1 L like the gauge, whole amounts without ".0" (03 §6.1)', () => {
    expect(litres(4)).toBe('4 L');
    expect(litres(4.67)).toBe('4.6 L');
    expect(litres(3.27)).toBe('3.2 L');
    expect(litres(4.6)).toBe('4.6 L'); // float residue (4.6 × 10 = 45.99…) does not drop a tenth
    expect(litres(0.04)).toBe('0 L');
    expect(litres(-1)).toBe('0 L');
    expect(litres(1_250)).toBe('1,250 L');
  });
});

describe('Pump House (canon §3.8: $1/L)', () => {
  it('fill from the start: 4 L for $4 (01 §2.5 beat 1)', () => {
    const c = makeCtx();
    expect(fuelQuote(c, 'fill')).toEqual({ amount: 4, cost: 4, limitedByCash: false });
    const r = buyFuel(c, 'fill');
    expect(r).toMatchObject({ ok: true, amount: 4 });
    expect(c.pod.fuel).toBe(10);
    expect(c.wallet.cash).toBe(16);
    expect(c.events).toEqual([{ t: 'purchase', kind: 'fuel', amount: 4 }]);
  });

  it('fixed amounts are clamped to the room in the tank', () => {
    const c = makeCtx('m0', 100);
    expect(fuelQuote(c, 25)).toMatchObject({ amount: 4, cost: 4 });
    expect(fuelQuote(c, 2)).toMatchObject({ amount: 2, cost: 2 });
  });

  it('fractional room is charged per litre or part thereof', () => {
    const c = makeCtx('m0', 100);
    c.pod.fuel = 6.73;
    const q = fuelQuote(c, 'fill');
    expect(q.amount).toBeCloseTo(3.27, 9);
    expect(q.cost).toBe(4);
  });

  it('the receipt names the quoted litres rounded down, as the sheet shows them (PLAYER-11: "Fill 4.6 L", not 4.7)', () => {
    const c = makeCtx('m0', 100);
    c.pod.fuel = 10 - 4.67;
    expect(litres(fuelQuote(c, 'fill').amount)).toBe('4.6 L');
    expect(buyFuel(c, 'fill')).toMatchObject({ ok: true, message: 'Filled up: 4.6 L for $5' });
    const d = makeCtx('m0', 100);
    d.pod.fuel = 2.25;
    expect(buyFuel(d, 5)).toMatchObject({ ok: true, message: 'Bought 5 L for $5' });
    d.pod.fuel = 10 - 0.37; // 0.37 L of room
    expect(buyFuel(d, 'fill')).toMatchObject({ ok: true, message: 'Filled up: 0.3 L for $1' });
  });

  it('Fill buys what cash allows', () => {
    const c = makeCtx('m0', 3);
    c.pod.fuel = 2;
    expect(fuelQuote(c, 'fill')).toEqual({ amount: 3, cost: 3, limitedByCash: true });
    buyFuel(c, 'fill');
    expect(c.pod.fuel).toBe(5);
    expect(c.wallet.cash).toBe(0);
  });

  it('refuses a full tank or an empty wallet', () => {
    const c = makeCtx();
    c.pod.fuel = 10;
    expect(buyFuel(c, 'fill')).toEqual({ ok: false, reason: 'Tank is already full' });
    c.pod.fuel = 1;
    c.wallet.cash = 0;
    expect(buyFuel(c, 5)).toMatchObject({ ok: false });
    expect(c.events).toEqual([]);
  });

  it('Co-op Credit: +5 L when cash < $5 and fuel < 2 L, once per 10 min (canon §2.1)', () => {
    const c = makeCtx('m0', 4);
    const story = newStory();
    c.pod.fuel = 1.5;
    expect(grantCoopCredit(c, story, 100)).toBe(5);
    expect(c.pod.fuel).toBe(6.5);
    expect(c.events).toEqual([{ t: 'coop-credit', liters: 5 }]);
    expect(story.coopCreditReadyStep).toBe(100 + COOP_CREDIT_COOLDOWN_STEPS);
    c.pod.fuel = 1;
    expect(grantCoopCredit(c, story, 100 + COOP_CREDIT_COOLDOWN_STEPS - 1)).toBe(0);
    expect(grantCoopCredit(c, story, 100 + COOP_CREDIT_COOLDOWN_STEPS)).toBe(5);
  });

  it('Co-op Credit needs both conditions', () => {
    const c = makeCtx('m0', 5);
    c.pod.fuel = 1;
    expect(grantCoopCredit(c, newStory(), 0)).toBe(0);
    c.wallet.cash = 4;
    c.pod.fuel = 2;
    expect(grantCoopCredit(c, newStory(), 0)).toBe(0);
  });
});

describe('Assay Office (canon §3.8: 100%; §4.2 debt)', () => {
  it('groups cargo by type, most valuable first', () => {
    const cargo: CargoItem[] = [...ore(1, 3), ...ore(4, 1), { kind: 'relic', id: 0 }, { kind: 'kit', id: 'belt' }, ...ore(1, 1)];
    const groups = cargoGroups(cargo);
    expect(groups.map((g) => [g.label, g.count, g.unitValue, g.totalValue, g.mass])).toEqual([
      ['Fossil Shell', 1, 1_000, 1_000, 1],
      ['Gold', 1, 250, 250, 2],
      ['Hematite', 4, 30, 120, 4],
      ['Belt Kit', 1, 0, 0, 1],
    ]);
    expect(cargoValue(cargo)).toBe(1_370);
  });

  it('labels Mk-tagged kits', () => {
    expect(cargoGroups([{ kind: 'kit', id: 'autoDrill2' }])[0].label).toBe('Auto-Drill Kit Mk II');
  });

  it('sells specimens and relics, keeps Kits aboard', () => {
    const c = makeCtx('m0', 0);
    c.pod.cargo.push(...ore(2, 5), { kind: 'kit', id: 'belt' }, { kind: 'relic', id: 2 });
    const r = sellAll(c);
    expect(r).toMatchObject({ ok: true, amount: 10_300 });
    expect(c.wallet).toEqual({ cash: 10_300, debt: 0, lifetimeEarned: 10_300 });
    expect(c.pod.cargo).toEqual([{ kind: 'kit', id: 'belt' }]);
    expect(c.events).toEqual([{ t: 'sale', amount: 10_300, count: 6 }]);
    expect(sellAll(c)).toMatchObject({ ok: false });
  });

  it('collects Co-op debt first', () => {
    const c = makeCtx('m0', 10);
    c.wallet.debt = 100;
    c.pod.cargo.push(...ore(1, 2));
    sellAll(c);
    expect(c.wallet).toEqual({ cash: 10, debt: 40, lifetimeEarned: 60 });
    c.pod.cargo.push(...ore(3, 1));
    const r = sellAll(c);
    expect(c.wallet).toMatchObject({ cash: 70, debt: 0 });
    expect(r.ok && r.message).toContain('$40 paid off your Co-op debt');
  });

  it('nothing to sell', () => {
    expect(sellAll(makeCtx())).toEqual({ ok: false, reason: 'Nothing to sell' });
  });
});

describe('Garage cards (canon §2.6, §5.5)', () => {
  it('M0 at start: four lines offered at t2, three greyed', () => {
    const cards = garageCards(makeCtx('m0', 1_000));
    expect(cards.map((c) => c.line)).toEqual(['drill', 'hull', 'engine', 'tank', 'radiator', 'bay', 'scanner']);
    const drill = cards[0];
    expect(drill).toMatchObject({
      tier: 2,
      name: 'Corkscrew',
      price: 750,
      installedTier: 1,
      installedName: 'Stub Bit',
      stat: '0.33 s/tile',
      installedStat: '0.48 s/tile',
      available: true,
      affordable: true,
      parts: [],
      blocker: null,
    });
    for (const i of [1, 4, 6]) expect(cards[i]).toMatchObject({ available: false, blocker: BLOCK_NEXT_UPDATE });
    expect(cards[4]).toMatchObject({ tier: 3, name: 'Box Fan' });
  });

  it('cash blocker names the shortfall', () => {
    const cards = garageCards(makeCtx('m0', 0));
    expect(cards[0]).toMatchObject({ affordable: false, blocker: 'Need $750 more' });
  });

  it('M0 stops at t3', () => {
    const c = makeCtx('m0', 1e6);
    c.pod.tiers.drill = 3;
    expect(garageCards(c)[0]).toMatchObject({ tier: 4, available: false, blocker: BLOCK_OUT_OF_SCOPE });
    expect(buyUpgrade(c, 'drill', 4)).toEqual({ ok: false, reason: BLOCK_OUT_OF_SCOPE });
  });

  it('maxed lines say so', () => {
    const c = makeCtx('v1', 1e6);
    c.pod.tiers.bay = 6;
    expect(garageCards(c)[5]).toMatchObject({ tier: 6, price: 0, blocker: BLOCK_MAXED, available: true });
  });

  it('MVP t3 needs parts from the Stockpile', () => {
    const parts = stockpile({ hullPlate: 2, wire: 2 });
    const c = makeCtx('mvp', 5_000, parts);
    c.pod.tiers.drill = 2;
    const card = garageCards(c)[0];
    expect(card.parts).toEqual([
      { item: 'Hull Plate', need: 2, have: 2 },
      { item: 'Wire', need: 10, have: 2 },
    ]);
    expect(card.blocker).toBe('Needs 10 Wire (have 2)');
    expect(buyUpgrade(c, 'drill', 3)).toEqual({ ok: false, reason: 'Needs 10 Wire (have 2)' });
    parts.counts.wire = 12;
    expect(buyUpgrade(c, 'drill', 3)).toMatchObject({ ok: true });
    expect(parts.counts).toEqual({ hullPlate: 0, wire: 2 });
    expect(c.wallet.cash).toBe(3_000);
  });
});

describe('buying upgrades (01 §3.10, §5.1)', () => {
  it('pays the price, installs, emits', () => {
    const c = makeCtx('m0', 1_000);
    expect(buyUpgrade(c, 'bay', 2)).toMatchObject({ ok: true, message: 'Basket installed' });
    expect(c.pod.tiers.bay).toBe(2);
    expect(c.wallet.cash).toBe(250);
    expect(c.events).toEqual([{ t: 'purchase', kind: 'upgrade', amount: 750, line: 'bay', tier: 2 }]);
  });

  it('tiers are buyable out of order, with no trade-in', () => {
    const c = makeCtx('m0', 2_500);
    expect(buyUpgrade(c, 'tank', 3)).toMatchObject({ ok: true });
    expect(c.pod.tiers.tank).toBe(3);
    expect(c.wallet.cash).toBe(500);
    expect(buyUpgrade(c, 'tank', 2)).toEqual({ ok: false, reason: 'Already installed' });
  });

  it('a Tank keeps its litres; a hull tier repairs free (canon §2.4)', () => {
    const c = makeCtx('mvp', 10_000);
    c.pod.fuel = 3;
    buyUpgrade(c, 'tank', 2);
    expect(c.pod.fuel).toBe(3);
    c.pod.hull = 2;
    buyUpgrade(c, 'hull', 2);
    expect(c.pod.hull).toBe(17);
  });

  it('refuses unknown tiers and out-of-scope lines', () => {
    const c = makeCtx('m0', 1e6);
    expect(buyUpgrade(c, 'radiator', 2)).toMatchObject({ ok: false });
    expect(buyUpgrade(c, 'hull', 2)).toEqual({ ok: false, reason: BLOCK_NEXT_UPDATE });
  });
});

describe('repair ($15/HP)', () => {
  it('full repair rounds up to whole dollars', () => {
    const c = makeCtx('m0', 1_000);
    c.pod.hull = 3.9;
    expect(repairQuote(c)).toEqual({ amount: 10 - 3.9, cost: 92, limitedByCash: false });
    expect(repairAll(c)).toMatchObject({ ok: true });
    expect(c.pod.hull).toBe(10);
    expect(c.wallet.cash).toBe(908);
    expect(c.events).toEqual([{ t: 'purchase', kind: 'repair', amount: 92 }]);
  });

  it('partial when cash is short', () => {
    const c = makeCtx('m0', 50);
    c.pod.hull = 2;
    expect(repairQuote(c)).toEqual({ amount: 3, cost: 45, limitedByCash: true });
    repairAll(c);
    expect(c.pod.hull).toBe(5);
    expect(c.wallet.cash).toBe(5);
    expect(repairAll(c)).toMatchObject({ ok: false });
  });

  it('nothing to repair', () => {
    expect(repairAll(makeCtx())).toEqual({ ok: false, reason: 'Hull is already in good shape' });
  });
});

describe('Supply Shed (canon §2.7)', () => {
  it('offers all six consumables in M0', () => {
    const items = shedItems(makeCtx('m0'));
    expect(items.map((i) => i.id)).toEqual(['jerrycan', 'patchKit', 'pop', 'megaPop', 'hopBeacon', 'homingBeacon']);
    expect(items.every((i) => i.available && i.cap === 9 && i.owned === 0)).toBe(true);
    expect(items[2]).toMatchObject({ name: 'Pop Charge', price: 2_000 });
    expect(items[2].effect).toContain('3×3');
  });

  it('buys ×n up to the cap of 9', () => {
    const c = makeCtx('m0', 100_000);
    expect(buyConsumable(c, 'pop', 5)).toMatchObject({ ok: true, amount: 5 });
    expect(buyConsumable(c, 'pop', 9)).toMatchObject({ ok: true, amount: 4 });
    expect(c.pod.consumables.pop).toBe(9);
    expect(c.wallet.cash).toBe(100_000 - 9 * 2_000);
    expect(buyConsumable(c, 'pop', 1)).toEqual({ ok: false, reason: 'You already carry 9 Pop Charges' });
    expect(c.events).toEqual([
      { t: 'purchase', kind: 'consumable', amount: 10_000, id: 'pop' },
      { t: 'purchase', kind: 'consumable', amount: 8_000, id: 'pop' },
    ]);
  });

  it('refuses when cash is short', () => {
    const c = makeCtx('m0', 3_000);
    expect(buyConsumable(c, 'megaPop', 1)).toEqual({ ok: false, reason: 'Need $2,000 more' });
    expect(c.pod.consumables.megaPop).toBe(0);
  });

  it('quick slots swap instead of duplicating', () => {
    const c = makeCtx();
    expect(c.pod.quickSlots).toEqual(['pop', 'megaPop', 'jerrycan', 'patchKit']);
    setQuickSlot(c, 0, 'homingBeacon');
    expect(c.pod.quickSlots).toEqual(['homingBeacon', 'megaPop', 'jerrycan', 'patchKit']);
    setQuickSlot(c, 3, 'megaPop');
    expect(c.pod.quickSlots).toEqual(['homingBeacon', 'patchKit', 'jerrycan', 'megaPop']);
    setQuickSlot(c, 7, 'pop');
    expect(c.pod.quickSlots).toHaveLength(4);
  });
});

describe('salvage (canon §4.2)', () => {
  it('fee always charged, shortfall becomes debt, cargo lost, refuelled and repaired', () => {
    const c = makeCtx('m0', 20);
    c.pod.cargo.push(...ore(2, 3));
    c.pod.fuel = 0;
    c.pod.hull = 4;
    c.pod.consumables.pop = 2;
    const r = salvage(c);
    expect(r).toEqual({ fee: 25, debt: 5, lost: ore(2, 3) });
    expect(c.wallet).toMatchObject({ cash: 0, debt: 5 });
    expect(c.pod.cargo).toEqual([]);
    expect(c.pod.fuel).toBe(10);
    expect(c.pod.hull).toBe(10);
    expect(c.pod.consumables.pop).toBe(2);
  });

  it('scales with installed value', () => {
    const c = makeCtx('m0', 1_000);
    Object.assign(c.pod.tiers, { drill: 2, hull: 2, engine: 2, tank: 2, bay: 2 });
    expect(salvage(c)).toMatchObject({ fee: 300, debt: 0 });
    expect(c.wallet.cash).toBe(700);
  });
});

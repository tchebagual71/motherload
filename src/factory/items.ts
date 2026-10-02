// Item registry (02 §4.1, canon §2.8, §4.9). PURE MODULE.
// String ids are the stable identity (saves, UI, economy PartId, cargo kit ids); `num` is an append-only u16 index
// for typed arrays. NEVER renumber or reuse a `num`; append new items at the end.
import { MINERALS } from '../shared/canon';
import type { PartId } from '../economy/parts';

export type ItemClass =
  | 'specimen' // pod-mined bulk mineral, tiers 1–6
  | 'gem' // pod-mined gem, tiers 7–10
  | 'ore' // lode ore (Auto-Drill output)
  | 'ingot'
  | 'part'
  | 'cutGem'
  | 'gemPart'
  | 'service' // Fuel Drum, Weld Pack
  | 'kit';

export interface ItemDef {
  id: string;
  num: number;
  name: string;
  cls: ItemClass;
  /** Sale value (Assay 100% for specimens/gems; Export pays ⌊value × 9/10⌋). Book value for unsellable items. */
  value: number;
  /** Has an Export price (canon §4.9). */
  exportable: boolean;
  /** May ride underground logistics (belts, lifts) (canon §4.9). */
  underground: boolean;
  /** Mineral tier for specimens/gems/ores/ingots (1..10), else 0. */
  tier: number;
  scope: 'mvp' | 'v1';
}

const defs: ItemDef[] = [];
function add(d: Omit<ItemDef, 'num'>): void {
  defs.push({ ...d, num: defs.length + 1 });
}

// 1–10: pod specimens and gems (canon §2.2).
for (const m of MINERALS) {
  add({
    id: `spec${m.tier}`,
    name: m.name,
    cls: m.gem ? 'gem' : 'specimen',
    value: m.value,
    exportable: true,
    underground: !m.gem,
    tier: m.tier,
    scope: 'mvp',
  });
}
// 11–17: lode ore (0.1 × specimen; Kerogen $2).
const ORE_METALS = ['hematite', 'copper', 'cobalt', 'gold', 'iridium', 'thorium'] as const;
const ORE_NAMES = ['Hematite Ore', 'Copper Ore', 'Cobalt Ore', 'Gold Ore', 'Iridium Ore', 'Thorium Ore'];
ORE_METALS.forEach((metal, i) =>
  add({ id: `${metal}Ore`, name: ORE_NAMES[i], cls: 'ore', value: MINERALS[i].value / 10, exportable: true, underground: true, tier: i + 1, scope: metal === 'thorium' ? 'v1' : 'mvp' }),
);
add({ id: 'kerogen', name: 'Kerogen', cls: 'ore', value: 2, exportable: true, underground: true, tier: 0, scope: 'v1' });
// 18–23: ingots (2 × ore × 1.3).
const INGOTS: [string, string, number][] = [
  ['ironIngot', 'Iron Ingot', 8],
  ['copperIngot', 'Copper Ingot', 16],
  ['cobaltIngot', 'Cobalt Ingot', 26],
  ['goldIngot', 'Gold Ingot', 65],
  ['iridiumIngot', 'Iridium Ingot', 195],
  ['thoriumRod', 'Thorium Rod', 520],
];
INGOTS.forEach(([id, name, value], i) =>
  add({ id, name, cls: 'ingot', value, exportable: true, underground: true, tier: i + 1, scope: id === 'thoriumRod' ? 'v1' : 'mvp' }),
);
// 24–32: parts (ids match economy PartId).
const PARTS: [PartId, string, number, 'mvp' | 'v1'][] = [
  ['gear', 'Gear', 5, 'mvp'],
  ['wire', 'Wire', 10, 'mvp'],
  ['hullPlate', 'Hull Plate', 55, 'mvp'],
  ['coolantCoil', 'Coolant Coil', 60, 'mvp'],
  ['motor', 'Motor', 110, 'mvp'],
  ['circuit', 'Circuit', 125, 'mvp'],
  ['drillBit', 'Drill Bit', 265, 'mvp'],
  ['pressureVessel', 'Pressure Vessel', 400, 'mvp'],
  ['reactorCore', 'Reactor Core', 1_500, 'v1'],
];
for (const [id, name, value, scope] of PARTS) add({ id, name, cls: 'part', value, exportable: true, underground: true, tier: 0, scope });
// 33–35: cut gems; 36–38: gem parts (unsellable, non-exportable, surface only).
add({ id: 'cutPeridot', name: 'Cut Peridot', cls: 'cutGem', value: 5_000, exportable: false, underground: false, tier: 7, scope: 'v1' });
add({ id: 'cutFireOpal', name: 'Cut Fire Opal', cls: 'cutGem', value: 20_000, exportable: false, underground: false, tier: 8, scope: 'v1' });
add({ id: 'cutDiamond', name: 'Cut Diamond', cls: 'cutGem', value: 100_000, exportable: false, underground: false, tier: 9, scope: 'v1' });
add({ id: 'lens', name: 'Lens', cls: 'gemPart', value: 5_125, exportable: false, underground: false, tier: 0, scope: 'v1' });
add({ id: 'opalPlating', name: 'Opal Plating', cls: 'gemPart', value: 20_110, exportable: false, underground: false, tier: 0, scope: 'v1' });
add({ id: 'diamondBit', name: 'Diamond Bit', cls: 'gemPart', value: 100_530, exportable: false, underground: false, tier: 0, scope: 'v1' });
// 39–40: service items.
add({ id: 'fuelDrum', name: 'Fuel Drum', cls: 'service', value: 10, exportable: false, underground: true, tier: 0, scope: 'v1' });
add({ id: 'weldPack', name: 'Weld Pack', cls: 'service', value: 225, exportable: false, underground: false, tier: 0, scope: 'v1' });
// 41+: Kits (ids match pod kitSpec prefixes; book value = Shed price, 02 §3.1).
const KITS: [string, string, number, 'mvp' | 'v1'][] = [
  ['belt', 'Belt Kit', 80, 'mvp'],
  ['router', 'Router Kit', 60, 'mvp'],
  ['autoDrill', 'Auto-Drill Kit', 500, 'mvp'],
  ['liftFoot', 'Lift Foot Kit', 400, 'mvp'],
  ['liftRail', 'Lift Rail', 100, 'mvp'],
  ['depot', 'Depot Kit', 2_000, 'v1'],
  ['chute', 'Chute Kit', 150, 'v1'],
  ['shoring', 'Shoring Kit', 400, 'v1'],
  ['lamp', 'Lamp Kit', 100, 'v1'],
  ['magmaTap', 'Magma Tap Kit', 25_000, 'v1'],
  ['gasTap', 'Gas Tap Kit', 60_000, 'v1'],
  ['autoDrill2', 'Auto-Drill Kit Mk II', 3_000, 'v1'],
  ['autoDrill3', 'Auto-Drill Kit Mk III', 15_000, 'v1'],
  ['liftFoot2', 'Lift Foot Kit Mk II', 3_000, 'v1'],
  ['liftFoot3', 'Lift Foot Kit Mk III', 12_000, 'v1'],
  ['belt2', 'Belt Kit Mk II', 320, 'v1'],
  ['belt3', 'Belt Kit Mk III', 1_200, 'v1'],
];
for (const [id, name, value, scope] of KITS) add({ id: `kit:${id}`, name, cls: 'kit', value, exportable: false, underground: true, tier: 0, scope });

export const ITEMS: readonly ItemDef[] = defs;
const byId = new Map(defs.map((d) => [d.id, d]));
const byNum: (ItemDef | undefined)[] = [];
for (const d of defs) byNum[d.num] = d;

export function item(id: string): ItemDef {
  const d = byId.get(id);
  if (!d) throw new Error(`unknown item ${id}`);
  return d;
}
export function itemByNum(num: number): ItemDef | undefined {
  return byNum[num];
}
export function hasItem(id: string): boolean {
  return byId.has(id);
}
/** Item id for a pod specimen/gem of tier 1..10. */
export function specimenId(tier: number): string {
  return `spec${tier}`;
}
/** Item id for a Kit by its cargo kit id ('belt', 'liftFoot', …). */
export function kitItemId(kitId: string): string {
  return `kit:${kitId}`;
}
/** Export payout per item (02 §0.1): ⌊value × 9 / 10⌋. */
export function exportPrice(id: string): number {
  const d = item(id);
  return d.exportable ? Math.floor((d.value * 9) / 10) : 0;
}

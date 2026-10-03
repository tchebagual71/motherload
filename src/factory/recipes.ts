// Recipes S1–S10, A1–A13, G1–G3, R1 (02 §4.2) and their unlock rules (02 §0.2 F1, §9). PURE MODULE.
// `num` is the array index: a stable save code. Append only.
import type { Scope } from '../shared/types';
import type { Rung } from './api';
import { item } from './items';

export type Machine = 'smelter' | 'assembler' | 'refinery' | 'gemCutter';

export interface RecipeStack {
  item: string;
  /** Item registry num. */
  num: number;
  n: number;
}

export interface RecipeDef {
  id: string;
  num: number;
  machine: Machine;
  inputs: readonly RecipeStack[];
  outputs: readonly RecipeStack[];
  /** Craft time in ticks at s = 1. */
  ticks: number;
  /**
   * 'auto': the Smelter picks it from its first buffered item (02 §4.2).
   * A rung: unlocked with that rung. 'possession': once every input type has existed (F1).
   */
  unlock: 'auto' | Rung | 'possession';
  scope: Scope;
}

const SEC = 20;
const st = (id: string, n: number): RecipeStack => ({ item: id, num: item(id).num, n });

const defs: RecipeDef[] = [];
function add(id: string, machine: Machine, inputs: RecipeStack[], outputs: RecipeStack[], seconds: number, unlock: RecipeDef['unlock'], scope: Scope = 'mvp'): void {
  defs.push({ id, num: defs.length, machine, inputs, outputs, ticks: seconds * SEC, unlock, scope });
}

// S1–S6: 2 lode ore → 1 ingot, 4 s.
const ORES = ['hematiteOre', 'copperOre', 'cobaltOre', 'goldOre', 'iridiumOre', 'thoriumOre'];
const INGOTS = ['ironIngot', 'copperIngot', 'cobaltIngot', 'goldIngot', 'iridiumIngot', 'thoriumRod'];
ORES.forEach((ore, i) => add(`S${i + 1}`, 'smelter', [st(ore, 2)], [st(INGOTS[i], 1)], 4, 'auto', i === 5 ? 'v1' : 'mvp'));
// S7–S10: 1 specimen of tier 1–4 → 2 ingots, 6 s. Iridium and Thorium specimens are not smeltable.
for (let t = 1; t <= 4; t++) add(`S${t + 6}`, 'smelter', [st(`spec${t}`, 1)], [st(INGOTS[t - 1], 2)], 6, 'auto');

add('A1', 'assembler', [st('ironIngot', 1)], [st('gear', 2)], 2, 'U3');
add('A2', 'assembler', [st('copperIngot', 1)], [st('wire', 2)], 2, 'U3');
add('A3', 'assembler', [st('ironIngot', 2), st('cobaltIngot', 1)], [st('hullPlate', 1)], 5, 'U3');
add('A4', 'assembler', [st('wire', 2), st('cobaltIngot', 1)], [st('coolantCoil', 1)], 5, 'U3');
add('A5', 'assembler', [st('wire', 3), st('goldIngot', 1)], [st('circuit', 1)], 6, 'possession');
add('A6', 'assembler', [st('gear', 2), st('wire', 2), st('hullPlate', 1)], [st('motor', 1)], 8, 'possession');
add('A7', 'assembler', [st('iridiumIngot', 1), st('gear', 2)], [st('drillBit', 1)], 8, 'possession');
add('A8', 'assembler', [st('hullPlate', 2), st('iridiumIngot', 1)], [st('pressureVessel', 1)], 10, 'possession');
add('A9', 'assembler', [st('thoriumRod', 2), st('circuit', 1)], [st('reactorCore', 1)], 15, 'possession', 'v1');
add('A10', 'assembler', [st('hullPlate', 3), st('coolantCoil', 1)], [st('weldPack', 1)], 8, 'U3', 'v1');
add('A11', 'assembler', [st('cutPeridot', 1), st('circuit', 1)], [st('lens', 1)], 10, 'possession', 'v1');
add('A12', 'assembler', [st('cutFireOpal', 1), st('hullPlate', 2)], [st('opalPlating', 1)], 12, 'possession', 'v1');
add('A13', 'assembler', [st('cutDiamond', 1), st('drillBit', 2)], [st('diamondBit', 1)], 15, 'possession', 'v1');
add('G1', 'gemCutter', [st('spec7', 1)], [st('cutPeridot', 1)], 60, 'U9', 'v1');
add('G2', 'gemCutter', [st('spec8', 1)], [st('cutFireOpal', 1)], 60, 'U9', 'v1');
add('G3', 'gemCutter', [st('spec9', 1)], [st('cutDiamond', 1)], 60, 'U9', 'v1');
add('R1', 'refinery', [st('kerogen', 5)], [st('fuelDrum', 1)], 6, 'U7', 'v1');

export const RECIPES: readonly RecipeDef[] = defs;

/** Recipe num by id, or −1. */
export function recipeNum(id: string): number {
  for (const r of defs) if (r.id === id) return r.num;
  return -1;
}

/** Index of `itemNum` among a recipe's inputs, or −1. */
export function inputIndex(r: RecipeDef, itemNum: number): number {
  for (let i = 0; i < r.inputs.length; i++) if (r.inputs[i].num === itemNum) return i;
  return -1;
}

/** Smelter recipe for one buffered item (02 §4.2: the first smeltable item sets it), or −1. Scope-filtered. */
const SMELT_BY_ITEM: Int16Array = (() => {
  const a = new Int16Array(256).fill(-1);
  for (const r of defs) if (r.machine === 'smelter') a[r.inputs[0].num] = r.num;
  return a;
})();
export function smeltRecipeFor(itemNum: number, v1: boolean): number {
  const n = itemNum >= 0 && itemNum < 256 ? SMELT_BY_ITEM[itemNum] : -1;
  return n >= 0 && (v1 || defs[n].scope === 'mvp') ? n : -1;
}

/** Input buffer cap per ingredient (02 §3.2): Smelter 4 ore or 2 specimens; others 2 crafts' worth. */
export function inputCap(r: RecipeDef, i: number): number {
  if (r.machine === 'smelter') return r.inputs[0].n === 2 ? 4 : 2;
  return 2 * r.inputs[i].n;
}

/** Output buffer cap (02 §3.2): Smelter 6; others 2 crafts. */
export function outputCap(r: RecipeDef): number {
  return r.machine === 'smelter' ? 6 : 2 * r.outputs[0].n;
}

// How each registry item looks on a belt or in a bucket (03 §8.4): which instanced shape family and which tint.
// Lode ore and specimens are rough chunks in the ore colour, ingots trapezoid bars, gems faceted, parts their own
// cream + trim silhouettes, Kits role-banded crates. Indexed by the item's u16 registry num (factory/items).
import { Color } from 'three';
import { ITEMS, type ItemDef } from '../../factory/items';
import { ORES, ROLE, UI } from '../palette';
import { mixHex } from '../models/kit';
import type { ItemShape } from './models';

export const KEROGEN_HEX = 0x3a2e2a;

const PART_SHAPES: Readonly<Record<string, ItemShape>> = {
  gear: 'gear',
  wire: 'wire',
  hullPlate: 'plate',
  coolantCoil: 'coil',
  motor: 'motor',
  circuit: 'circuit',
  drillBit: 'bit',
  pressureVessel: 'vessel',
  reactorCore: 'core',
};

/** Kit crates carry their building's role colour (03 §8.4 "Kits: role band"). */
function kitHex(id: string): number {
  const kit = id.slice(4).replace(/[23]$/, '');
  if (kit === 'autoDrill' || kit === 'magmaTap' || kit === 'gasTap') return ROLE.extraction;
  if (kit === 'depot') return ROLE.storage;
  if (kit === 'shoring' || kit === 'lamp') return ROLE.support;
  return ROLE.logistics;
}

function oreHex(tier: number): number {
  return tier >= 1 && tier <= ORES.length ? ORES[tier - 1].base : KEROGEN_HEX;
}

export interface ItemLook {
  shape: ItemShape;
  /** Instance tint (palette hex); white for shapes that carry their own colours. */
  hex: number;
}

export function itemLook(d: ItemDef): ItemLook {
  switch (d.cls) {
    case 'specimen':
    case 'ore':
      return { shape: 'chunk', hex: oreHex(d.tier) };
    case 'gem':
    case 'cutGem':
      return { shape: 'gem', hex: oreHex(d.tier) };
    case 'ingot':
      return { shape: 'ingot', hex: d.tier >= 1 ? mixHex(ORES[d.tier - 1].base, ORES[d.tier - 1].highlight, 0.3) : 0xcccccc };
    case 'part':
      return { shape: PART_SHAPES[d.id] ?? 'crate', hex: 0xffffff };
    case 'gemPart':
      return { shape: 'gem', hex: ORES[8].base };
    case 'service':
      return { shape: 'crate', hex: d.id === 'fuelDrum' ? UI.amber : 0xf4f1ea };
    case 'kit':
      return { shape: 'crate', hex: kitHex(d.id) };
  }
}

export interface ItemTable {
  /** Shape family index per item num (into `shapes`); 255 = unknown. */
  family: Uint8Array;
  /** Linear rgb tint per item num. */
  rgb: Float32Array;
  shapes: ItemShape[];
}

/** Lookup tables by item num, built once. */
export function buildItemTable(): ItemTable {
  const maxNum = ITEMS.reduce((m, d) => Math.max(m, d.num), 0);
  const family = new Uint8Array(maxNum + 1).fill(255);
  const rgb = new Float32Array((maxNum + 1) * 3).fill(1);
  const shapes: ItemShape[] = [];
  const c = new Color();
  for (const d of ITEMS) {
    const look = itemLook(d);
    let k = shapes.indexOf(look.shape);
    if (k < 0) k = shapes.push(look.shape) - 1;
    family[d.num] = k;
    c.setHex(look.hex);
    rgb[d.num * 3] = c.r;
    rgb[d.num * 3 + 1] = c.g;
    rgb[d.num * 3 + 2] = c.b;
  }
  return { family, rgb, shapes };
}

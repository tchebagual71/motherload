// Game events emitted by the simulation each step. Consumed by UI (toasts), audio (SFX), render (FX) and story.
// PURE MODULE.
import type { CargoItem, ConsumableId, Line, RimBuildingId } from './types';

export type DigRefusal = 'hardrock' | 'lode' | 'seam' | 'seal' | 'paved' | 'anchored' | 'heartstone' | 'floor';
export type DamageCause = 'landing' | 'magma' | 'methane';

export type GameEvent =
  | { t: 'dig-start'; x: number; r: number; code: number }
  | { t: 'dug'; x: number; r: number; code: number }
  | { t: 'collect'; item: CargoItem }
  | { t: 'bay-full'; item: CargoItem }
  | { t: 'dig-refused'; x: number; r: number; reason: DigRefusal }
  | { t: 'lode-discovered'; lodeId: number }
  | { t: 'damage'; amount: number; cause: DamageCause }
  | { t: 'landed'; v: number }
  | { t: 'fuel-warning'; level: 0 | 1 | 2 } // 20 / 10 / 5 %
  | { t: 'hull-warning' }
  | { t: 'destroyed'; cause: 'hull' | 'fuel' }
  | { t: 'respawned'; fee: number; debt: number; lost: CargoItem[] }
  | { t: 'explosion'; x: number; r: number; radius: number }
  | { t: 'consumable-used'; id: ConsumableId }
  | { t: 'consumable-refused'; id: ConsumableId; reason: 'airborne' | 'empty' | 'cooldown' }
  | { t: 'teleport'; id: ConsumableId; x: number; y: number }
  | { t: 'left-rim' }
  | { t: 'trip-end'; trip: number; deepestRow: number }
  | { t: 'depth-record'; row: number }
  | { t: 'incentive'; row: number; ft: number; cash: number }
  | { t: 'pad-arrive'; id: RimBuildingId }
  | { t: 'sale'; amount: number; count: number }
  | { t: 'purchase'; kind: 'fuel' | 'repair' | 'upgrade' | 'consumable' | 'kit' | 'yard'; amount: number; line?: Line; tier?: number; id?: ConsumableId; kit?: string }
  | { t: 'coop-credit'; liters: number }
  | { t: 'toast'; text: string; tone?: 'info' | 'warn' | 'good' }
  | { t: 'radio'; beat: string; sender: 'Dot' | 'Channel Zero' | 'Marlow' | 'the Surveyor' | 'Deepreach log'; cards: string[] }
  // ---- Factory (02 §10.10 events) ----
  | { t: 'first-lift-delivery' }
  | { t: 'first-ingot'; item: string }
  | { t: 'unlock'; rung: string; label: string }
  | { t: 'export-sale'; amount: number; count: number }
  | { t: 'ghost-complete'; kind: string }
  | { t: 'lode-pinged'; lodeId: number }
  // ---- Story / progression ----
  | { t: 'milestone'; id: string; title: string }
  | { t: 'starter-kit' };

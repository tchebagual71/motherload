// Public contract of the authoritative simulation (canon §4.10: one main-thread World).
// UI, render, audio and save code depend on THIS file only, never on world internals.
// PURE MODULE (types only).
import type { Line } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { CargoItem, ConsumableId, RimBuildingId, Scope } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';
import type { PodIntent, PodState } from '../pod/types';

export interface Wallet {
  cash: number;
  /** Unpaid salvage fee ("Co-op debt"), collected from the next Assay sale. */
  debt: number;
  lifetimeEarned: number;
}

export interface StoryState {
  /** Deepest row ever reached by the pod centre. */
  deepestRow: number;
  /** Completed trips (first frame grounded on the Rim after any time at r ≥ 1). */
  trips: number;
  /** Deepest row reached during the current trip. */
  tripDeepestRow: number;
  /** Whether the pod has been below row 0 since last on the Rim. */
  underground: boolean;
  /** Incentive rows already paid (canon §3.8). */
  incentivesPaid: number[];
  /** One-shot story / tutorial flags. */
  flags: Record<string, boolean>;
  /** Step number at which Co-op Credit is next available. */
  coopCreditReadyStep: number;
  destructions: number;
}

/** Derived pod stats from installed tiers (canon §2.6). */
export interface PodStats {
  maxFuel: number;
  maxHull: number;
  engineHp: number;
  hoverCap: number;
  vUp: number;
  digSteps: number;
  radiator: number;
  baySlots: number;
  cargoMass: number;
  scannerLodeRadius: number;
}

export type Result = { ok: true; amount?: number; message?: string } | { ok: false; reason: string };

export interface UpgradeCard {
  line: Line;
  tier: number;
  name: string;
  price: number;
  /** Installed tier on this line. */
  installedTier: number;
  installedName: string;
  /** Human-readable stat of this tier and of the installed one, e.g. "25 L" vs "15 L". */
  stat: string;
  installedStat: string;
  /** In scope for this build (canon §5.5) and the tier exists on this line. */
  available: boolean;
  affordable: boolean;
  /** Parts required (MVP: from t3). Empty in M0. */
  parts: { item: string; need: number; have: number }[];
  /** Why it can't be bought right now (null = can buy). */
  blocker: string | null;
}

export interface ShopItem {
  id: ConsumableId;
  name: string;
  price: number;
  owned: number;
  cap: number;
  available: boolean;
  effect: string;
}

export interface CargoGroup {
  item: CargoItem;
  label: string;
  count: number;
  unitValue: number;
  totalValue: number;
  mass: number;
}

export interface Quote {
  /** Litres / HP that would be bought, cash cost, and whether it is limited by cash. */
  amount: number;
  cost: number;
  limitedByCash: boolean;
}

export interface WorldApi {
  readonly seed: number;
  readonly scope: Scope;
  readonly terrain: TerrainGrid;
  readonly pod: Readonly<PodState>;
  readonly wallet: Readonly<Wallet>;
  readonly story: Readonly<StoryState>;
  /** Fixed 60 Hz step counter. */
  readonly stepNo: number;

  /** Advance one 60 Hz step. `podRunning` = false while a sheet/build/menu/interrupt pauses the pod (canon §4.5). */
  step(intent: PodIntent, podRunning: boolean): void;
  /** Events emitted since the last drain. */
  drainEvents(): GameEvent[];
  stats(): PodStats;

  /** Rim pad under the grounded pod, if any. */
  padUnderPod(): RimBuildingId | null;
  /** Re-arm rule hook: UI calls this when a sheet closes so the pad stays disarmed until the pod leaves it. */
  sheetClosed(id: RimBuildingId): void;
  /**
   * The pod stands on this pad and it is not latched: stick-neutral 0.3 s opens its sheet (canon §2.4). The Rim
   * lights pulse for armed pads and dim for the latched one under the pod (03 §6.4).
   */
  isPadArmed(id: RimBuildingId): boolean;

  // ---- Pump House ----
  fuelQuote(liters: number | 'fill'): Quote;
  buyFuel(liters: number | 'fill'): Result;
  // ---- Assay Office ----
  cargoGroups(): CargoGroup[];
  cargoValue(): number;
  sellAll(): Result;
  // ---- Garage ----
  repairQuote(): Quote;
  repairAll(): Result;
  garageCards(): UpgradeCard[];
  buyUpgrade(line: Line, tier: number): Result;
  // ---- Supply Shed ----
  shedItems(): ShopItem[];
  buyConsumable(id: ConsumableId, n: number): Result;
  /** Change which consumables sit in the 4 quick slots. */
  setQuickSlot(slot: number, id: ConsumableId): void;

  // ---- Failure ----
  /** Salvage after destruction: lose cargo, pay the fee (shortfall → debt), refuel/repair, respawn on the Pump House pad (disarmed). */
  respawn(): { fee: number; debt: number; lost: CargoItem[] };

  // ---- Persistence ----
  serialize(): Uint8Array;

  // ---- Debug (dev menu only) ----
  debugTeleport(row: number): void;
  debugGiveCash(amount: number): void;
  debugSetTier(line: Line, tier: number): void;
}

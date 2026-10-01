// HoleFactory canonical constants. Source of truth: docs/design/00-canon.md (rev 2).
// Section references (§x) point at that document unless prefixed with 01/02/03/04.
// PURE MODULE: no DOM, no three, no Date/Math.random.

// ---------- §3.1 World geometry ----------
export const TILE_FT = 12.5;
export const MINE_W = 48;
export const MINE_H = 608;
export const DIG_LAST_ROW = 583;
export const SEAL_ROW = 584;
export const NOTCH_X0 = 46;
export const NOTCH_X1 = 47;
export const HEART_TOP_ROW = 585;
export const SKY_ROWS = 64;
/** Thrust fades linearly to 0 over the top 8 sky rows (01 §3.2). */
export const SKY_FADE_ROWS = 8;
export const YARD_W = 48;
export const YARD_D_MAX = 32;
export const YARD_D_START = 8;
export const YARD_EXPANSION_ROWS = 8;
export const YARD_EXPANSION_PRICES = [2_500, 25_000, 250_000] as const;
export const CHUNK = 16;
export const BAND_ROWS = 64;
/** Pod body in world units (w × h × d). Fits a 1-wide shaft. */
export const POD_W = 0.86;
export const POD_H = 0.78;
export const POD_D = 0.8;

// ---------- §2.5 Strata bands ----------
export const BANDS = [
  { id: 'B0', name: 'Rust Flats', top: 0, bottom: 19 },
  { id: 'B1', name: 'Ochre Beds', top: 20, bottom: 63 },
  { id: 'B2', name: 'Clay Deeps', top: 64, bottom: 128 },
  { id: 'B3', name: 'Violet Shale', top: 129, bottom: 261 },
  { id: 'B4', name: 'Blue Basalt', top: 262, bottom: 395 },
  { id: 'B5', name: 'Obsidian Hush', top: 396, bottom: 479 },
  { id: 'B6', name: 'Ember Mantle', top: 480, bottom: 583 },
  { id: 'B7', name: 'the Hollow Heart', top: 584, bottom: 607 },
] as const;

// ---------- §2.10 / §3.3 Hazards ----------
export const HARDROCK_ROW = 129;
export const MAGMA_ROW = 262;
export const METHANE_ROW = 396;
export const STATIC_ZONE_ROW = 465;
export const DEEP_FLOOR_ROW = 516;
export const MAGMA_HIT = 29;
export const MAGMA_HITS = 2;
export const MAGMA_HIT_GAP_STEPS = 6;
/** Methane breach damage = floor((TILE_FT*row - 3000)/15) * R (§3.3). */
export function methaneDamage(row: number, radiator: number): number {
  return Math.floor((TILE_FT * row - 3000) / 15) * radiator;
}
export const HARD_LANDING_V = 5.88;
export const HARD_LANDING_K = 0.5952;

// ---------- §3.5 Simulation rates ----------
export const STEP_HZ = 60;
export const STEP = 1 / STEP_HZ;
export const FACTORY_HZ = 20;
/** Factory ticks on stepNo % FACTORY_EVERY === FACTORY_PHASE. */
export const FACTORY_EVERY = 3;
export const FACTORY_PHASE = 2;
export const MAX_STEPS_PER_FRAME = 5;
export const FRAME_DT_CLAMP_MS = 250;

// ---------- §3.6 Pod constants (60 Hz) ----------
export const G = 11.537; // tiles/s^2
export const AIR_DRAG = 0.985958; // per step, airborne vx and vy
export const GROUND_FRICTION = 0.957612; // per step, grounded vx with no drive input
export const TERMINAL_V = 13.5;
export const FALL_CAP_V = 16.8;
export const POD_BASE_MASS = 200; // M0 in mu
export const THRUST_STICK_DEADZONE = 0.35; // s_t = clamp((stick_y - 0.35)/0.65, 0, 1)
export const HORIZONTAL_THRUST_FRAC = 0.4;
export const VX_MAX = 4.5;
export const FUEL_MOVE_K = 0.00084; // L/s per hp at full input
export const FUEL_DIG_K = 0.00168; // L/s per hp while digging
export const DIG_ENGAGE_STEPS = 7;
export const DIG_STICK_MIN = 0.45;
export const DIG_HYSTERESIS_DEG = 10;
export const DIG_CLEAR_FRAC = 0.375;
export const BOUNCE_VY = -0.2;
export const ITEM_COOLDOWN_STEPS = 7;
export const GAP_SKIM_VX = 1.5; // 01 §3.2
export const START_CASH = 20;
export const START_HULL = 10;
export const START_FUEL = 6;
export const START_X = 7;

// ---------- §2.6 Upgrade lines ----------
export const LINES = ['drill', 'hull', 'engine', 'tank', 'radiator', 'bay', 'scanner'] as const;
export type Line = (typeof LINES)[number];
export const TIER_PRICE = [0, 750, 2_000, 5_000, 20_000, 100_000, 500_000] as const;

/** Per-line tier data, index 0 = t1. `null` = tier does not exist on this line. */
export interface TierSpec {
  name: string;
}
export const DRILL = [
  { name: 'Stub Bit', steps: 29 },
  { name: 'Corkscrew', steps: 20 },
  { name: 'Twin Screw', steps: 14 },
  { name: 'Auger', steps: 11 },
  { name: 'Grinder Bit', steps: 8 },
  { name: 'Glasscutter', steps: 6 },
  { name: 'Starbore', steps: 5 },
] as const;
export const HULL = [
  { name: 'Tin Can', hp: 10 },
  { name: 'Rivet Hull', hp: 17 },
  { name: 'Boilerplate', hp: 30 },
  { name: 'Ironclad', hp: 50 },
  { name: 'Bulwark', hp: 80 },
  { name: 'Bastion', hp: 120 },
  { name: 'Starshell', hp: 180 },
] as const;
export const ENGINE = [
  { name: 'Putter', hp: 150, cap: 100, vUp: 7.0 },
  { name: 'Chugger', hp: 160, cap: 125, vUp: 8.0 },
  { name: 'Thumper', hp: 170, cap: 160, vUp: 9.0 },
  { name: 'Growler', hp: 180, cap: 220, vUp: 10.5 },
  { name: 'Roarer', hp: 190, cap: 320, vUp: 12.0 },
  { name: 'Twin Roarer', hp: 200, cap: 460, vUp: 13.5 },
  { name: 'Thunderhead', hp: 210, cap: 620, vUp: 15.0 },
] as const;
export const TANK = [
  { name: 'Thimble', liters: 10 },
  { name: 'Canteen', liters: 15 },
  { name: 'Jug', liters: 25 },
  { name: 'Keg', liters: 40 },
  { name: 'Cask', liters: 60 },
  { name: 'Vat', liters: 100 },
  { name: 'Cryo Flask', liters: 150 },
] as const;
export const RADIATOR = [
  { name: 'Desk Fan', r: 1.0 },
  null,
  { name: 'Box Fan', r: 0.9 },
  { name: 'Coil Sink', r: 0.75 },
  { name: 'Twin Coil', r: 0.6 },
  { name: 'Frost Loop', r: 0.4 },
  { name: 'Cryo Lattice', r: 0.2 },
] as const;
export const BAY = [
  { name: 'Satchel', slots: 7 },
  { name: 'Basket', slots: 15 },
  { name: 'Trunk', slots: 25 },
  { name: 'Crate Rack', slots: 40 },
  { name: 'Wagon', slots: 70 },
  { name: 'Freight Hold', slots: 120 },
  null,
] as const;
/** Scanner: lode discovery radius (Chebyshev; Tin Ear = 8 neighbours) and Sniffer radius. */
export const SCANNER = [
  { name: 'Tin Ear', lodeRadius: 1, sniffer: 2 },
  null,
  { name: 'Dowser', lodeRadius: 6, sniffer: 3 },
  null,
  { name: 'Echo Sounder', lodeRadius: 6, sniffer: 4 },
  { name: 'Deep Eye', lodeRadius: 12, sniffer: 3 },
  { name: 'Claimsight', lodeRadius: 12, sniffer: 6 },
] as const;

export function lineTierName(line: Line, tier: number): string | null {
  const t = tier - 1;
  const table = { drill: DRILL, hull: HULL, engine: ENGINE, tank: TANK, radiator: RADIATOR, bay: BAY, scanner: SCANNER }[line];
  const row = table[t];
  return row ? row.name : null;
}

// ---------- §2.2 Minerals, §2.3 relics ----------
export interface MineralSpec {
  tier: number;
  name: string;
  value: number;
  mass: number;
  gem: boolean;
}
export const MINERALS: readonly MineralSpec[] = [
  { tier: 1, name: 'Hematite', value: 30, mass: 1, gem: false },
  { tier: 2, name: 'Copper', value: 60, mass: 1, gem: false },
  { tier: 3, name: 'Cobalt', value: 100, mass: 1, gem: false },
  { tier: 4, name: 'Gold', value: 250, mass: 2, gem: false },
  { tier: 5, name: 'Iridium', value: 750, mass: 3, gem: false },
  { tier: 6, name: 'Thorium', value: 2_000, mass: 4, gem: false },
  { tier: 7, name: 'Peridot', value: 5_000, mass: 6, gem: true },
  { tier: 8, name: 'Fire Opal', value: 20_000, mass: 8, gem: true },
  { tier: 9, name: 'Diamond', value: 100_000, mass: 10, gem: true },
  { tier: 10, name: 'Echo Quartz', value: 500_000, mass: 12, gem: true },
];
export interface RelicSpec {
  id: number;
  name: string;
  value: number;
}
export const RELICS: readonly RelicSpec[] = [
  { id: 0, name: 'Fossil Shell', value: 1_000 },
  { id: 1, name: "Prospector's Strongbox", value: 5_000 },
  { id: 2, name: 'Lost Pod Recorder', value: 10_000 },
  { id: 3, name: 'Sigil Tablet', value: 50_000 },
];
export const RELIC_MASS = 1;
export const RELIC_MIN_ROW = 76;
export const MIN_RECORDERS = 6;

// ---------- §2.7 Consumables ----------
export const CONSUMABLES = [
  { id: 'jerrycan', name: 'Jerrycan', price: 2_000, grounded: false },
  { id: 'patchKit', name: 'Patch Kit', price: 7_500, grounded: false },
  { id: 'pop', name: 'Pop Charge', price: 2_000, grounded: true },
  { id: 'megaPop', name: 'Mega Pop', price: 5_000, grounded: true },
  { id: 'hopBeacon', name: 'Hop Beacon', price: 2_000, grounded: true },
  { id: 'homingBeacon', name: 'Homing Beacon', price: 10_000, grounded: true },
] as const;
export type ConsumableId = (typeof CONSUMABLES)[number]['id'];
export const CONSUMABLE_CAP = 9;
export const JERRYCAN_LITERS = 25;
export const PATCH_KIT_HP = 30;
export const POP_RADIUS = 1; // 3×3
export const MEGA_POP_RADIUS = 2; // 5×5
export const DEFAULT_QUICK_SLOTS: readonly ConsumableId[] = ['pop', 'megaPop', 'jerrycan', 'patchKit'];

// ---------- §2.4 Rim services (Rim x ranges, inclusive) ----------
export const RIM_BUILDINGS = [
  { id: 'pump', name: 'Pump House', x0: 1, x1: 4 },
  { id: 'assay', name: 'Assay Office', x0: 10, x1: 13 },
  { id: 'garage', name: 'Garage', x0: 30, x1: 33 },
  { id: 'shed', name: 'Supply Shed', x0: 40, x1: 43 },
] as const;
export type RimBuildingId = (typeof RIM_BUILDINGS)[number]['id'];
export const PAD_NEUTRAL_STEPS = 18; // 0.3 s
export const PAD_REARM_AIRBORNE_STEPS = 12; // 0.2 s

// ---------- §3.8 Economy base values ----------
export const FUEL_PRICE_PER_L = 1;
export const REPAIR_PRICE_PER_HP = 15;
export const EXPORT_RATE = 0.9;
export const INCENTIVES = [
  { row: 40, ft: 500, cash: 1_000 },
  { row: 80, ft: 1_000, cash: 3_000 },
  { row: 280, ft: 3_500, cash: 25_000 },
] as const;
export const SALVAGE_MIN = 25;
export const SALVAGE_RATE = 0.08;
export const COOP_CREDIT_LITERS = 5;
export const COOP_CREDIT_CASH_BELOW = 5;
export const COOP_CREDIT_FUEL_BELOW = 2;
export const COOP_CREDIT_COOLDOWN_STEPS = 10 * 60 * STEP_HZ;
export const FUEL_WARNINGS = [0.2, 0.1, 0.05] as const;
export const HULL_WARNING = 0.25;

// ---------- §3.4 Camera ----------
export const CAMERA = {
  surfacePlay: { yaw: 45, pitch: 35, ppu: 36, zoomMin: 24, zoomMax: 60 },
  surfaceBuild: { yaw: 45, pitch: 55, ppu: 39, zoomMin: 39, zoomMax: 64 },
  undergroundPlay: { yaw: 20, pitch: 20, ppu: 41, ppuShort: 38, zoomMin: 30, zoomMax: 56 },
  undergroundBuild: { yaw: 8, pitch: 12, ppu: 47, zoomMin: 47, zoomMax: 60 },
  arena: { yaw: 20, pitch: 20, ppu: 26 },
  blendRows: 4,
  followOmega: 8,
  deadZone: 1,
  lookAhead: 1.5,
  anchors: { rim: 0.68, sky: 0.5, grounded: 0.35, climbing: 0.62 },
  perspectiveFov: 20,
} as const;

// ---------- §3.11 Factory constants ----------
export const BELT_SPEED_TILES_PER_S = 1;
export const BELT_SPACING = [1.0, 0.5, 0.25] as const;
export const DRILL_RATE_PER_MIN = [8, 10, 24] as const;
export const LIFT_RATE_PER_MIN = [30, 90, 240] as const;
export const LIFT_FOOT_ROWS = 32;
export const LIFT_RAIL_ROWS = 32;
export const SMELT_ORE_TICKS = 4 * FACTORY_HZ;
export const SMELT_SPECIMEN_TICKS = 6 * FACTORY_HZ;
export const BIN_CAPACITY = 200;
export const SILO_CAPACITY = 1_000;
export const EXPORT_ITEMS_PER_MIN = 240;
export const EXPORT_BUFFER = 50;

// ---------- §3.2 Lodes ----------
export const PURITY = { poor: 0.5, normal: 1, rich: 2 } as const;
export type Purity = keyof typeof PURITY;
export const LODE_W = 3;
export const LODE_H = 2;
export const SCRIPTED_LODE_TOP = 46;
export const SURVEY_PING_ROW = 32;
export const MVP_SEAL_ROW = 320;
export const M0_FLOOR_ROW = 128;

// ---------- §3.12 Touch constants ----------
export const TOUCH = {
  tapMs: 250,
  tapMovePt: 10,
  worldTapMs: 200,
  longPressMs: 450,
  slotReassignMs: 600,
  explosiveArmMs: 250,
  explosiveArenaArmMs: 150,
  explosiveCancelSlidePt: 24,
  pinchWindowMs: 150,
  secondFingerGraceMs: 120,
  liftedPointPt: 44,
  edgePanMarginPt: 40,
  stickRadius: { S: 44, M: 52, L: 60 },
  stickKnob: 28,
  stickDeadZone: 8,
  stickZoneMaxPt: 300,
  slotSize: 56,
  controlZone: { S: 150, M: 166, L: 182 },
  hudRow: 44,
  minHit: 44,
  resumeCountdownMs: 1500,
  resumeAirborneV: 3,
} as const;

// ---------- §3.15 Save ----------
export const SAVE_MAGIC = 'HFSV';
export const SAVE_ROUTINE_MS = 30_000;
export const EXPORT_PREFIX = 'HF1:';

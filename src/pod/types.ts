// Pod state and per-step input. PURE MODULE.
import type { CargoItem, ConsumableId, Line } from '../shared/types';

export type DigDir = 'down' | 'left' | 'right';
export type Sector = 'none' | 'up' | 'down' | 'left' | 'right';

/** One frame of player intent, produced by input/ (touch stick, keyboard). */
export interface PodIntent {
  /** Stick x in [-1, 1] (right positive). */
  sx: number;
  /** Stick y in [-1, 1] (UP positive). Thrust uses s_t = clamp((sy - 0.35)/0.65, 0, 1). */
  sy: number;
  /** Dedicated THRUST button held (s_t = 1). */
  thrust: boolean;
  /** Quick slot fired this step (edge-triggered by input on release after arming), -1 = none. */
  fireSlot: number;
}
export const NO_INTENT: PodIntent = { sx: 0, sy: 0, thrust: false, fireSlot: -1 };

export interface DigState {
  x: number;
  r: number;
  dir: DigDir;
  /** Steps elapsed. */
  progress: number;
  /** Steps total for this cell (drill tier). */
  total: number;
  /** Cell already cleared (at 37.5%); the pod is moving into it. */
  cleared: boolean;
  /** Pod start position, for the slide-in animation. */
  fromX: number;
  fromY: number;
}

export interface PodState {
  /** Centre position, world units. x ∈ [0, 48]; y up, y = 0 at the Rim surface (row r centre at -(r+0.5)). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Position at the previous step, for render interpolation. */
  prevX: number;
  prevY: number;
  grounded: boolean;
  facing: 1 | -1;
  fuel: number;
  hull: number;
  /** Installed tier per line, 1..7. */
  tiers: Record<Line, number>;
  cargo: CargoItem[];
  consumables: Record<ConsumableId, number>;
  quickSlots: ConsumableId[];
  dig: DigState | null;
  /** Steps the stick has been pushed into the current diggable neighbour (engage counter). */
  engageSteps: number;
  engageDir: DigDir | null;
  /** Current stick sector with ±10° hysteresis. */
  sector: Sector;
  /** Item cooldown remaining (steps). */
  cooldown: number;
  /** Pending magma second hit: steps until it lands (0 = none). */
  magmaPending: number;
  /** Last applied thrust 0..1 (render flame, audio). */
  thrust: number;
  /** Was digging this step (render drill spin, audio). */
  digging: boolean;
  /** Highest fuel warning level emitted since last refuel (-1 none). */
  fuelWarn: number;
  hullWarned: boolean;
  /** Steps airborne (pad re-arm rule). */
  airSteps: number;
  destroyed: boolean;
  /** Current row of the pod centre (derived, kept for convenience). */
  row: number;
}

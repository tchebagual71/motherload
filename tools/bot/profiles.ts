import type { Line } from '../../src/shared/canon';

// Economy bot profiles (04 §11.2; 01 §2.2 trip model; canon §4.3.1, §4.4). Every number is a [tune] knob of the
// minimal bot, not canon: proficient ≈ 3 dug tiles per mineral, 20% think time, returns at bay-full or fuel ≤ 1.3 ×
// the Return Tick climb; slow-median ≈ 5.1 tiles per mineral, 60% think time, +20 s per shop, fuel ≤ 1.1 × climb.

export interface BotProfile {
  readonly name: 'proficient' | 'slow-median';
  /** Fraction of play time spent thinking (idle, grounded): 0.2 / 0.6. */
  readonly think: number;
  /** Extra seconds on each shop pad (reading the sheet). */
  readonly shopSeconds: number;
  /** Seconds per build-mode command (place, paint, set recipe), the pod frozen. */
  readonly buildSeconds: number;
  /** Turn back when fuel ≤ greed × Return Tick litres (canon §4.4: 1.3 proficient, 1.1 slow). */
  readonly greed: number;
  /** Extra litres kept on top of greed × climb (sideways routing the Return Tick ignores). */
  readonly fuelMargin: number;
  /** Turn back below this hull fraction. */
  readonly hullFloor: number;
  /**
   * Target choice: a mineral scores value / (steps + overhead). The slow player's eye is noisier: it misjudges each
   * candidate's score by ± `noise` and sees only candidates within `sight` steps.
   */
  readonly overhead: number;
  readonly noise: number;
  readonly sight: number;
  /** Expected aimless extra digs per mineral collected (dig efficiency, 01 §2.2: ≈ 3 vs ≈ 5.1 tiles per mineral). */
  readonly wander: number;
  /** Landing speed aimed for (tiles/s; hard landings start at 5.88). */
  readonly brakeV: number;
  /** Top speed down a long open shaft before the landing burn (tiles/s; terminal 13.5). */
  readonly fallV: number;
  /** Pop Charges kept for Hardrock in the main shaft (01 §2.4: "Pop Charges stocked for Hardrock"). */
  readonly pops: number;
  /** Top ground speed (tiles/s). */
  readonly driveV: number;
  /** Cash kept back from purchases for fuel and repairs. */
  readonly reserve: number;
}

export const PROFICIENT: BotProfile = {
  name: 'proficient',
  think: 0.2,
  shopSeconds: 3,
  buildSeconds: 3,
  greed: 1.3,
  fuelMargin: 0.4,
  hullFloor: 0.3,
  overhead: 60,
  noise: 0,
  sight: 1_400,
  wander: 0,
  brakeV: 4.6,
  fallV: 12,
  pops: 4,
  driveV: 4.5,
  reserve: 40,
};

export const SLOW_MEDIAN: BotProfile = {
  name: 'slow-median',
  think: 0.6,
  shopSeconds: 20,
  buildSeconds: 8,
  greed: 1.1,
  fuelMargin: 0.2,
  hullFloor: 0.2,
  overhead: 60,
  noise: 0.6,
  sight: 700,
  wander: 3.6,
  brakeV: 5.2,
  fallV: 8,
  pops: 2,
  driveV: 3.5,
  reserve: 40,
};

export const PROFILES: readonly BotProfile[] = [PROFICIENT, SLOW_MEDIAN];

/** The upgrade order (01 §5.5 curve): Bay and Drill first, then Tank; t3s once parts flow; t4–t5 by line. */
export const UPGRADE_ORDER: readonly (readonly [Line, number])[] = [
  ['bay', 2],
  ['drill', 2],
  ['tank', 2],
  ['engine', 2],
  ['hull', 2],
  ['drill', 3],
  ['tank', 3],
  ['bay', 3],
  ['hull', 3],
  ['engine', 3],
  ['radiator', 3],
  ['scanner', 3],
  ['drill', 4],
  ['bay', 4],
  ['hull', 4],
  ['engine', 4],
  ['radiator', 4],
  ['tank', 4],
  ['drill', 5],
  ['bay', 5],
  ['engine', 5],
  ['hull', 5],
  ['tank', 5],
  ['radiator', 5],
];

// Placement of the pending ghost's DOM aids (03 §4.3 nudge arrows, §6.2 reason label; BUILD-6, BUILD-7). Pure.
import { describe, expect, it } from 'vitest';
import { FINGER_CLEAR, LABEL, NUDGE_BOX, boxDistance, labelBox, labelWidth, nudgeSpot, type Pt } from '../../src/ui/build/aids';

const AREA = { x0: 0, y0: 64, x1: 375, y1: 483 };

describe('ghost reason label (BUILD-7)', () => {
  it('sits centred above the ghost and is clamped inside the screen edges', () => {
    const w = labelWidth("Something's already here");
    expect(w).toBeLessThanOrEqual(LABEL.maxW);
    expect(labelBox({ x: 200, y: 300 }, 360, w, LABEL.h, AREA, 70)).toEqual({ x: 200 - w / 2, y: 300 - LABEL.gapAbove - LABEL.h, w, h: LABEL.h });
    // Near the right edge (the SE case: 'Something's already here' spanned x 231–393 of 375).
    const right = labelBox({ x: 312, y: 300 }, 360, w, LABEL.h, AREA, 70)!;
    expect(right.x + right.w).toBe(AREA.x1 - LABEL.edge);
    const left = labelBox({ x: 10, y: 300 }, 360, w, LABEL.h, AREA, 70)!;
    expect(left.x).toBe(AREA.x0 + LABEL.edge);
  });

  it('flips below the ghost rather than meet the toast stack or goal chip, and hides when neither side fits', () => {
    const w = 120;
    // A lift blocked near the top: above would reach into the toast stack (topClear 160).
    const b = labelBox({ x: 180, y: 150 }, 200, w, LABEL.h, AREA, 160)!;
    expect(b.y).toBe(200 + LABEL.gapBelow);
    expect(labelBox({ x: 180, y: 150 }, 470, w, LABEL.h, AREA, 160)).toBeNull();
  });
});

describe('nudge arrows (BUILD-6)', () => {
  /** A ghost whose near-cell finger point sits 46 px below its centre: the bare 0.9-cell arrow lands on it. */
  const line = (from: Pt, dir: Pt, cell: number) => (reach: number): Pt => ({ x: from.x + dir.x * reach * cell, y: from.y + dir.y * reach * cell });

  it('moves an arrow out of the lifted-point finger zone, along its own direction', () => {
    const fingers = [{ x: 325, y: 378 }];
    // The SE repro: the "toward the Rim" box was 279–323 × 354–398, 2 px from the finger at (325, 378).
    // The arrow's direction runs down-left from the ghost (45° yaw); 0.9 cells out it sits at (301, 376).
    const at = line({ x: 301 + 0.57 * 27, y: 376 - 0.82 * 27 }, { x: -0.57, y: 0.82 }, 30);
    expect(at(0.9).x).toBeCloseTo(301, 6);
    const naive = at(0.9);
    expect(boxDistance(fingers[0], { x0: naive.x - 22, y0: naive.y - 22, x1: naive.x + 22, y1: naive.y + 22 })).toBeLessThan(FINGER_CLEAR);
    const spot = nudgeSpot(at, fingers, [], { ...AREA, y1: 600 })!;
    expect(spot).not.toBeNull();
    const r = NUDGE_BOX / 2;
    expect(boxDistance(fingers[0], { x0: spot.x - r, y0: spot.y - r, x1: spot.x + r, y1: spot.y + r })).toBeGreaterThanOrEqual(FINGER_CLEAR);
    // Still on the arrow's direction line from the ghost.
    expect((spot.x - 301) / -0.57).toBeCloseTo((spot.y - 376) / 0.82, 6);
  });

  it('keeps clear of the label and of other arrows, and gives up at the world-area edge', () => {
    const at = line({ x: 100, y: 300 }, { x: 0, y: -1 }, 40);
    const label = { x0: 60, y0: 230, x1: 160, y1: 252 };
    const spot = nudgeSpot(at, [], [label], AREA)!;
    expect(spot.y + NUDGE_BOX / 2).toBeLessThanOrEqual(label.y0);
    // Toward an edge it never fits.
    expect(nudgeSpot(line({ x: 100, y: 470 }, { x: 0, y: 1 }, 40), [], [], AREA)).toBeNull();
    // Unprojectable points are no spot.
    expect(nudgeSpot(() => ({ x: Number.NaN, y: 0 }), [], [], AREA)).toBeNull();
  });
});

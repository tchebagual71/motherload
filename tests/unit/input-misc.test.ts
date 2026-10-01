import { describe, expect, it } from 'vitest';
import { KeyboardState, type KeyIntent } from '../../src/input/keyboard';
import { canScrollFor, shouldBlockTouchMove, type ScrollMetrics } from '../../src/input/scrollGuard';
import { enterSector, stickAngleDeg, stickSector } from '../../src/input/sectors';
import { bottomInsetOf, controlRects, restHintCentre, stickSpawnZone, type InputLayout } from '../../src/input/zones';
import { TOUCH } from '../../src/shared/canon';

const SE: InputLayout = { width: 375, height: 667, controlZone: TOUCH.controlZone.S, clearTop: 64 };
const I15: InputLayout = { width: 393, height: 852, controlZone: TOUCH.controlZone.M + 34, clearTop: 103 };
const intent = (): KeyIntent => ({ sx: 0, sy: 0, thrust: false });

describe('zones (canon §3.12; 03 §2.1–2.2 wireframes)', () => {
  it('spawn zone: x 24 … min(0.55 W, 300), y 0.45 H … H − bottom inset', () => {
    const se = stickSpawnZone(SE, 'S', false);
    expect(se.x0).toBe(24);
    expect(se.x1).toBeCloseTo(206.25, 6);
    expect(se.y0).toBeCloseTo(300.15, 6);
    expect(se.y1).toBe(667);
    const i15 = stickSpawnZone(I15, 'M', false);
    expect(i15.x1).toBeCloseTo(216.15, 6);
    expect(i15.y0).toBeCloseTo(383.4, 6);
    expect(i15.y1).toBe(818);
    const wide = stickSpawnZone({ ...I15, width: 1024 }, 'M', false);
    expect(wide.x1).toBe(TOUCH.stickZoneMaxPt);
  });

  it('mirrors for left-handed players', () => {
    const z = stickSpawnZone(SE, 'S', true);
    expect(z.x0).toBeCloseTo(375 - 206.25, 6);
    expect(z.x1).toBe(375 - 24);
  });

  it('derives the bottom inset from the control zone', () => {
    expect(bottomInsetOf(I15, 'M')).toBe(34);
    expect(bottomInsetOf(SE, 'S')).toBe(0);
  });

  it('places the 2×2 slot cluster as in the wireframes', () => {
    const se = controlRects(375, 667, 0, 'S', false, false);
    expect(se.slots.map((r) => [r.x0, r.y0, r.x1, r.y1])).toEqual([
      [237, 533, 293, 589],
      [303, 533, 359, 589],
      [237, 599, 293, 655],
      [303, 599, 359, 655],
    ]);
    expect(se.thrust).toBeNull();
    const i15 = controlRects(393, 852, 34, 'M', false, false);
    expect(i15.slots[0]).toEqual({ x0: 245, y0: 674, x1: 305, y1: 734 });
    expect(i15.slots[3]).toEqual({ x0: 317, y0: 746, x1: 377, y1: 806 });
  });

  it('places THRUST left of a 52-pt cluster (03 §2.2)', () => {
    const r = controlRects(393, 852, 34, 'M', true, false);
    expect(r.slots[0]).toEqual({ x0: 261, y0: 690, x1: 313, y1: 742 });
    expect(r.slots[3]).toEqual({ x0: 325, y0: 754, x1: 377, y1: 806 });
    expect(r.thrust).toEqual({ x0: 185, y0: 742, x1: 249, y1: 806 });
  });

  it('mirrors the cluster and THRUST for left-handed players', () => {
    const r = controlRects(393, 852, 34, 'M', true, true);
    expect(r.slots[0].x0).toBe(16);
    expect(r.slots[1].x0).toBe(16 + 52 + 12);
    expect(r.thrust?.x0).toBe(16 + 52 + 12 + 52 + 12);
  });

  it('keeps every control ≥ 44 pt and on screen', () => {
    for (const size of ['S', 'M', 'L'] as const) {
      for (const thrust of [false, true]) {
        const r = controlRects(360, 800, 16, size, thrust, false);
        for (const s of [...r.slots, ...(r.thrust ? [r.thrust] : [])]) {
          expect(s.x1 - s.x0).toBeGreaterThanOrEqual(TOUCH.minHit);
          expect(s.x0).toBeGreaterThanOrEqual(0);
          expect(s.x1).toBeLessThanOrEqual(360);
          expect(s.y1).toBeLessThanOrEqual(800 - 16);
        }
      }
    }
  });

  it('puts the rest hint inside the spawn zone', () => {
    const c = restHintCentre(SE, 'S', false);
    const z = stickSpawnZone(SE, 'S', false);
    expect(c.x).toBeGreaterThan(z.x0);
    expect(c.x).toBeLessThan(z.x1);
    expect(c.y).toBeGreaterThan(z.y0);
    expect(c.y).toBeLessThan(z.y1);
  });
});

describe('sectors (03 §3.2)', () => {
  it('measures angles UP-positive', () => {
    expect(stickAngleDeg(1, 0)).toBe(0);
    expect(stickAngleDeg(0, 1)).toBe(90);
    expect(stickAngleDeg(-1, 0)).toBe(180);
    expect(stickAngleDeg(0, -1)).toBe(270);
  });

  it('enters sectors at 45° boundaries', () => {
    expect(enterSector(44)).toBe('right');
    expect(enterSector(46)).toBe('up');
    expect(enterSector(224)).toBe('left');
    expect(enterSector(226)).toBe('down');
    expect(enterSector(316)).toBe('right');
  });

  it('holds a sector for ±10° past its edge', () => {
    const at = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)] as const;
    const [x50, y50] = at(50);
    expect(stickSector(x50, y50, 'right')).toBe('right'); // inside the 55° leave edge
    expect(stickSector(x50, y50, 'none')).toBe('up');
    const [x57, y57] = at(57);
    expect(stickSector(x57, y57, 'right')).toBe('up');
    const [x220, y220] = at(220);
    expect(stickSector(x220, y220, 'down')).toBe('down');
    expect(stickSector(x220, y220, 'left')).toBe('left');
    expect(stickSector(0, 0, 'down')).toBe('none');
  });
});

describe('KeyboardState (03 §3.7)', () => {
  it('maps arrows and WASD to the stick, W/↑ to full thrust, Space to THRUST', () => {
    const k = new KeyboardState();
    k.keyDown('KeyD', false);
    expect(k.intent(intent())).toEqual({ sx: 1, sy: 0, thrust: false });
    k.keyDown('ArrowUp', false);
    const i = k.intent(intent());
    expect(i.sx).toBeCloseTo(Math.SQRT1_2, 6);
    expect(i.sy).toBeCloseTo(Math.SQRT1_2, 6);
    expect(i.thrust).toBe(true);
    k.keyUp('KeyD');
    k.keyUp('ArrowUp');
    k.keyDown('KeyS', false);
    expect(k.intent(intent())).toEqual({ sx: 0, sy: -1, thrust: false });
    k.keyUp('KeyS');
    k.keyDown('Space', false);
    expect(k.intent(intent())).toEqual({ sx: 0, sy: 0, thrust: true });
    expect(k.active).toBe(true);
  });

  it('keeps a direction while either of its keys is held', () => {
    const k = new KeyboardState();
    k.keyDown('ArrowLeft', false);
    k.keyDown('KeyA', false);
    k.keyDown('KeyA', true); // auto-repeat
    k.keyUp('ArrowLeft');
    expect(k.intent(intent()).sx).toBe(-1);
    k.keyUp('KeyA');
    expect(k.intent(intent()).sx).toBe(0);
    expect(k.active).toBe(false);
  });

  it('emits commands for slots, menu, look and debug, ignoring auto-repeat', () => {
    const k = new KeyboardState();
    expect(k.keyDown('Digit3', false)).toEqual({ kind: 'slotDown', slot: 2 });
    expect(k.keyDown('Digit3', true)).toBeNull();
    expect(k.keyUp('Digit3')).toEqual({ kind: 'slotUp', slot: 2 });
    expect(k.keyDown('Escape', false)).toEqual({ kind: 'escape' });
    expect(k.keyDown('KeyL', false)).toEqual({ kind: 'look' });
    expect(k.keyDown('F3', false)).toEqual({ kind: 'debug' });
    expect(k.keyDown('Backquote', false)).toEqual({ kind: 'debug' });
    expect(k.keyDown('Tab', false)).toEqual({ kind: 'cargo' });
    expect(k.keyDown('KeyZ', false)).toBeNull();
    expect(k.keyDown('toString', false)).toBeNull();
  });

  it('clear() drops held keys (blur)', () => {
    const k = new KeyboardState();
    k.keyDown('KeyW', false);
    k.clear();
    expect(k.active).toBe(false);
    expect(k.intent(intent())).toEqual({ sx: 0, sy: 0, thrust: false });
  });
});

describe('scroll guard (canon §3.12 Input; 03 §1.1)', () => {
  const box = (top: number, height = 1000, client = 400): ScrollMetrics => ({
    scrollTop: top,
    scrollHeight: height,
    clientHeight: client,
    scrollLeft: 0,
    scrollWidth: 300,
    clientWidth: 300,
  });

  it('allows scrolling inside a container that can move that way', () => {
    expect(canScrollFor(box(100), 0, 20)).toBe(true); // finger down → content up
    expect(canScrollFor(box(100), 0, -20)).toBe(true);
  });

  it('blocks at the boundary in the gesture direction', () => {
    expect(canScrollFor(box(0), 0, 20)).toBe(false); // at top, pulling down → rubber band
    expect(canScrollFor(box(0), 0, -20)).toBe(true);
    expect(canScrollFor(box(600), 0, -20)).toBe(false); // at bottom, pushing up
    expect(canScrollFor(box(600), 0, 20)).toBe(true);
  });

  it('blocks containers that cannot scroll and everything outside [data-scroll]', () => {
    expect(canScrollFor(box(0, 300, 400), 0, -20)).toBe(false);
    expect(shouldBlockTouchMove([], 0, 10, 1)).toBe(true);
    expect(shouldBlockTouchMove([box(100)], 0, 10, 1)).toBe(false);
    expect(shouldBlockTouchMove([box(0), box(50)], 0, 10, 1)).toBe(false); // outer scroller takes it
  });

  it('always blocks multi-touch (page pinch-zoom)', () => {
    expect(shouldBlockTouchMove([box(100)], 0, 10, 2)).toBe(true);
  });

  it('uses the dominant axis', () => {
    const tray: ScrollMetrics = { scrollTop: 0, scrollHeight: 60, clientHeight: 60, scrollLeft: 0, scrollWidth: 800, clientWidth: 300 };
    expect(canScrollFor(tray, -30, 5)).toBe(true);
    expect(canScrollFor(tray, 30, 5)).toBe(false);
    expect(canScrollFor(tray, 2, 30)).toBe(false);
  });
});

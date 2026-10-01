import { describe, expect, it } from 'vitest';
import { CanvasArbiter, type PointerSample } from '../../src/input/arbiter';
import { FloatingStick } from '../../src/input/stick';
import { stickSpawnZone, type InputLayout } from '../../src/input/zones';
import { TOUCH } from '../../src/shared/canon';

const CFG = { radius: 52, deadZone: 8, followFactor: 1.25 };
const p = (id: number, x: number, y: number, t: number): PointerSample => ({ id, x, y, t });
// iPhone 15: 393×852, inset bottom 34, size M → zone x 24…216, y 383.4…818.
const L15: InputLayout = { width: 393, height: 852, controlZone: TOUCH.controlZone.M + 34, clearTop: 103 };
const ZONE = stickSpawnZone(L15, 'M', false);

describe('FloatingStick', () => {
  it('outputs zero inside the dead zone', () => {
    const s = new FloatingStick(CFG);
    s.spawn(1, 100, 600);
    s.move(106, 600);
    expect(s.sx).toBe(0);
    expect(s.sy).toBe(0);
    expect(s.magnitude).toBe(0);
  });

  it('rescales past the dead zone: m′ = (m − d)/(1 − d)', () => {
    const s = new FloatingStick(CFG);
    s.spawn(1, 100, 600);
    s.move(130, 600); // m = 30/52
    const d = 8 / 52;
    expect(s.magnitude).toBeCloseTo((30 / 52 - d) / (1 - d), 6);
    expect(s.sx).toBeCloseTo(s.magnitude, 6);
    expect(s.sy).toBeCloseTo(0, 6);
  });

  it('is UP-positive: dragging up the screen gives sy > 0', () => {
    const s = new FloatingStick(CFG);
    s.spawn(1, 100, 600);
    s.move(100, 540);
    expect(s.sy).toBeCloseTo(1, 6);
    expect(s.sx).toBeCloseTo(0, 6);
  });

  it('clamps the knob to the radius and saturates at 1', () => {
    const s = new FloatingStick(CFG);
    s.spawn(1, 100, 600);
    s.move(160, 600); // 60 pt: past R, inside 1.25 R
    expect(s.knobX).toBeCloseTo(152, 6);
    expect(s.baseX).toBe(100);
    expect(s.magnitude).toBe(1);
  });

  it('drags the base along once the thumb passes 1.25 R', () => {
    const s = new FloatingStick(CFG);
    s.spawn(1, 100, 600);
    s.move(200, 600); // 100 pt > 65
    expect(s.baseX).toBeCloseTo(200 - 65, 6);
    expect(s.knobX).toBeCloseTo(s.baseX + 52, 6);
    expect(s.sx).toBe(1);
    // Coming back towards the new base moves the output immediately.
    s.move(s.baseX - 30, 600);
    expect(s.sx).toBeLessThan(0);
  });

  it('release zeroes the output', () => {
    const s = new FloatingStick(CFG);
    s.spawn(1, 100, 600);
    s.move(100, 500);
    s.release();
    expect(s.active).toBe(false);
    expect(s.sx).toBe(0);
    expect(s.sy).toBe(0);
  });
});

describe('CanvasArbiter', () => {
  it('spawns the stick only inside the spawn zone', () => {
    const a = new CanvasArbiter(CFG);
    expect(a.down(p(1, 300, 700, 0), ZONE)).toBe('tap'); // right of the zone
    expect(a.stick.active).toBe(false);
    a.up(p(1, 300, 700, 500));
    expect(a.down(p(2, 100, 300, 1000), ZONE)).toBe('tap'); // above 0.45 H
    a.up(p(2, 100, 300, 1500));
    expect(a.down(p(3, 10, 700, 2000), ZONE)).toBe('tap'); // inside the 24-pt back-swipe margin
    a.up(p(3, 10, 700, 2500));
    expect(a.down(p(4, 100, 700, 3000), ZONE)).toBe('stick');
    expect(a.stick.active).toBe(true);
  });

  it('drives the stick from its own pointer only', () => {
    const a = new CanvasArbiter(CFG);
    a.down(p(1, 100, 700, 0), ZONE);
    a.move(p(1, 100, 640, 16));
    expect(a.stick.sy).toBeCloseTo(1, 6);
    // A second finger in the zone does not steal the stick.
    expect(a.down(p(2, 150, 720, 50), ZONE)).toBe('ignored');
    a.move(p(2, 200, 720, 66));
    expect(a.stick.pointerId).toBe(1);
    expect(a.stick.sy).toBeCloseTo(1, 6);
    expect(a.up(p(2, 200, 720, 80))).toBeNull(); // ignored pointers never tap
    expect(a.stick.active).toBe(true);
  });

  it('reports a world tap (< 200 ms, < 10 pt) anywhere and discards its stick', () => {
    const a = new CanvasArbiter(CFG);
    a.down(p(1, 100, 700, 0), ZONE);
    a.move(p(1, 104, 702, 60));
    expect(a.stick.magnitude).toBe(0); // within the dead zone: under every gate
    const tap = a.up(p(1, 104, 702, 150));
    expect(tap).toEqual({ x: 100, y: 700 });
    expect(a.stick.active).toBe(false);

    a.down(p(2, 300, 200, 1000), ZONE);
    expect(a.up(p(2, 302, 201, 1100))).toEqual({ x: 300, y: 200 });
  });

  it('rejects slow or moved taps', () => {
    const a = new CanvasArbiter(CFG);
    a.down(p(1, 300, 200, 0), ZONE);
    expect(a.up(p(1, 300, 200, 250))).toBeNull(); // too slow
    a.down(p(2, 300, 200, 1000), ZONE);
    a.move(p(2, 315, 200, 1050)); // moved 15 pt, then back
    expect(a.up(p(2, 300, 200, 1100))).toBeNull();
  });

  it('pointercancel releases the stick and says so', () => {
    const a = new CanvasArbiter(CFG);
    a.down(p(1, 100, 700, 0), ZONE);
    a.move(p(1, 160, 700, 16));
    expect(a.cancel(1)).toBe(true);
    expect(a.stick.active).toBe(false);
    expect(a.stick.sx).toBe(0);
    expect(a.cancel(1)).toBe(false);
    a.down(p(2, 300, 200, 100), ZONE);
    expect(a.cancel(2)).toBe(false);
    expect(a.pointerCount).toBe(0);
  });

  it('a non-stick first finger does not block a stick spawn', () => {
    const a = new CanvasArbiter(CFG);
    a.down(p(1, 300, 200, 0), ZONE);
    expect(a.down(p(2, 100, 700, 300), ZONE)).toBe('stick');
    expect(a.pointerCount).toBe(2);
    a.releaseAll();
    expect(a.pointerCount).toBe(0);
    expect(a.stick.active).toBe(false);
  });
});

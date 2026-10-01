import { describe, expect, it } from 'vitest';
import { CAMERA } from '../../src/shared/canon';
import type { ViewportLayout } from '../../src/render/api';
import {
  CameraRig,
  ClimbDetector,
  anchorFraction,
  anchorScreenY,
  blendT,
  cameraBasis,
  clampSlabCentre,
  pixelScaleK,
  pixelTargetSize,
  snapPixelPpu,
  snapToTexels,
  springStep,
  undergroundPpu,
  type TexelSnap,
} from '../../src/render/camera';

const IPHONE15: ViewportLayout = { width: 393, height: 852, dpr: 3, clearTop: 59 + 44, controlZone: 166 + 34 };
const SE: ViewportLayout = { width: 375, height: 667, dpr: 2, clearTop: 20 + 44, controlZone: 150 };

describe('render camera math', () => {
  it('blends surface → underground over 4 rows', () => {
    expect(blendT(0.4)).toBe(0);
    expect(blendT(-2)).toBeCloseTo(0.5);
    expect(blendT(-4)).toBe(1);
    expect(blendT(-100)).toBe(1);
  });

  it('picks the underground ppu per viewport (41; 38 under 700 pt; Safari floor 32)', () => {
    expect(undergroundPpu(IPHONE15)).toBe(41);
    expect(undergroundPpu(SE)).toBe(38);
    expect(undergroundPpu({ height: 548, clearTop: 64 })).toBe(32);
  });

  it('computes anchors in the clear rect', () => {
    expect(anchorFraction(0, 0.4, 0)).toBeCloseTo(CAMERA.anchors.rim);
    expect(anchorFraction(0, 10, 0)).toBeCloseTo(CAMERA.anchors.sky);
    expect(anchorFraction(1, -50, 0)).toBeCloseTo(CAMERA.anchors.grounded);
    expect(anchorFraction(1, -50, 1)).toBeCloseTo(CAMERA.anchors.climbing);
    expect(anchorScreenY(IPHONE15, 0)).toBe(103);
    expect(anchorScreenY(IPHONE15, 1)).toBe(852);
  });

  it('enters climbing after 0.3 s above 1 tile/s and leaves after 0.3 s below 0.3', () => {
    const c = new ClimbDetector();
    const dt = 1 / 60;
    for (let i = 0; i < 17; i++) c.update(2, dt, false);
    expect(c.climbing).toBe(false);
    for (let i = 0; i < 2; i++) c.update(2, dt, false);
    expect(c.climbing).toBe(true);
    // Blend reaches 1 after 0.6 s.
    for (let i = 0; i < 40; i++) c.update(2, dt, false);
    expect(c.blend).toBe(1);
    // A brief dip does not leave.
    for (let i = 0; i < 10; i++) c.update(0, dt, false);
    c.update(2, dt, false);
    expect(c.climbing).toBe(true);
    // A touch freezes the switch.
    for (let i = 0; i < 60; i++) c.update(0, dt, true);
    expect(c.climbing).toBe(true);
    c.update(0, dt, false);
    expect(c.climbing).toBe(false);
  });

  it('springs without steady-state lag when fed the target velocity', () => {
    const s = { x: 0, v: 0 };
    let target = 0;
    const v = 10;
    for (let i = 0; i < 240; i++) {
      target += v / 60;
      springStep(s, target, v, 8, 1 / 60);
    }
    expect(Math.abs(s.x - target)).toBeLessThan(0.05);
  });

  it('is stable for large dt', () => {
    const s = { x: 100, v: 0 };
    springStep(s, 0, 0, 8, 5);
    expect(Math.abs(s.x)).toBeLessThan(1);
  });

  it('builds an orthonormal basis', () => {
    const d = { x: 0, y: 0, z: 0 }, r = { x: 0, y: 0, z: 0 }, u = { x: 0, y: 0, z: 0 };
    cameraBasis(20, 20, d, r, u);
    const dot = (a: typeof d, b: typeof d): number => a.x * b.x + a.y * b.y + a.z * b.z;
    expect(dot(d, r)).toBeCloseTo(0);
    expect(dot(d, u)).toBeCloseTo(0);
    expect(dot(r, u)).toBeCloseTo(0);
    expect(dot(u, u)).toBeCloseTo(1);
    expect(u.y).toBeGreaterThan(0.9);
  });

  it('clamps the slab view to ≤ 1 tile beyond the mine', () => {
    expect(clampSlabCentre(0, 5)).toBe(4);
    expect(clampSlabCentre(48, 5)).toBe(44);
    expect(clampSlabCentre(20, 5)).toBe(20);
    expect(clampSlabCentre(3, 30)).toBe(24);
  });

  it('places the pod on its anchor row', () => {
    const rig = new CameraRig();
    const input = { podX: 20, podY: -40.5, vx: 0, vy: 0, layout: IPHONE15, mode: 'play' as const, touching: false };
    for (let i = 0; i < 120; i++) rig.update(input, 1 / 60);
    const p = rig.pose;
    expect(p.t).toBe(1);
    expect(p.ppu).toBe(41);
    // Project the pod onto the screen: offset along camera up from lookAt.
    const dx = 20 - p.lookAt.x, dy = -40.5 - p.lookAt.y, dz = 0 - p.lookAt.z;
    const upOff = dx * p.up.x + dy * p.up.y + dz * p.up.z;
    const screenY = IPHONE15.height / 2 - upOff * p.ppu;
    expect(screenY).toBeCloseTo(anchorScreenY(IPHONE15, CAMERA.anchors.grounded), 1);
  });

  it('sizes Pixel Lab per 04 §5.7 (SE k=2, iPhone 15 k=4)', () => {
    expect(pixelScaleK(SE)).toBe(2);
    expect(pixelScaleK(IPHONE15)).toBe(4);
    expect(pixelTargetSize(393 * 3, 852 * 3, 4)).toEqual({ w: 297, h: 641 });
    const cos20 = Math.cos((20 * Math.PI) / 180);
    expect(snapPixelPpu(38, 2, 2, cos20)).toBeCloseTo(38.31, 2);
    expect(snapPixelPpu(41, 3, 4, cos20)).toBeCloseTo((29 * 4) / (3 * cos20), 6);
  });

  it('snaps to texels and keeps the blit offset within the margin', () => {
    const out: TexelSnap = { dRight: 0, dUp: 0, offX: 0, offY: 0 };
    const rt = pixelTargetSize(1179, 2556, 4);
    for (const lr of [0, 0.013, 0.02, 0.031, 12.77]) {
      snapToTexels(lr, -lr, 1 / 29, 4, rt, { w: 1179, h: 2556 }, out);
      expect(Math.abs(out.dRight)).toBeLessThanOrEqual(0.5 / 29 + 1e-9);
      expect(out.offX).toBeGreaterThanOrEqual(-2);
      expect(out.offX).toBeLessThanOrEqual(4);
      expect(Number.isInteger(out.offY)).toBe(true);
    }
  });
});

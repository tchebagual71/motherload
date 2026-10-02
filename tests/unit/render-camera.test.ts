import { describe, expect, it } from 'vitest';
import { CAMERA, MINE_W, STEP_HZ } from '../../src/shared/canon';
import type { ViewportLayout } from '../../src/render/api';
import {
  CameraRig,
  ClimbDetector,
  DESCEND_LEAD,
  DigDescentTracker,
  FollowAxis,
  anchorFraction,
  anchorScreenY,
  bayerPhase,
  blendT,
  cameraBasis,
  clampSlabCentre,
  composeLookAt,
  pixelScaleK,
  pixelTargetSize,
  slabCentreX,
  snapPixelPpu,
  snapToTexels,
  springStep,
  undergroundPpu,
  type CameraPose,
  type TexelSnap,
} from '../../src/render/camera';
import { stepPod } from '../../src/pod';
import { DOWN, carve, makeCtx, podAt, solidGrid } from './pod.helpers';

const IPHONE15: ViewportLayout = { width: 393, height: 852, dpr: 3, clearTop: 59 + 44, controlZone: 166 + 34 };
const SE: ViewportLayout = { width: 375, height: 667, dpr: 2, clearTop: 20 + 44, controlZone: 150 };
const SAFARI_15: ViewportLayout = { width: 393, height: 659, dpr: 3, clearTop: 59 + 44, controlZone: 166 };

/** Screen y (pt from the top) of a world point under a pose (orthographic: offset along camera up). */
function screenY(p: CameraPose, layout: ViewportLayout, x: number, y: number, z = 0): number {
  const up = (x - p.lookAt.x) * p.up.x + (y - p.lookAt.y) * p.up.y + (z - p.lookAt.z) * p.up.z;
  return layout.height / 2 - up * p.ppu;
}

/** Tiles the pod sits below its anchor row (negative = above). */
function belowAnchor(rig: CameraRig, layout: ViewportLayout, podX: number, podY: number): number {
  const p = rig.pose;
  return (screenY(p, layout, podX, podY) - anchorScreenY(layout, p.anchor)) / (p.ppu * p.up.y);
}

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

  it('keeps a falling pod at or above its anchor (canon §3.4 visibility rule, descending)', () => {
    const rig = new CameraRig();
    const dt = 1 / 60;
    let y = -40.5;
    let vy = 0;
    const base = { podX: 20, vx: 0, layout: SE, mode: 'play' as const, touching: false };
    for (let i = 0; i < 60; i++) rig.update({ ...base, podY: y, vy: 0 }, dt);
    let worst = -Infinity;
    for (let i = 0; i < 150; i++) {
      vy = Math.max(-13.5, (vy - 11.537 * dt) * 0.985958);
      y += vy * dt;
      rig.update({ ...base, podY: y, vy }, dt);
      // The symmetric ±1 dead zone left the pod a whole tile below the anchor here.
      if (i > 30) worst = Math.max(worst, belowAnchor(rig, SE, 20, y));
    }
    expect(worst).toBeLessThanOrEqual(0);
    // Near terminal speed the focus leads the pod by (almost) the full lead.
    expect(belowAnchor(rig, SE, 20, y)).toBeCloseTo(-DESCEND_LEAD, 1);
    // Landed: within the hold the window stays one-sided, then the pod rests where it stopped.
    for (let i = 0; i < 120; i++) rig.update({ ...base, podY: y, vy: 0 }, dt);
    expect(belowAnchor(rig, SE, 20, y)).toBeLessThanOrEqual(0);
    expect(belowAnchor(rig, SE, 20, y)).toBeGreaterThan(-DESCEND_LEAD - 0.01);
  });

  it('frames a down-dig chain by its steady path: the pod never sinks below its anchor (t1–t3 drills)', () => {
    for (const tier of [1, 2, 3]) {
      const grid = solidGrid();
      carve(grid, 20, 59, 20, 60);
      const pod = podAt(20, 60, (p) => (p.tiers.drill = tier));
      const ctx = makeCtx();
      const rig = new CameraRig();
      const tracker = new DigDescentTracker();
      const alpha = 0.5;
      let lo = Infinity, hi = -Infinity, digs = 0;
      for (let i = 0; i < 900; i++) {
        ctx.stepNo++;
        stepPod(pod, grid, DOWN, ctx, []);
        if (pod.dig && pod.dig.progress === 1) digs++;
        const py = pod.prevY + (pod.y - pod.prevY) * alpha;
        const digDown = tracker.update(pod.dig, pod.y, pod.digging, alpha);
        rig.update({ podX: pod.x, podY: py, vx: pod.vx, vy: pod.vy, digDown, layout: SE, mode: 'play', touching: false }, 1 / STEP_HZ);
        if (i < 60) continue;
        const d = belowAnchor(rig, SE, pod.x, py);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      expect(digs, `t${tier}`).toBeGreaterThan(20);
      // Following the pod with the ±1 dead zone left it ≈ 1 tile below; the steady path keeps it near the anchor.
      expect(hi, `t${tier}`).toBeLessThan(0.15);
      expect(lo, `t${tier}`).toBeGreaterThan(-0.45);
    }
  });

  it('carries a dig chain path across the step that finishes a dig', () => {
    const tracker = new DigDescentTracker();
    const toY = -(61 + 1) + 0.39;
    const dig = { dir: 'down' as const, r: 61, progress: 29, total: 29, fromY: toY + 1 };
    const a = tracker.update(dig, toY + 0.001, true, 0.5);
    expect(a?.vy).toBeCloseTo(-STEP_HZ / 29, 6);
    // Finishing step: no DigState, the pod rests exactly on the path's end, `digging` still set.
    const b = tracker.update(null, toY, true, 0.5);
    expect(b).not.toBeNull();
    expect(b?.y).toBeCloseTo(toY + 0.5 / 29, 6);
    // The next step without a dig ends the descent.
    expect(tracker.update(null, toY, false, 0.5)).toBeNull();
    // Side digs are not descents.
    expect(tracker.update({ ...dig, dir: 'left' }, toY, true, 0.5)).toBeNull();
  });

  it('drags the follow window by asymmetric bounds', () => {
    const f = new FollowAxis();
    f.snap(0);
    f.update(-0.5, -1, 1, 1, 8, 1 / 60);
    expect(f.goal).toBe(0); // inside the ±1 window
    f.update(-0.5, -1, 0, 1, 8, 1 / 60);
    expect(f.goal).toBe(-0.5); // one-sided below: the pod may not drop under the goal
    f.update(0.4, 1, 0, 1, 8, 1 / 60);
    expect(f.goal).toBe(-0.5);
    f.update(0.75, 1, 0, 1, 8, 1 / 60);
    expect(f.goal).toBe(-0.25);
  });

  it('applies the slab clamp without moving the focus off its anchor row', () => {
    const pose = (t: number, ppu: number): CameraPose => ({
      yaw: 20, pitch: 20, ppu, t, anchor: CAMERA.anchors.grounded,
      lookAt: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 }, right: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 0 },
    });
    for (const layout of [SAFARI_15, SE, IPHONE15]) {
      const ppu = undergroundPpu(layout);
      const halfWidth = layout.width / 2 / ppu / Math.cos((20 * Math.PI) / 180);
      for (const fx of [0.5, 3, 24, 45, MINE_W - 0.5]) {
        const free = pose(0, ppu);
        composeLookAt(free, fx, -60.5, layout);
        const p = pose(1, ppu);
        composeLookAt(p, fx, -60.5, layout);
        // Shifting lookAt along world x moved the pod up to ±18 pt off its anchor near the walls.
        expect(screenY(p, layout, fx, -60.5)).toBeCloseTo(anchorScreenY(layout, p.anchor), 6);
        expect(slabCentreX(p.lookAt, 20)).toBeCloseTo(clampSlabCentre(slabCentreX(free.lookAt, 20), halfWidth), 9);
      }
    }
  });

  it('wraps Bayer phases into 0..3 for any texel offset', () => {
    expect([0, 1, 2, 3, 4, 5, -1, -2, -3, -4, -5, 7.4, -0.2].map(bayerPhase)).toEqual([0, 1, 2, 3, 0, 1, 3, 2, 1, 0, 3, 3, 0]);
  });

  it('pins the Pixel Lab dither to its frame while the snapped camera moves by whole texels', () => {
    // Shader mirror (glsl.ts hfDither / glows / sky): floor(v·n + bayer(gl_FragCoord + phase)) / n.
    const M = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const bayer = (x: number, y: number): number => (M[(((x % 4) + 4) % 4) + (((y % 4) + 4) % 4) * 4] + 0.5) / 16;
    const k = 4, texel = 1 / 29, W = 72, H = 72;
    const rt = { w: W, h: H };
    const device = { w: (W - 2) * k, h: (H - 2) * k };
    const snap: TexelSnap = { dRight: 0, dUp: 0, offX: 0, offY: 0 };
    /** Dithered falloff around (cr, cu) (screen-plane coords), as the RT sees it from a view centred at (lr, lu). */
    const render = (lr: number, lu: number, cr: number, cu: number, podFrame: boolean, phased: boolean): number[] => {
      snapToTexels(lr, lu, texel, k, rt, device, snap);
      const sr = (lr + snap.dRight) / texel, su = (lu + snap.dUp) / texel;
      // renderer.updateDither: world frame = the snapped centre; pod frame = centre minus the pod.
      const px = !phased ? 0 : podFrame ? bayerPhase(sr - cr / texel) : bayerPhase(sr);
      const py = !phased ? 0 : podFrame ? bayerPhase(su - cu / texel) : bayerPhase(su);
      const img: number[] = [];
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const u = (sr + i + 0.5 - W / 2) * texel, v = (su + j + 0.5 - H / 2) * texel;
          const d = Math.hypot(u - cr, v - cu);
          const g = 1 - Math.min(1, Math.max(0, (d - 0.3) / 0.9));
          img.push(Math.floor(g * 4 + bayer(i + px, j + py)) / 4);
        }
      }
      return img;
    };
    /** Texels that differ between two frames once the content's move by (mx, my) texels is compensated. */
    const mismatch = (a: number[], b: number[], mx: number, my: number): number => {
      let n = 0;
      for (let j = 4; j < H - 4; j++) for (let i = 4; i < W - 4; i++) if (a[j * W + i] !== b[(j + my) * W + (i + mx)]) n++;
      return n;
    };
    const lr0 = 12.31, lu0 = -40.07;
    for (const phased of [true, false]) {
      let world = 0, pod = 0;
      for (const [nx, ny] of [[1, 0], [0, 1], [-1, 0], [0, -1], [2, 1], [-3, 2]]) {
        // Camera moves (nx, ny) texels: a world-fixed lamp's image moves (−nx, −ny).
        const a = render(lr0, lu0, lr0 + 0.2, lu0 - 0.1, false, phased);
        const b = render(lr0 + nx * texel, lu0 + ny * texel, lr0 + 0.2, lu0 - 0.1, false, phased);
        world += mismatch(a, b, -nx, -ny);
        // The pod moves (nx, ny) texels under a still camera: its bubble's image moves with it.
        const c = render(lr0, lu0, lr0 + 0.2, lu0 - 0.1, true, phased);
        const e = render(lr0, lu0, lr0 + 0.2 + nx * texel, lu0 - 0.1 + ny * texel, true, phased);
        pod += mismatch(c, e, nx, ny);
      }
      if (phased) {
        expect(world).toBe(0);
        expect(pod).toBe(0);
      } else {
        // gl_FragCoord-keyed (the old shaders): the falloff rings re-dither on every step.
        expect(world).toBeGreaterThan(50);
        expect(pod).toBeGreaterThan(50);
      }
    }
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

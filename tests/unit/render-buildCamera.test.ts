import { OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA, MINE_H } from '../../src/shared/canon';
import type { BuildCamera, ViewportLayout } from '../../src/render/api';
import type { ViewRect } from '../../src/factory/api';
import { cameraBasis, type CameraPose } from '../../src/render/camera';
import {
  BUILD_ENTER_S,
  BUILD_PLANE_S,
  BUILD_YAW_S,
  BuildCameraRig,
  MINE_PLANE_Z,
  angleDelta,
  blendPose,
  buildPose,
  buildPpu,
  buildYawDeg,
  cellCentreWorld,
  copyPose,
  mineCellOf,
  newPose,
  planeViewRect,
  projectToScreen,
  rayBox,
  screenRay,
  screenToMinePoint,
  screenToYardPoint,
  snapBuildPpu,
  yardCellOf,
} from '../../src/render/factory/projection';

const SE: ViewportLayout = { width: 375, height: 667, dpr: 2, clearTop: 64, controlZone: 150 };
const I15: ViewportLayout = { width: 393, height: 852, dpr: 3, clearTop: 103, controlZone: 200 };
const yard = (cx: number, cy: number, yaw: 0 | 1 | 2 | 3 = 0, ppu = 39): BuildCamera => ({ plane: 'yard', cx, cy, ppu, yaw });
const mine = (cx: number, cy: number, ppu = 47): BuildCamera => ({ plane: 'mine', cx, cy, ppu, yaw: 0 });

/** The renderer's orthographic camera for a pose (renderer.ts placeCameras). */
function threeCamera(pose: CameraPose, layout: ViewportLayout): OrthographicCamera {
  const hw = layout.width / 2 / pose.ppu;
  const hh = layout.height / 2 / pose.ppu;
  const cam = new OrthographicCamera(-hw, hw, hh, -hh, 1, 420);
  const l = pose.lookAt, d = pose.dir;
  cam.position.set(l.x + d.x * 120, l.y + d.y * 120, l.z + d.z * 120);
  cam.lookAt(l.x, l.y, l.z);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

function threeProject(cam: OrthographicCamera, layout: ViewportLayout, x: number, y: number, z: number): { x: number; y: number } {
  const v = new Vector3(x, y, z).project(cam);
  return { x: ((v.x + 1) / 2) * layout.width, y: ((1 - v.y) / 2) * layout.height };
}

describe('build cameras (canon §3.4)', () => {
  it('uses the canon angles and ppu floors per plane', () => {
    for (const n of [0, 1, 2, 3] as const) expect(buildYawDeg(yard(0, 0, n))).toBe(45 + 90 * n);
    expect(buildYawDeg(mine(0, 0))).toBe(CAMERA.undergroundBuild.yaw);
    const y = buildPose(yard(20, 4), newPose());
    expect([y.yaw, y.pitch, y.ppu]).toEqual([45, 55, 39]);
    const m = buildPose(mine(20, 40), newPose());
    expect([m.yaw, m.pitch, m.ppu]).toEqual([8, 12, 47]);
    expect(buildPpu(yard(0, 0, 0, 20))).toBe(CAMERA.surfaceBuild.zoomMin);
    expect(buildPpu(yard(0, 0, 0, 999))).toBe(CAMERA.surfaceBuild.zoomMax);
    expect(buildPpu(mine(0, 0, 30))).toBe(47);
    expect(buildPpu({ plane: 'mine', ppu: Number.NaN })).toBe(47);
    expect(buildPpu(yard(0, 0, 0, 44))).toBe(44);
  });

  it('puts (cx, cy) on the viewport centre on its pick plane', () => {
    for (const layout of [SE, I15]) {
      const pt = { x: 0, y: 0 };
      for (const n of [0, 1, 2, 3] as const) {
        const p = buildPose(yard(17.25, 6.5, n), newPose());
        expect(screenToYardPoint(p, layout, layout.width / 2, layout.height / 2, pt)).toBe(true);
        expect(pt.x).toBeCloseTo(17.25, 9);
        expect(pt.y).toBeCloseTo(6.5, 9);
      }
      const p = buildPose(mine(30.5, 44), newPose());
      expect(screenToMinePoint(p, layout, layout.width / 2, layout.height / 2, pt)).toBe(true);
      expect(pt.x).toBeCloseTo(30.5, 9);
      expect(pt.y).toBeCloseTo(44, 9);
    }
  });

  it('projects exactly like the renderer’s three.js orthographic camera', () => {
    const cams: [BuildCamera, ViewportLayout][] = [
      [yard(24, 5, 0), SE],
      [yard(10, 12, 1, 44), I15],
      [yard(40, 20, 2, 60), SE],
      [yard(3, 30, 3), I15],
      [mine(26, 45), SE],
      [mine(8, 300, 55), I15],
    ];
    const out = { x: 0, y: 0 };
    for (const [cam, layout] of cams) {
      const pose = buildPose(cam, newPose());
      const three = threeCamera(pose, layout);
      for (const [x, y, z] of [
        [cam.cx, 0, -cam.cy],
        [cam.cx + 3.2, 1.6, -cam.cy - 2.1],
        [cam.cx - 2, -cam.cy, MINE_PLANE_Z],
        [cam.cx + 1, -cam.cy - 3, -1],
      ]) {
        const a = projectToScreen(pose, layout, x, y, z, out);
        const b = threeProject(three, layout, x, y, z);
        expect(a.x).toBeCloseTo(b.x, 6);
        expect(a.y).toBeCloseTo(b.y, 6);
      }
    }
  });

  it('round-trips every visible Yard cell centre through screen space (all four yaws, SE and 15)', () => {
    const pt = { x: 0, y: 0 };
    const px = { x: 0, y: 0 };
    const w = { x: 0, y: 0, z: 0 };
    for (const layout of [SE, I15]) {
      for (const n of [0, 1, 2, 3] as const) {
        const pose = buildPose(yard(24, 8, n), newPose());
        let checked = 0;
        for (let row = 1; row <= 16; row++) {
          for (let x = 14; x < 34; x++) {
            const c = cellCentreWorld('yard', x, row, w);
            projectToScreen(pose, layout, c.x, c.y, c.z, px);
            if (px.x < 0 || px.x > layout.width || px.y < 0 || px.y > layout.height) continue;
            expect(screenToYardPoint(pose, layout, px.x, px.y, pt)).toBe(true);
            expect(yardCellOf(pt)).toEqual({ x, y: row });
            checked++;
          }
        }
        expect(checked).toBeGreaterThan(40);
      }
    }
  });

  it('round-trips mine cell centres on the slab front, and picks the right cell near its edges', () => {
    const pose = buildPose(mine(26, 45), newPose());
    const pt = { x: 0, y: 0 };
    const px = { x: 0, y: 0 };
    const w = { x: 0, y: 0, z: 0 };
    for (let r = 41; r <= 49; r++) {
      for (let x = 23; x <= 29; x++) {
        const c = cellCentreWorld('mine', x, r, w);
        expect(c.z).toBe(MINE_PLANE_Z);
        projectToScreen(pose, I15, c.x, c.y, c.z, px);
        screenToMinePoint(pose, I15, px.x, px.y, pt);
        expect(mineCellOf(pt)).toEqual({ x, y: r });
        // 0.45 of a cell toward each corner still lands in the same cell.
        projectToScreen(pose, I15, c.x + 0.45, c.y - 0.45, c.z, px);
        screenToMinePoint(pose, I15, px.x, px.y, pt);
        expect(mineCellOf(pt)).toEqual({ x, y: r });
      }
    }
  });

  it('keeps cells inside the planes (Yard rows 1–32, the Rim strip excluded; mine rows 0–607)', () => {
    expect(yardCellOf({ x: 5.5, y: 0.5 })).toBeNull();
    expect(yardCellOf({ x: 5.5, y: 1.01 })).toEqual({ x: 5, y: 1 });
    expect(yardCellOf({ x: 47.99, y: 32.99 })).toEqual({ x: 47, y: 32 });
    expect(yardCellOf({ x: 48, y: 5 })).toBeNull();
    expect(yardCellOf({ x: -0.01, y: 5 })).toBeNull();
    expect(yardCellOf({ x: 3, y: 33 })).toBeNull();
    expect(mineCellOf({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(mineCellOf({ x: 1, y: -0.1 })).toBeNull();
    expect(mineCellOf({ x: 1, y: MINE_H })).toBeNull();
  });

  it('snaps Pixel Lab build zoom UP to whole RT px per tile face (03 §9.3)', () => {
    // SE (DPR 2, k 2): surface build 39, Mine build 46 px.
    expect(snapBuildPpu(39, 'yard', 2, 2)).toBeCloseTo(39, 9);
    expect(snapBuildPpu(44, 'yard', 2, 2)).toBeCloseTo(44, 9);
    const seMine = snapBuildPpu(47, 'mine', 2, 2);
    expect(seMine * Math.cos(12 * Math.PI / 180)).toBeCloseTo(46, 9);
    // iPhone 15 (DPR 3, k 4): surface build 30 px → 40.0 ppu, 33 px with a 1×1 tool; Mine 35 px → 47.7 ppu.
    expect(snapBuildPpu(39, 'yard', 3, 4)).toBeCloseTo(40, 9);
    expect(snapBuildPpu(44, 'yard', 3, 4)).toBeCloseTo(44, 9);
    expect(snapBuildPpu(47, 'mine', 3, 4)).toBeCloseTo(47.71, 2);
    for (const p of [39, 41.3, 47, 52.9, 60]) for (const plane of ['yard', 'mine'] as const) expect(snapBuildPpu(p, plane, 3, 4)).toBeGreaterThanOrEqual(p - 1e-9);
  });
});

describe('view rects and picking rays', () => {
  it('covers every cell whose centre is on screen, with the margin, and nothing far away', () => {
    for (const [cam, layout] of [
      [yard(24, 8, 0), SE],
      [yard(24, 8, 2), I15],
      [mine(26, 45), I15],
    ] as const) {
      const pose = buildPose(cam, newPose());
      const rect: ViewRect = { plane: 'yard', x0: 0, y0: 0, x1: 0, y1: 0 };
      expect(planeViewRect(pose, layout, cam.plane, 0, rect)).toBe(true);
      expect(rect.plane).toBe(cam.plane);
      const w = { x: 0, y: 0, z: 0 };
      const px = { x: 0, y: 0 };
      const rows = cam.plane === 'yard' ? 33 : MINE_H;
      for (let y = 0; y < Math.min(rows, 80); y++) {
        for (let x = 0; x < 48; x++) {
          const c = cellCentreWorld(cam.plane, x, cam.plane === 'mine' ? y + 20 : y, w);
          projectToScreen(pose, layout, c.x, c.y, c.z, px);
          const onScreen = px.x >= 0 && px.x <= layout.width && px.y >= 0 && px.y <= layout.height;
          const cy = cam.plane === 'mine' ? y + 20 : y;
          if (onScreen) expect(x >= rect.x0 && x <= rect.x1 && cy >= rect.y0 && cy <= rect.y1, `${cam.plane} ${x},${cy}`).toBe(true);
        }
      }
      const grown: ViewRect = { ...rect };
      planeViewRect(pose, layout, cam.plane, 2, grown);
      expect(grown.x0).toBe(Math.max(0, rect.x0 - 2));
      expect(grown.y1).toBe(Math.min(rows - 1, rect.y1 + 2));
      // An underground view never claims Yard cells (and vice versa for the deep slab).
      expect(rect.x1 - rect.x0).toBeLessThan(cam.plane === 'yard' ? 30 : 14);
    }
    const deep = buildPose(mine(26, 300), newPose());
    expect(planeViewRect(deep, I15, 'yard', 2, { plane: 'yard', x0: 0, y0: 0, x1: 0, y1: 0 })).toBe(false);
  });

  it('casts rays that enter boxes along the view direction', () => {
    const pose = buildPose(yard(10, 5), newPose());
    const o = { x: 0, y: 0, z: 0 };
    const d = { x: 0, y: 0, z: 0 };
    screenRay(pose, SE, SE.width / 2, SE.height / 2, o, d);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
    // A 2×2 building centred under the screen centre is hit; one 6 tiles away is not.
    expect(rayBox(o, d, 9, 0, -6, 11, 1.5, -4)).toBeLessThan(Infinity);
    expect(rayBox(o, d, 15, 0, -6, 17, 1.5, -4)).toBe(Infinity);
    // The nearer of two stacked boxes is entered first.
    const near = rayBox(o, d, 9, 1, -6, 11, 2, -4);
    const far = rayBox(o, d, 9, 0, -6, 11, 1, -4);
    expect(near).toBeLessThan(far);
    expect(rayBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 1, 1, -1, 2, 2, 1)).toBe(Infinity);
  });
});

describe('build camera tweens (03 §4.1, §5)', () => {
  function playPose(): CameraPose {
    const p = newPose();
    p.yaw = 45;
    p.pitch = 35;
    p.ppu = 36;
    p.lookAt.x = 20;
    p.lookAt.y = 1;
    p.lookAt.z = -2;
    cameraBasis(p.yaw, p.pitch, p.dir, p.right, p.up);
    return p;
  }

  function run(rig: BuildCameraRig, seconds: number, play: CameraPose): CameraPose {
    const steps = Math.round(seconds * 60);
    let p = rig.pose;
    for (let i = 0; i < steps; i++) p = rig.update(1 / 60, play);
    return p;
  }

  it('enters in 0.35 s from the shown pose and settles on the build pose', () => {
    const rig = new BuildCameraRig();
    const play = playPose();
    expect(rig.active).toBe(false);
    rig.set(yard(24, 5), play);
    expect(rig.active).toBe(true);
    expect(rig.settled).toBe(false);
    const first = rig.update(0, play);
    expect(first.yaw).toBeCloseTo(45, 9);
    expect(first.pitch).toBeCloseTo(35, 9);
    run(rig, BUILD_ENTER_S - 0.05, play);
    expect(rig.settled).toBe(false);
    const end = run(rig, 0.06, play);
    expect(rig.settled).toBe(true);
    expect(end.pitch).toBe(55);
    expect(end.ppu).toBe(39);
    expect(end.lookAt).toEqual({ x: 24, y: 0, z: -5 });
  });

  it('pans and zooms at once when settled, but keeps an unfinished tween going toward the new target', () => {
    const rig = new BuildCameraRig();
    const play = playPose();
    rig.set(yard(24, 5), play);
    run(rig, 1, play);
    rig.set(yard(26.5, 7, 0, 50), rig.pose);
    expect(rig.settled).toBe(true);
    expect(rig.pose.lookAt).toEqual({ x: 26.5, y: 0, z: -7 });
    expect(rig.pose.ppu).toBe(50);
    const rig2 = new BuildCameraRig();
    rig2.set(yard(24, 5), play);
    run(rig2, 0.1, play);
    rig2.set(yard(30, 5), rig2.pose);
    expect(rig2.settled).toBe(false);
    run(rig2, 0.3, play);
    expect(rig2.pose.lookAt.x).toBeCloseTo(30, 9);
  });

  it('flies Yard ↔ Mine in 0.6 s and snaps yaw in 0.3 s the short way round', () => {
    const rig = new BuildCameraRig();
    const play = playPose();
    rig.set(yard(24, 5, 3), play);
    run(rig, 1, play);
    expect(rig.pose.yaw).toBe(315);
    rig.set(yard(24, 5, 0), rig.pose);
    const mid = run(rig, BUILD_YAW_S / 2, play);
    // 315° → 45° goes through 0°, not back through 180°.
    expect(Math.abs(angleDelta(mid.yaw, 0))).toBeLessThan(15);
    run(rig, BUILD_YAW_S / 2 + 0.02, play);
    expect(rig.settled).toBe(true);
    expect(((rig.pose.yaw % 360) + 360) % 360).toBeCloseTo(45, 6);
    rig.set(mine(26, 45), rig.pose);
    run(rig, BUILD_PLANE_S - 0.05, play);
    expect(rig.settled).toBe(false);
    run(rig, 0.06, play);
    expect(rig.settled).toBe(true);
    expect([rig.pose.yaw, rig.pose.pitch, rig.pose.ppu]).toEqual([8, 12, 47]);
    expect(rig.pose.lookAt).toEqual({ x: 26, y: -45, z: MINE_PLANE_Z });
  });

  it('returns to the live play pose in 0.35 s, then goes inactive', () => {
    const rig = new BuildCameraRig();
    const play = playPose();
    rig.set(mine(26, 45), play);
    run(rig, 1, play);
    rig.set(null, rig.pose);
    expect(rig.camera).toBeNull();
    expect(rig.active).toBe(true);
    play.lookAt.x = 22; // the play rig keeps following meanwhile
    run(rig, BUILD_ENTER_S + 0.02, play);
    expect(rig.active).toBe(false);
    expect(rig.pose.lookAt.x).toBeCloseTo(22, 9);
    expect(rig.pose.pitch).toBeCloseTo(35, 9);
    rig.set(null, rig.pose);
    expect(rig.active).toBe(false);
  });

  it('blends poses componentwise and copies them whole', () => {
    const a = buildPose(yard(0, 0, 0), newPose());
    const b = buildPose(mine(10, 20), newPose());
    const m = blendPose(a, b, 0.5, newPose());
    expect(m.pitch).toBeCloseTo((55 + 12) / 2, 9);
    expect(m.lookAt.x).toBeCloseTo(5, 9);
    expect(m.t).toBeCloseTo(0.5, 9);
    expect(copyPose(m, newPose())).toEqual(m);
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(angleDelta(0, 180)).toBe(180);
  });
});

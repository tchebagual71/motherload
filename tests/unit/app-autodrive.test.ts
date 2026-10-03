// Sign-tap auto-drive (01 §3.10; SIM-3, INT-10) on the real World: drive to each pad, brake onto it, stop; never
// into a hole Pip cannot skim (01 §3.2: gap skim bridges 1-wide gaps only; PLAYER-4).
import { describe, expect, it } from 'vitest';
import { approachSpeed, AutoDrive, holeStop, padCentre, type RimFloor } from '../../src/app/autoDrive';
import { blocksPod } from '../../src/pod';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { POD_H, POD_W, RIM_BUILDINGS, VX_MAX, type RimBuildingId } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import { T } from '../../src/shared/types';
import { World } from '../../src/world/world';

/** The real Rim row of `w` as the drive's floor probe (what GameApp passes). */
const rimOf = (w: World): RimFloor => (c) => blocksPod(w.terrain, c, 0, 320);

/** Dig a pit `deep` rows deep under columns x0…x1 of the Rim (the Tutorial Patch lies between the Pump and the Assay). */
function pit(w: World, x0: number, x1: number, deep = 3): void {
  for (let x = x0; x <= x1; x++) for (let r = 0; r < deep; r++) w.terrain.set(x, r, T.AIR);
}

/** Stand the pod still on the Rim at x. */
function standOnRim(w: World, x: number): void {
  const p = w.pod;
  p.x = p.prevX = x;
  p.y = p.prevY = POD_H / 2;
  p.vx = p.vy = 0;
  p.grounded = true;
}

function drive(w: World, id: RimBuildingId, max = 1_500, floor: RimFloor | null = null): { status: string; steps: number; events: GameEvent[]; peakV: number } {
  const d = new AutoDrive(floor);
  const out: PodIntent = { ...NO_INTENT };
  const events: GameEvent[] = [];
  let peakV = 0;
  if (d.start(id, w.pod) === 'blocked') return { status: 'refused', steps: 0, events, peakV };
  for (let i = 0; i < max; i++) {
    const status = d.step(w.pod, w.onRim(), out);
    if (status !== 'driving') return { status, steps: i, events, peakV };
    w.step(out, true);
    events.push(...w.drainEvents());
    peakV = Math.max(peakV, Math.abs(w.pod.vx));
  }
  return { status: 'timeout', steps: max, events, peakV };
}

const pad = (id: RimBuildingId) => RIM_BUILDINGS.find((b) => b.id === id)!;

describe('AutoDrive', () => {
  it('approach speed: full speed far out, the braking curve near the pad', () => {
    expect(approachSpeed(20)).toBe(VX_MAX);
    expect(approachSpeed(-20)).toBe(-VX_MAX);
    expect(approachSpeed(1.5)).toBeCloseTo(3, 6);
    expect(approachSpeed(0)).toBe(0);
  });

  for (const id of ['assay', 'garage', 'shed', 'pump'] as const) {
    it(`drives from the spawn to the ${id} pad and parks on its centre (skimming Dot's shaft mouth)`, () => {
      const w = new World({ seed: 7, scope: 'mvp' });
      const r = drive(w, id, 1_500, rimOf(w));
      expect(r.status).toBe('arrived');
      const b = pad(id);
      expect(Math.abs(w.pod.x - (b.x0 + b.x1 + 1) / 2)).toBeLessThan(0.3);
      expect(Math.abs(w.pod.vx)).toBeLessThan(0.15);
      expect(w.padUnderPod()).toBe(id);
      // Full speed on the way (01 §3.10), and well within the Rim's ≈ 11 s end to end.
      if (id === 'shed' || id === 'garage') expect(r.peakV).toBeGreaterThan(VX_MAX * 0.95);
      expect(r.steps).toBeLessThan(12 * 60);
      // It brakes onto the pad rather than coasting: the pad's neutral-stick rule never fires on the way in.
      expect(r.events.filter((e) => e.t === 'pad-arrive')).toEqual([]);
    });
  }

  it('is lost (and stops) once the pod leaves the Rim', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    const d = new AutoDrive();
    const out: PodIntent = { ...NO_INTENT };
    d.start('garage');
    expect(d.step(w.pod, false, out)).toBe('lost');
    expect(d.active).toBe(false);
    expect(d.step(w.pod, true, out)).toBe('idle');
  });

  it('gives up on a drive that never arrives', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    const d = new AutoDrive();
    const out: PodIntent = { ...NO_INTENT };
    d.start('shed');
    let status = 'driving';
    for (let i = 0; i < 2_000 && status === 'driving'; i++) status = d.step(w.pod, true, out); // the pod never moves
    expect(status).toBe('lost');
  });
});

describe('AutoDrive and holes in the Rim (01 §3.2; PLAYER-4)', () => {
  const solid: RimFloor = () => true;
  const holes =
    (...open: number[]): RimFloor =>
    (c) =>
      !open.includes(c);

  it('holeStop: a clear road, a 1-wide gap at speed or with a run-up, and a 2-wide hole', () => {
    expect(holeStop(12, 0, 3, solid)).toBeNull();
    // 2-wide pit at x 8–9: stop with the leading edge short of x 9 (driving left) or x 8 (driving right).
    const left = holeStop(12, 0, 3, holes(8, 9))!;
    expect(left - POD_W / 2).toBeGreaterThanOrEqual(10);
    expect(left - POD_W / 2).toBeLessThan(10.2);
    const right = holeStop(3, 0, 12, holes(8, 9))!;
    expect(right + POD_W / 2).toBeLessThanOrEqual(8);
    expect(right + POD_W / 2).toBeGreaterThan(7.8);
    // Dot's 1-wide shaft mouth is skimmed at speed (01 §3.2) …
    expect(holeStop(12, 4.5, 31.5, holes(26))).toBeNull();
    // … and from a standing start a body length back; a start right at its lip backs off first, then crosses.
    expect(holeStop(24, 0, 31.5, holes(26))).toBeNull();
    expect(holeStop(25.95, 0, 31.5, holes(26))).not.toBeNull();
    expect(holeStop(25.3, 0, 31.5, holes(26), true)).toBeNull();
    // A hole beyond the pad is not on the way.
    expect(holeStop(20, 0, 12, holes(8, 9))).toBeNull();
  });

  it('refuses a drive across a 2-wide pit (Assay → Pump over the Tutorial Patch): no fall, no hull loss', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    pit(w, 8, 9);
    standOnRim(w, padCentre('assay'));
    const hull = w.pod.hull;
    const r = drive(w, 'pump', 1_500, rimOf(w));
    expect(r.status).toBe('refused');
    expect(w.onRim()).toBe(true);
    expect(w.pod.hull).toBe(hull);
    // The other way round too, and a 3-wide pit.
    standOnRim(w, padCentre('pump'));
    expect(drive(w, 'assay', 1_500, rimOf(w)).status).toBe('refused');
    pit(w, 7, 9);
    expect(drive(w, 'assay', 1_500, rimOf(w)).status).toBe('refused');
  });

  it('skims a 1-wide pit at speed and arrives', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    pit(w, 8, 8);
    standOnRim(w, padCentre('assay'));
    const hull = w.pod.hull;
    const r = drive(w, 'pump', 1_500, rimOf(w));
    expect(r.status).toBe('arrived');
    expect(w.padUnderPod()).toBe('pump');
    expect(w.pod.hull).toBe(hull);
  });

  it('a hole that opens mid-drive: brakes to a stop at its edge, still on the Rim ("blocked")', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    standOnRim(w, padCentre('assay'));
    const d = new AutoDrive(rimOf(w));
    const out: PodIntent = { ...NO_INTENT };
    expect(d.start('pump', w.pod)).toBe('driving');
    let status = 'driving';
    let steps = 0;
    for (; steps < 1_500 && status === 'driving'; steps++) {
      if (steps === 20) pit(w, 8, 9); // the pod is at speed by now, ≥ 1 braking distance short of the pit
      status = d.step(w.pod, w.onRim(), out);
      if (status === 'driving') w.step(out, true);
    }
    expect(status).toBe('blocked');
    expect(d.active).toBe(false);
    expect(w.onRim()).toBe(true);
    expect(w.pod.x - POD_W / 2).toBeGreaterThan(9.9);
    expect(Math.abs(w.pod.vx)).toBeLessThan(0.15);
  });

  it('without the floor probe the old behaviour is unchanged: the pod falls into the pit and the drive is lost', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    pit(w, 8, 9);
    standOnRim(w, padCentre('assay'));
    expect(drive(w, 'pump').status).toBe('lost');
    expect(w.onRim()).toBe(false);
  });
});

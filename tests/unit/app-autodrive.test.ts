// Sign-tap auto-drive (01 §3.10; SIM-3, INT-10) on the real World: drive to each pad, brake onto it, stop.
import { describe, expect, it } from 'vitest';
import { approachSpeed, AutoDrive } from '../../src/app/autoDrive';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { RIM_BUILDINGS, VX_MAX, type RimBuildingId } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import { World } from '../../src/world/world';

function drive(w: World, id: RimBuildingId, max = 1_500): { status: string; steps: number; events: GameEvent[]; peakV: number } {
  const d = new AutoDrive();
  const out: PodIntent = { ...NO_INTENT };
  const events: GameEvent[] = [];
  let peakV = 0;
  d.start(id);
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
    it(`drives from the spawn to the ${id} pad and parks on its centre`, () => {
      const w = new World({ seed: 7, scope: 'mvp' });
      const r = drive(w, id);
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

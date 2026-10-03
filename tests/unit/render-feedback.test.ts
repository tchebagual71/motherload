// Scene feedback fixes: reduced motion reaches the pod (INT-7), battery mode holds the idle bob (04 §5.8), the
// armed-pad mask for the Rim lights (INT-8) and the teleport departure sparkle (INT-15).
import { describe, expect, it } from 'vitest';
import { LINES, POD_H, RIM_BUILDINGS, type Line } from '../../src/shared/canon';
import type { PodVisualState } from '../../src/render/models/api';
import { createPodModel } from '../../src/render/models/pod';
import { createFx } from '../../src/render/fx/fx';
import type { ParticlePool } from '../../src/render/fx/pool';
import { armedPads } from '../../src/render/renderer';
import type { RimBuildingId } from '../../src/shared/types';

function state(patch: Partial<PodVisualState> = {}): PodVisualState {
  const tiers = {} as Record<Line, number>;
  for (const l of LINES) tiers[l] = 1;
  return { x: 10, y: POD_H / 2, facing: 1, thrust: 0, digging: false, digDir: null, grounded: true, vx: 0, vy: 0, tiers, timeMs: 0, fastFall: false, ...patch };
}

/** Body scale right after a hard landing, and the idle "breathing" range once settled (grounded idle). */
function landingAndBob(patch: Partial<PodVisualState>): { squashY: number; bob: number } {
  const pod = createPodModel();
  const body = pod.root.children[0].children[0];
  let t = 0;
  pod.update(state({ ...patch, grounded: false, vy: -8, timeMs: (t += 16) }));
  pod.update(state({ ...patch, grounded: true, timeMs: (t += 16) }));
  const squashY = body.scale.y;
  for (let i = 0; i < 120; i++) pod.update(state({ ...patch, timeMs: (t += 16) }));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 240; i++) {
    pod.update(state({ ...patch, timeMs: (t += 16) }));
    lo = Math.min(lo, body.scale.y);
    hi = Math.max(hi, body.scale.y);
  }
  return { squashY, bob: hi - lo };
}

describe('pod animation under reduced motion and battery mode', () => {
  it('squashes on landing and bobs at rest by default', () => {
    const r = landingAndBob({});
    expect(r.squashY).toBeLessThan(0.95);
    expect(r.bob).toBeGreaterThan(0.005);
  });

  it('reduced motion drops the squash and the bob (03 §6.9)', () => {
    const r = landingAndBob({ reducedMotion: true });
    expect(r.squashY).toBeCloseTo(1, 3);
    expect(r.bob).toBeLessThan(1e-4);
  });

  it('battery mode keeps the landing squash but holds the idle bob', () => {
    const r = landingAndBob({ still: true });
    expect(r.squashY).toBeLessThan(0.95);
    expect(r.bob).toBeLessThan(0.002);
  });
});

describe('Rim pad lights (INT-8)', () => {
  it('lights every pad but the latched one under the pod, in RIM_BUILDINGS order', () => {
    const bit = (id: RimBuildingId) => 1 << RIM_BUILDINGS.findIndex((b) => b.id === id);
    const all = (1 << RIM_BUILDINGS.length) - 1;
    expect(armedPads({ padUnderPod: () => null, isPadArmed: () => false })).toBe(all);
    expect(armedPads({ padUnderPod: () => 'assay', isPadArmed: () => false })).toBe(all & ~bit('assay'));
    expect(armedPads({ padUnderPod: () => 'assay', isPadArmed: (id) => id === 'assay' })).toBe(all);
  });
});

describe('teleport sparkle (INT-15)', () => {
  function sparklesNear(fx: ReturnType<typeof createFx>, x: number, y: number): number {
    const pool = (fx as unknown as { pool: ParticlePool }).pool;
    let n = 0;
    for (let i = 0; i < pool.n; i++) if (Math.abs(pool.px[i] - x) < 1.5 && Math.abs(pool.py[i] - y) < 1.5) n++;
    return n;
  }

  it('sparkles where the pod was last drawn and where it lands', () => {
    const fx = createFx();
    fx.setBudget(500);
    fx.update(16, state({ x: 10, y: -120 }));
    // The sim already moved the pod: the renderer passes the destination as the pod position.
    fx.handle({ t: 'teleport', id: 'homingBeacon', x: 22, y: 0.39 }, 22, 0.39);
    expect(sparklesNear(fx, 10, -120)).toBeGreaterThan(0);
    expect(sparklesNear(fx, 22, 0.39)).toBeGreaterThan(0);
  });

  it('sparkles once when the pod has not been drawn yet or did not move', () => {
    const fx = createFx();
    fx.setBudget(500);
    fx.handle({ t: 'teleport', id: 'hopBeacon', x: 5, y: -3 }, 5, -3);
    const once = (fx as unknown as { pool: ParticlePool }).pool.n;
    expect(once).toBeGreaterThan(0);
    const fx2 = createFx();
    fx2.setBudget(500);
    fx2.update(16, state({ x: 5, y: -3 }));
    fx2.handle({ t: 'teleport', id: 'hopBeacon', x: 5, y: -3 }, 5, -3);
    expect((fx2 as unknown as { pool: ParticlePool }).pool.n).toBe(once);
  });
});

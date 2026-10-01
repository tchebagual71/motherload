import { InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { LINES, POD_H, type Line } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import { T, mineralCode } from '../../src/shared/types';
import type { FxSystem, PodVisualState } from '../../src/render/models/api';
import { MAT_ROLES, listMeshes } from '../../src/render/models/kit';
import { FX_CAPACITY, createFx } from '../../src/render/fx/fx';
import { KIND, PRIO, ParticlePool, newSpec } from '../../src/render/fx/pool';

function pod(patch: Partial<PodVisualState> = {}): PodVisualState {
  const tiers = {} as Record<Line, number>;
  for (const l of LINES) tiers[l] = 1;
  return {
    x: 10.5, y: -3.5, facing: 1, thrust: 0, digging: false, digDir: null, grounded: true,
    vx: 0, vy: 0, tiers, timeMs: 0, fastFall: false, ...patch,
  };
}

const EVENTS: GameEvent[] = [
  { t: 'dig-start', x: 10, r: 4, code: T.DIRT },
  { t: 'dug', x: 10, r: 4, code: mineralCode(3) },
  { t: 'dug', x: 10, r: 0, code: T.TURF },
  { t: 'dig-refused', x: 11, r: 3, reason: 'hardrock' },
  { t: 'dig-refused', x: 11, r: 3, reason: 'paved' },
  { t: 'collect', item: { kind: 'mineral', tier: 6 } },
  { t: 'collect', item: { kind: 'relic', id: 2 } },
  { t: 'landed', v: 7 },
  { t: 'damage', amount: 4, cause: 'landing' },
  { t: 'damage', amount: 29, cause: 'magma' },
  { t: 'explosion', x: 10, r: 5, radius: 1 },
  { t: 'explosion', x: 10, r: 5, radius: 2 },
  { t: 'teleport', id: 'hopBeacon', x: 20, y: 0.39 },
  { t: 'destroyed', cause: 'hull' },
];

function alive(fx: FxSystem): number {
  return (fx as unknown as { pool: ParticlePool }).pool.n;
}

function drawn(fx: FxSystem): number {
  return listMeshes(fx.root).reduce((n, m) => n + (m as InstancedMesh).count, 0);
}

describe('ParticlePool', () => {
  it('evicts the oldest of the lowest class when full and refuses lower classes over higher ones', () => {
    const pool = new ParticlePool(8, 4);
    const s = newSpec();
    s.prio = PRIO.AMBIENCE;
    for (let i = 0; i < 4; i++) {
      s.x = i;
      expect(pool.spawn(s)).toBeGreaterThanOrEqual(0);
    }
    s.prio = PRIO.TELL;
    s.x = 99;
    const slot = pool.spawn(s);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(pool.n).toBe(4);
    expect(Array.from(pool.px.subarray(0, 4)).sort((a, b) => a - b)).toEqual([1, 2, 3, 99]);
    for (let i = 0; i < 3; i++) pool.spawn(s);
    s.prio = PRIO.POD;
    expect(pool.spawn(s)).toBe(-1);
  });

  it('expires particles and trims to a lowered budget', () => {
    const pool = new ParticlePool(16);
    const s = newSpec();
    s.life = 0.5;
    for (let i = 0; i < 10; i++) pool.spawn(s);
    pool.step(0.25);
    expect(pool.n).toBe(10);
    pool.setBudget(3);
    expect(pool.n).toBe(3);
    pool.step(0.3);
    expect(pool.n).toBe(0);
  });

  it('integrates gravity and drag', () => {
    const pool = new ParticlePool(2);
    const s = newSpec();
    s.kind = KIND.GLOW;
    s.vy = 2;
    s.gravity = 10;
    s.life = 5;
    pool.spawn(s);
    pool.step(0.1);
    expect(pool.vy[0]).toBeCloseTo(1, 5);
    expect(pool.py[0]).toBeCloseTo(0.1, 5);
  });
});

describe('FX system', () => {
  it('uses role-tagged instanced meshes with vertex colours', () => {
    const fx = createFx();
    const meshes = listMeshes(fx.root);
    expect(meshes.length).toBe(3);
    for (const m of meshes) {
      expect(m).toBeInstanceOf(InstancedMesh);
      expect(MAT_ROLES).toContain(m.userData.mat);
      expect(m.geometry.getAttribute('color')).toBeDefined();
      expect((m as InstancedMesh).instanceColor).not.toBeNull();
    }
  });

  it('emits for every event kind', () => {
    for (const e of EVENTS) {
      const fx = createFx();
      fx.handle(e, 10.5, -3.5);
      fx.update(16, pod());
      expect(alive(fx), e.t).toBeGreaterThan(0);
      expect(drawn(fx)).toBe(alive(fx));
    }
  });

  it('makes Mega Pop bigger by half (03 §8.10)', () => {
    const count = (radius: number) => {
      const fx = createFx();
      fx.setBudget(900);
      fx.handle({ t: 'explosion', x: 10, r: 5, radius }, 0, 0);
      return alive(fx);
    };
    expect(count(2)).toBeCloseTo(count(1) * 1.5, -1);
  });

  it('never exceeds its budget and allocates nothing after warm-up', () => {
    for (const budget of [250, 500, 900]) {
      const fx = createFx();
      fx.setBudget(budget);
      const meshes = listMeshes(fx.root) as InstancedMesh[];
      const arrays = meshes.map((m) => [m.instanceMatrix.array, m.instanceColor!.array]);
      const childCount = fx.root.children.length;
      const p = pod({ digging: true, digDir: 'down', thrust: 1, fastFall: true });
      for (let frame = 0; frame < 300; frame++) {
        for (const e of EVENTS) fx.handle(e, p.x, p.y);
        p.timeMs += 16;
        fx.update(16, p);
        expect(alive(fx)).toBeLessThanOrEqual(budget);
        expect(drawn(fx)).toBe(alive(fx));
      }
      expect(alive(fx)).toBeGreaterThan(budget * 0.9);
      expect(fx.root.children.length).toBe(childCount);
      meshes.forEach((m, i) => {
        expect(m.instanceMatrix.array).toBe(arrays[i][0]);
        expect(m.instanceColor!.array).toBe(arrays[i][1]);
        expect(m.instanceMatrix.count).toBe(FX_CAPACITY);
      });
      fx.setBudget(budget / 2);
      expect(alive(fx)).toBeLessThanOrEqual(budget / 2);
    }
  });

  it('runs continuous drill debris and thrust smoke at the quality rates', () => {
    const fx = createFx();
    fx.setBudget(500);
    const p = pod({ digging: true, digDir: 'right' });
    for (let i = 0; i < 30; i++) fx.update(16, p);
    expect(alive(fx)).toBeGreaterThan(0);
    const thrust = createFx();
    const q = pod({ thrust: 1, grounded: false, y: POD_H / 2 + 2 });
    for (let i = 0; i < 60; i++) thrust.update(16, q);
    // 6 smoke puffs/s at mid, each with an ember: ~12 spawned over ~1 s, some already expired.
    expect(alive(thrust)).toBeGreaterThan(3);
    expect(alive(thrust)).toBeLessThan(20);
  });

  it('keeps particles in world space near their source', () => {
    const fx = createFx();
    fx.handle({ t: 'dug', x: 30, r: 100, code: T.DIRT }, 30.5, -99.5);
    fx.update(16, pod());
    const pool = (fx as unknown as { pool: ParticlePool }).pool;
    for (let i = 0; i < pool.n; i++) {
      expect(Math.abs(pool.px[i] - 30.5)).toBeLessThan(1);
      expect(Math.abs(pool.py[i] + 100.5)).toBeLessThan(1);
      expect(pool.pz[i]).toBeGreaterThan(0.3);
    }
  });
});

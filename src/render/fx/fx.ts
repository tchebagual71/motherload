// Pooled particle FX (03 §8.10): dig debris and dust in band colours, Hardrock sparks, ore pops,
// landing dust, damage flashes, explosions (flash + debris + smoke ring; Mega +50%), teleport sparkles,
// and the continuous thrust smoke / drill debris / speed streaks. One pool, one budget, three instanced
// draws (lit chips, lit puffs, unlit glows). Particles live in world space; nothing allocates per frame.
import { Color, Group, type InstancedMesh } from 'three';
import { POD_H } from '../../shared/canon';
import type { GameEvent } from '../../shared/events';
import { Rng, STREAM } from '../../shared/rng';
import { T, mineralTierOf, relicIdOf, type CargoItem } from '../../shared/types';
import { ORES, POD, RELIC_COLOURS, ROLE, SPECIAL, SURFACE, UI, stratumAt } from '../palette';
import type { FxSystem, PodVisualState } from '../models/api';
import { GeometryBuilder, at, box, ico, mixHex, roleInstanced } from '../models/kit';
import { FLAG_ALIGN, KIND, KIND_COUNT, PRIO, ParticlePool, newSpec, type Kind, type ParticleSpec, type Prio } from './pool';

/** High-tier cap (canon §3.14: 250 / 500 / 900). */
export const FX_CAPACITY = 900;
const DEFAULT_BUDGET = 500;

// 03 §8.10 counts per quality tier (low / mid / high).
const CELL_BREAK = [4, 6, 8] as const;
const SPARKS = [8, 12, 20] as const;
const ORE_POP = [6, 10, 14] as const;
const EXPLOSION = [20, 30, 40] as const;
const TELEPORT = [12, 20, 30] as const;
const DRILL_PER_S = [10, 16, 22] as const;
const THRUST_PER_S = [3, 6, 8] as const;
const STREAKS_PER_S = [0, 4, 8] as const;
const MEGA_FACTOR = 1.5;

const SPARK_HOT = POD.flame;
const SPARK_COOL = POD.accent;
const SMOKE = mixHex(UI.cream, SPECIAL.hardrockChamfer, 0.45);
const SMOKE_DARK = SPECIAL.hardrockChamfer;

/** Particles sit just proud of the slab face (z = +0.5) so terrain never hides them. */
const Z_FRONT = 0.5;
const POD_HALF_H = POD_H / 2;
const MAX_DT = 0.1;

const _c0 = new Color();
const _c1 = new Color();

class FxPool implements FxSystem {
  readonly root = new Group();
  readonly pool = new ParticlePool(FX_CAPACITY, DEFAULT_BUDGET);
  private readonly meshes: InstancedMesh[];
  private readonly counts = new Int32Array(KIND_COUNT);
  private readonly spec = newSpec();
  private readonly rng = new Rng(0x46_58, STREAM.FX);
  private tier: 0 | 1 | 2 = 1;
  private drillAcc = 0;
  private drillTick = 0;
  private thrustAcc = 0;
  private streakAcc = 0;
  /** Pod position at the last update() (the departure point of a teleport handled before the next one). */
  private lastPodX = Number.NaN;
  private lastPodY = Number.NaN;

  constructor() {
    this.root.name = 'fx';
    // Unit-sized, white (instance colour tints them); the chip cube is pre-tilted so spinning about z shows three faces.
    const cube = new GeometryBuilder().add(box(1, 1, 1), 0xffffff, at(0, 0, 0, 0.55, 0.65, 0)).build();
    const blob = new GeometryBuilder().add(ico(0.5, 0), 0xffffff).build();
    this.meshes = [
      roleInstanced(cube, 'solid', FX_CAPACITY, 'fx-chips', true),
      roleInstanced(blob, 'solid', FX_CAPACITY, 'fx-puffs', true),
      roleInstanced(blob, 'emissive', FX_CAPACITY, 'fx-glows', true),
    ];
    for (const m of this.meshes) {
      m.visible = false;
      m.matrixAutoUpdate = false;
      this.root.add(m);
    }
    this.root.matrixAutoUpdate = false;
    this.setBudget(DEFAULT_BUDGET);
  }

  setBudget(maxParticles: number): void {
    this.pool.setBudget(maxParticles);
    const b = this.pool.budget;
    this.tier = b <= 250 ? 0 : b <= 500 ? 1 : 2;
  }

  handle(e: GameEvent, podX: number, podY: number): void {
    switch (e.t) {
      case 'dig-start':
        this.digBurst(e.x, e.r, e.code, podX, podY, true);
        break;
      case 'dug':
        this.digBurst(e.x, e.r, e.code, podX, podY, false);
        break;
      case 'dig-refused':
        this.refused(e.x, e.r, e.reason, podX, podY);
        break;
      case 'collect':
        this.orePop(podX, podY + 0.2, e.item);
        break;
      case 'landed':
        this.landingDust(podX, podY, e.v);
        break;
      case 'damage':
        this.damage(podX, podY, e.cause);
        break;
      case 'explosion':
        this.explosion(e.x + 0.5, -(e.r + 0.5), e.r, e.radius);
        break;
      case 'destroyed':
        this.explosion(podX, podY, Math.max(0, Math.floor(-podY)), 1);
        break;
      case 'teleport':
        // The sim moved the pod without interpolation, so podX/podY is already the destination; the departure
        // sparkle goes where the pod was last drawn (03 §6.9: every event pairs a visual).
        if (Number.isFinite(this.lastPodX) && Math.abs(this.lastPodX - e.x) + Math.abs(this.lastPodY - e.y) > 0.5) {
          this.sparkle(this.lastPodX, this.lastPodY);
        }
        this.sparkle(e.x, e.y);
        break;
      case 'respawned':
        this.sparkle(podX, podY);
        break;
      default:
        break;
    }
  }

  update(dtMs: number, pod: PodVisualState): void {
    const dt = Math.max(0, Math.min(MAX_DT, dtMs / 1000));
    this.lastPodX = pod.x;
    this.lastPodY = pod.y;
    this.emitContinuous(dt, pod);
    this.pool.step(dt);
    this.writeInstances();
  }

  // ---- spawning helpers ---------------------------------------------------------------------

  private rand(a: number, b: number): number {
    return a + (b - a) * this.rng.next();
  }

  /** Reset the shared spec with a kind, class, position, life and colours (palette hex). */
  private begin(kind: Kind, prio: Prio, x: number, y: number, life: number, hex0: number, hex1: number): ParticleSpec {
    const s = this.spec;
    s.kind = kind;
    s.prio = prio;
    s.x = x;
    s.y = y;
    s.z = Z_FRONT + this.rand(-0.02, 0.2);
    s.vx = 0;
    s.vy = 0;
    s.vz = this.rand(0.2, 0.9);
    s.life = life;
    _c0.setHex(hex0);
    _c1.setHex(hex1);
    s.r0 = _c0.r; s.g0 = _c0.g; s.b0 = _c0.b;
    s.r1 = _c1.r; s.g1 = _c1.g; s.b1 = _c1.b;
    s.gravity = 0;
    s.drag = 0;
    s.rot = this.rand(0, Math.PI * 2);
    s.spin = 0;
    s.stretch = 0;
    s.flags = 0;
    return s;
  }

  private chips(x: number, y: number, n: number, hexA: number, hexB: number, speed: number, dirX: number, dirY: number, prio: Prio): void {
    for (let i = 0; i < n; i++) {
      const s = this.begin(KIND.CUBE, prio, x + this.rand(-0.15, 0.15), y + this.rand(-0.15, 0.15), this.rand(0.45, 0.8), i % 2 ? hexA : hexB, i % 2 ? hexA : hexB);
      const a = this.rand(0, Math.PI * 2);
      const v = speed * this.rand(0.5, 1);
      s.vx = Math.cos(a) * v * 0.7 + dirX * v;
      s.vy = Math.abs(Math.sin(a)) * v * 0.6 + dirY * v + 1.2;
      s.gravity = 14;
      s.drag = 0.6;
      s.size0 = s.size1 = this.rand(0.07, 0.13);
      s.spin = this.rand(-14, 14);
      this.pool.spawn(s);
    }
  }

  private puffs(x: number, y: number, n: number, hex: number, size: number, spread: number, prio: Prio): void {
    for (let i = 0; i < n; i++) {
      const s = this.begin(KIND.BLOB, prio, x + this.rand(-spread, spread), y + this.rand(-0.05, 0.1), this.rand(0.45, 0.75), hex, hex);
      s.vx = this.rand(-1, 1) * (0.6 + spread);
      s.vy = this.rand(0.2, 0.9);
      s.gravity = -0.4;
      s.drag = 2.5;
      s.size0 = size * 0.5;
      s.size1 = size * this.rand(1.1, 1.5);
      this.pool.spawn(s);
    }
  }

  private sparks(x: number, y: number, n: number, dirX: number, dirY: number, hex0: number, hex1: number, prio: Prio): void {
    for (let i = 0; i < n; i++) {
      const s = this.begin(KIND.GLOW, prio, x, y, this.rand(0.18, 0.4), hex0, hex1);
      const a = this.rand(0, Math.PI * 2);
      const v = this.rand(2.5, 5.5);
      s.vx = Math.cos(a) * v * 0.6 + dirX * v;
      s.vy = Math.sin(a) * v * 0.6 + dirY * v + 1;
      s.gravity = 9;
      s.drag = 1;
      s.size0 = 0.07;
      s.size1 = 0.05;
      s.stretch = 0.12;
      s.flags = FLAG_ALIGN;
      this.pool.spawn(s);
    }
  }

  private flash(x: number, y: number, size: number, hex0: number, hex1: number, life: number): void {
    const s = this.begin(KIND.GLOW, PRIO.TELL, x, y, life, hex0, hex1);
    s.z = Z_FRONT + 0.2;
    s.vz = 0;
    s.size0 = size * 0.4;
    s.size1 = size;
    this.pool.spawn(s);
  }

  // ---- events -------------------------------------------------------------------------------

  private digBurst(cx: number, r: number, code: number, podX: number, podY: number, start: boolean): void {
    const mx = cx + 0.5, my = -(r + 0.5);
    // Contact point: the cell boundary nearest the pod (the pod's centre once it has slid in).
    const x = mx + Math.max(-0.5, Math.min(0.5, podX - mx));
    const y = my + Math.max(-0.5, Math.min(0.5, podY - my));
    terrainColours(code, r, _tc);
    const [a, b, dust] = _tc;
    const n = CELL_BREAK[this.tier];
    const count = start ? Math.max(2, n >> 1) : n;
    const ux = Math.sign(podX - mx) * 0.5, uy = Math.sign(podY - my) * 0.5;
    this.chips(start ? x : mx, start ? y : my, count, a, b, 2.4, ux, uy, PRIO.POD);
    this.puffs(start ? x : mx, start ? y : my, start ? 1 : Math.ceil(count / 2), dust, 0.26, 0.25, PRIO.POD);
    const tier = mineralTierOf(code);
    if (!start && tier > 0) this.chips(mx, my, Math.max(2, n >> 1), ORES[tier - 1].base, ORES[tier - 1].highlight, 2, 0, 0.6, PRIO.POD);
    const relic = relicIdOf(code);
    if (!start && relic >= 0) this.chips(mx, my, 3, RELIC_COLOURS[relic], RELIC_COLOURS[relic], 2, 0, 0.6, PRIO.POD);
  }

  private refused(cx: number, r: number, reason: string, podX: number, podY: number): void {
    const mx = cx + 0.5, my = -(r + 0.5);
    const x = mx + Math.max(-0.5, Math.min(0.5, podX - mx));
    const y = my + Math.max(-0.5, Math.min(0.5, podY - my));
    const back = Math.sign(podX - mx) || 0;
    const up = podY > my + 0.4 ? 0.6 : 0.2;
    if (reason === 'paved' || reason === 'anchored') {
      this.puffs(x, y, 2, SURFACE.dust, 0.2, 0.15, PRIO.POD);
      return;
    }
    const n = SPARKS[this.tier];
    this.sparks(x, y, reason === 'hardrock' ? n : n >> 1, back * 0.6, up, SPARK_HOT, SPARK_COOL, PRIO.TELL);
  }

  private orePop(x: number, y: number, item: CargoItem): void {
    itemColours(item, _ic);
    const [base, hi] = _ic;
    const n = ORE_POP[this.tier];
    for (let i = 0; i < n; i++) {
      const s = this.begin(KIND.GLOW, PRIO.POD, x + this.rand(-0.2, 0.2), y, this.rand(0.4, 0.65), i % 3 === 0 ? hi : base, base);
      const a = this.rand(-0.9, 0.9);
      const v = this.rand(2.2, 3.6);
      s.vx = Math.sin(a) * v;
      s.vy = Math.cos(a) * v;
      s.gravity = 7;
      s.drag = 1.5;
      s.size0 = this.rand(0.1, 0.15);
      s.size1 = 0.05;
      s.spin = this.rand(-10, 10);
      this.pool.spawn(s);
    }
  }

  private landingDust(x: number, y: number, v: number): void {
    if (v < 2) return;
    const feet = y - POD_HALF_H;
    const row = Math.floor(-feet + 0.05);
    const hex = row <= 0 ? SURFACE.dust : stratumAt(row).accent;
    const n = Math.round(CELL_BREAK[this.tier] * Math.max(0.5, Math.min(1.5, v / 5)));
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const s = this.begin(KIND.BLOB, PRIO.POD, x + side * this.rand(0.2, 0.45), feet + 0.05, this.rand(0.4, 0.7), hex, hex);
      s.vx = side * this.rand(1, 2.4);
      s.vy = this.rand(0.1, 0.7);
      s.gravity = -0.3;
      s.drag = 3;
      s.size0 = 0.12;
      s.size1 = this.rand(0.26, 0.36);
      this.pool.spawn(s);
    }
  }

  private damage(x: number, y: number, cause: 'landing' | 'magma' | 'methane'): void {
    this.flash(x, y, 1.1, UI.danger, UI.danger, 0.14);
    const n = SPARKS[this.tier] >> 1;
    if (cause === 'magma') this.sparks(x, y - 0.2, n, 0, 0.6, SPECIAL.magmaCore, SPECIAL.magmaMid, PRIO.TELL);
    else if (cause === 'methane') this.sparks(x, y, n, 0, 0.4, SPECIAL.methaneRevealed, SPECIAL.methaneRevealed, PRIO.TELL);
    else this.sparks(x, y - 0.3, n, 0, 0.5, UI.danger, SPARK_COOL, PRIO.TELL);
  }

  private explosion(x: number, y: number, row: number, radius: number): void {
    const mega = radius >= 2;
    const total = Math.round(EXPLOSION[this.tier] * (mega ? MEGA_FACTOR : 1));
    const scale = mega ? 1.5 : 1;
    // 80-ms flash (03 §8.10).
    this.flash(x, y, 1.8 * scale * radius + 0.6, ROLE.chevron, POD.flame, 0.08);
    const band = stratumAt(Math.max(0, row));
    const debris = Math.round(total * 0.45);
    const ring = Math.round(total * 0.35);
    const sparks = total - debris - ring - 1;
    this.chips(x, y, debris, band.front, band.side, 4.5 * scale, 0, 0.3, PRIO.TELL);
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + this.rand(-0.15, 0.15);
      const s = this.begin(KIND.BLOB, PRIO.TELL, x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, this.rand(0.7, 1.05), SMOKE, SMOKE_DARK);
      const v = this.rand(2.6, 3.4) * radius * scale;
      s.vx = Math.cos(a) * v;
      s.vy = Math.sin(a) * v;
      s.vz = this.rand(0, 0.4);
      s.gravity = -0.6;
      s.drag = 3.2;
      s.size0 = 0.22 * scale;
      s.size1 = 0.5 * scale;
      this.pool.spawn(s);
    }
    this.sparks(x, y, Math.max(0, sparks), 0, 0.3, SPARK_HOT, SPARK_COOL, PRIO.TELL);
  }

  private sparkle(x: number, y: number): void {
    const n = TELEPORT[this.tier];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = this.begin(KIND.GLOW, PRIO.POD, x + Math.cos(a) * 0.45, y + this.rand(-0.4, 0.3), this.rand(0.55, 0.9), i % 2 ? POD.visor : ROLE.chevron, POD.visor);
      s.vx = -Math.cos(a) * 0.4;
      s.vy = this.rand(1.2, 2.4);
      s.drag = 1.2;
      s.size0 = this.rand(0.08, 0.12);
      s.size1 = 0.03;
      s.spin = this.rand(-8, 8);
      this.pool.spawn(s);
    }
  }

  // ---- continuous emitters --------------------------------------------------------------------

  private emitContinuous(dt: number, pod: PodVisualState): void {
    if (pod.digging && pod.digDir) {
      this.drillAcc += DRILL_PER_S[this.tier] * dt;
      while (this.drillAcc >= 1) {
        this.drillAcc -= 1;
        this.drillParticle(pod);
      }
    } else this.drillAcc = 0;

    const th = Math.max(0, Math.min(1, pod.thrust));
    if (th > 0.05) {
      this.thrustAcc += THRUST_PER_S[this.tier] * th * dt;
      while (this.thrustAcc >= 1) {
        this.thrustAcc -= 1;
        this.thrustParticle(pod, th);
      }
    } else this.thrustAcc = 0;

    if (pod.fastFall && STREAKS_PER_S[this.tier] > 0) {
      this.streakAcc += STREAKS_PER_S[this.tier] * dt;
      while (this.streakAcc >= 1) {
        this.streakAcc -= 1;
        this.streak(pod);
      }
    } else this.streakAcc = 0;
  }

  private drillParticle(pod: PodVisualState): void {
    const down = pod.digDir === 'down';
    const dir = pod.digDir === 'left' ? -1 : 1;
    const tx = down ? pod.x + 0.06 * pod.facing : pod.x + dir * 0.6;
    const ty = down ? pod.y - 0.55 : pod.y - 0.1;
    const row = Math.floor(-ty);
    const band = stratumAt(Math.max(0, row));
    const front = row <= 0 ? SPECIAL.turf : band.front;
    const side = row <= 0 ? SURFACE.groundSide : band.side;
    this.drillTick++;
    if (this.drillTick % 3 === 0) {
      this.puffs(tx, ty, 1, row <= 0 ? SURFACE.dust : band.accent, 0.22, 0.2, PRIO.POD);
      return;
    }
    // Chips fly back out of the cut, toward the pod.
    this.chips(tx, ty, 1, front, side, 2.2, down ? 0 : -dir * 0.6, down ? 0.8 : 0.3, PRIO.POD);
  }

  private thrustParticle(pod: PodVisualState, th: number): void {
    const nx = pod.x - 0.18 * pod.facing;
    const ny = pod.y - POD_HALF_H - 0.08;
    const s = this.begin(KIND.BLOB, PRIO.POD, nx + this.rand(-0.1, 0.1), ny, this.rand(0.55, 0.85), SMOKE, SMOKE_DARK);
    s.z = this.rand(-0.1, 0.3);
    s.vx = this.rand(-0.5, 0.5) + pod.vx * 0.3;
    s.vy = -this.rand(1.5, 2.5) * th + pod.vy * 0.3;
    s.vz = 0;
    s.gravity = -1.2;
    s.drag = 2.5;
    s.size0 = 0.1;
    s.size1 = this.rand(0.28, 0.38);
    this.pool.spawn(s);
    const e = this.begin(KIND.GLOW, PRIO.POD, nx, ny, this.rand(0.15, 0.25), SPARK_HOT, SPARK_COOL);
    e.z = this.rand(-0.1, 0.3);
    e.vx = this.rand(-0.6, 0.6) + pod.vx * 0.5;
    e.vy = -this.rand(2.5, 4) + pod.vy * 0.5;
    e.size0 = 0.07;
    e.size1 = 0.03;
    this.pool.spawn(e);
  }

  private streak(pod: PodVisualState): void {
    const s = this.begin(KIND.GLOW, PRIO.AMBIENCE, pod.x + this.rand(-0.45, 0.45), pod.y + this.rand(0.2, 0.7), 0.22, UI.cream, SURFACE.dust);
    s.vy = pod.vy * 0.15;
    s.size0 = 0.05;
    s.size1 = 0.05;
    s.stretch = 4;
    s.rot = 0;
    this.pool.spawn(s);
  }

  // ---- rendering ----------------------------------------------------------------------------

  private writeInstances(): void {
    const p = this.pool;
    const counts = this.counts;
    counts.fill(0);
    for (let i = 0; i < p.n; i++) {
      const k = p.kind[i];
      const mesh = this.meshes[k];
      const slot = counts[k]++;
      const t = p.age[i] / p.life[i];
      const fade = t < 0.75 ? 1 : (1 - t) * 4;
      const size = (p.size0[i] + (p.size1[i] - p.size0[i]) * t) * fade;
      let angle: number, sx: number, sy: number;
      if (p.flags[i] & FLAG_ALIGN) {
        const vx = p.vx[i], vy = p.vy[i];
        angle = Math.atan2(vy, vx);
        sx = size * (1 + p.stretch[i] * Math.sqrt(vx * vx + vy * vy) * 4);
        sy = size * 0.7;
      } else {
        angle = p.rot[i];
        sx = size;
        sy = size * (1 + p.stretch[i]);
      }
      const c = Math.cos(angle), s = Math.sin(angle);
      const e = mesh.instanceMatrix.array as Float32Array;
      const o = slot * 16;
      e[o] = c * sx; e[o + 1] = s * sx; e[o + 2] = 0; e[o + 3] = 0;
      e[o + 4] = -s * sy; e[o + 5] = c * sy; e[o + 6] = 0; e[o + 7] = 0;
      e[o + 8] = 0; e[o + 9] = 0; e[o + 10] = size; e[o + 11] = 0;
      e[o + 12] = p.px[i]; e[o + 13] = p.py[i]; e[o + 14] = p.pz[i]; e[o + 15] = 1;
      const col = mesh.instanceColor!.array as Float32Array;
      const ci = i * 6, co = slot * 3;
      col[co] = p.color[ci] + (p.color[ci + 3] - p.color[ci]) * t;
      col[co + 1] = p.color[ci + 1] + (p.color[ci + 4] - p.color[ci + 1]) * t;
      col[co + 2] = p.color[ci + 2] + (p.color[ci + 5] - p.color[ci + 2]) * t;
    }
    for (let k = 0; k < KIND_COUNT; k++) {
      const mesh = this.meshes[k];
      const n = counts[k];
      mesh.count = n;
      mesh.visible = n > 0;
      if (n === 0) continue;
      const m = mesh.instanceMatrix;
      m.clearUpdateRanges();
      m.addUpdateRange(0, n * 16);
      m.needsUpdate = true;
      const col = mesh.instanceColor!;
      col.clearUpdateRanges();
      col.addUpdateRange(0, n * 3);
      col.needsUpdate = true;
    }
  }
}

const _tc: [number, number, number] = [0, 0, 0];
const _ic: [number, number] = [0, 0];

function set3(out: [number, number, number], a: number, b: number, c: number): void {
  out[0] = a;
  out[1] = b;
  out[2] = c;
}

/** Debris colours for a dug cell into `out`: [chip A, chip B, dust] (03 §8.3, §8.5). */
function terrainColours(code: number, row: number, out: [number, number, number]): void {
  if (code === T.TURF || row <= 0) set3(out, SPECIAL.turf, SURFACE.groundSide, SURFACE.dust);
  else if (code === T.HARDROCK) set3(out, SPECIAL.hardrock, SPECIAL.hardrockDark, SPECIAL.hardrockChamfer);
  else if (code === T.MAGMA) set3(out, SPECIAL.magmaMid, SPECIAL.magmaCrust, SPECIAL.magmaCore);
  else {
    const band = stratumAt(row);
    set3(out, band.front, band.side, band.accent);
  }
}

/** Ore pop colours for a collected item into `out`: [base, highlight]. */
function itemColours(item: CargoItem, out: [number, number]): void {
  if (item.kind === 'mineral') {
    const o = ORES[Math.max(0, Math.min(ORES.length - 1, item.tier - 1))];
    out[0] = o.base;
    out[1] = o.highlight;
  } else if (item.kind === 'relic') {
    out[0] = RELIC_COLOURS[Math.max(0, Math.min(RELIC_COLOURS.length - 1, item.id))];
    out[1] = ROLE.chevron;
  } else {
    out[0] = ROLE.buildingBody;
    out[1] = ROLE.logistics;
  }
}

/** Create the FX system (default budget: mid tier, 500 particles). */
export function createFx(): FxSystem {
  return new FxPool();
}

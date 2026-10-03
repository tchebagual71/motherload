// Access chevrons (03 §4.6; 01 §2.5): once the scripted lode is discovered, orange downward chevrons on every
// still-solid cell of its access column (x0 + 1, rows 0 … top − 2: the 45 digs of "Dig down at the chevrons")
// pulse at 1 Hz down the column, and a mustard survey post marks the column's mouth on the Rim, until the column
// is dug through to the drill site (or a drill, built or ghost, already sits on the lode).
// One instanced decal draw at the cells' front faces (late layer, unlit with a plum ink rim, so it reads in the
// dark rows and on any stratum in both looks), rebuilt only when the column's terrain chunk versions move. Each
// chevron is laid out in view space: painted flat on the yawed, pitched face, it read as a sheared check mark, not
// a down arrow. The post is a small look-material prop (Toon ramp, Pixel Lab edges). Reduced motion holds the
// pulse; Pixel Lab steps it.
import { BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Matrix4, type Mesh, ShaderMaterial } from 'three';
import { CHUNK } from '../shared/canon';
import { T, type Look, type Lode } from '../shared/types';
import type { FactoryApi } from '../factory/api';
import { CHUNKS_X, type TerrainGrid } from '../terrain/grid';
import { LAYER_LATE } from './materials';
import { GeometryBuilder, at, box, roleMesh, shadeHex } from './models/kit';
import { ROLE, UI } from './palette';
import { FRONT_Z } from './terrain/mesher';

/** Chevrons drawn at most (the scripted lode's dig is 45 cells; canon §3.2 puts it at r46). */
export const ACCESS_MAX = 64;
/** Pulse rate (03 §4.6) and how far down the column one pulse travels per second, in rows. */
export const ACCESS_PULSE_HZ = 1;
const PULSE_ROWS_PER_CYCLE = 14;
/** Pixel Lab: the pulse steps through this many levels (a hard ramp, like its lighting; 03 §9.3). */
const PIXEL_PULSE_STEPS = 3;
/**
 * View-space lift toward the camera (world units): the screen-aligned chevron clears its own face's chamfers at
 * any build or play angle (≤ 0.4 × sin 30°); nothing stands in front of the slab's front faces to be drawn over.
 * The orange fill sits a hair over the ink rim.
 */
const INK_LIFT = 0.3;
const FILL_LIFT = 0.305;

/** Access column of a lode (01 §2.5: x0 + 1, the middle column: inside the drill footprint on either side). */
export function accessColumn(lode: Pick<Lode, 'x0'>): number {
  return lode.x0 + 1;
}

/** Last row of the access dig (01 §2.5: r44 above the r46 lode, the drill footprint's top row). */
export function accessLastRow(lode: Pick<Lode, 'top'>): number {
  return lode.top - 2;
}

/** Rows of the access column still to dig, top down, into `out` (empty once dug through). */
export function accessRows(grid: Pick<TerrainGrid, 'get'>, lode: Pick<Lode, 'x0' | 'top'>, out: number[]): number[] {
  out.length = 0;
  const x = accessColumn(lode);
  for (let r = 0; r <= accessLastRow(lode); r++) if (grid.get(x, r) !== T.AIR) out.push(r);
  return out;
}

/**
 * Change stamp of the access column: the sum of the chunk versions its rows span. Versions only grow, so any
 * change to a cell in (or bordering) those chunks moves the sum.
 */
export function accessStamp(grid: Pick<TerrainGrid, 'chunkVersion'>, lode: Pick<Lode, 'x0' | 'top'>): number {
  const cx = Math.floor(accessColumn(lode) / CHUNK);
  const last = Math.floor(Math.max(0, accessLastRow(lode)) / CHUNK);
  let s = 0;
  for (let cy = 0; cy <= last; cy++) s += grid.chunkVersion[cy * CHUNKS_X + cx] ?? 0;
  return s;
}

/** A drill already stands (or waits as a ghost job) on the lode: the access dig has nothing left to lead to. */
export function drillOnLode(f: Pick<FactoryApi, 'entities' | 'ghosts'>, lode: Pick<Lode, 'x0' | 'top'>): boolean {
  const on = (k: { kind: string; x: number; y: number }): boolean => k.kind === 'autoDrill' && k.y === lode.top - 2 && k.x >= lode.x0 && k.x <= lode.x0 + 1;
  return f.entities().some((e) => e.plane === 'mine' && on(e)) || f.ghosts().some(on);
}

/** The world this reads (WorldApi's terrain, meta and factory; read-only). */
export interface AccessWorld {
  readonly terrain: TerrainGrid;
  readonly meta: { readonly scriptedLodeId: number };
  readonly factory: FactoryApi | null;
}

/**
 * A downward chevron in the xy plane, centred: six points (outer top-left, inner top-left, inner notch, inner
 * top-right, outer top-right, tip) for an arm width `w`, top and tip heights and a horizontal arm thickness `t`.
 */
function chevronPoints(w: number, top: number, tip: number, t: number): number[] {
  const notch = top + (tip - top) * ((w - t) / w);
  return [-w, top, -w + t, top, 0, notch, w - t, top, w, top, 0, tip];
}

/**
 * Chevron decal: a plum ink rim under an orange fill (hfFill 0 / 1), two quads (arms) each. x, y are view-space
 * offsets (screen right, up) from the cell's face centre; z is the lift toward the camera.
 */
function chevronGeometry(): BufferGeometry {
  const pos: number[] = [];
  const fill: number[] = [];
  const layers: [number[], number, number][] = [
    [chevronPoints(0.39, 0.22, -0.25, 0.28), INK_LIFT, 0],
    [chevronPoints(0.32, 0.17, -0.17, 0.16), FILL_LIFT, 1],
  ];
  // Arms as quads (outer top, inner top, notch, tip): left 0-1-2-5, right 5-2-3-4.
  const quads = [
    [0, 1, 2, 5],
    [5, 2, 3, 4],
  ];
  for (const [p, z, f] of layers) {
    for (const [a, b, c, d] of quads) {
      for (const i of [a, d, c, a, c, b]) {
        pos.push(p[i * 2], p[i * 2 + 1], z);
        fill.push(f);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('hfFill', new BufferAttribute(new Float32Array(fill), 1));
  return g;
}

function chevronMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-access-chevron',
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 1 },
      uSteps: { value: 0 },
      uFill: { value: new Color(ROLE.extraction) },
      uHot: { value: new Color(ROLE.chevron) },
      uInk: { value: new Color(UI.ink) },
    },
    vertexShader: /* glsl */ `
attribute float hfFill;
varying float vFill;
varying float vRow;
void main() {
  // Screen-aligned at the cell's face centre (the instance translation): a down arrow at every camera angle.
  vec4 anchor = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 mv = viewMatrix * anchor;
  mv.xyz += position;
  vFill = hfFill;
  vRow = -anchor.y;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform float uPulse;
uniform float uSteps;
uniform vec3 uFill;
uniform vec3 uHot;
uniform vec3 uInk;
varying float vFill;
varying float vRow;
void main() {
  // ${ACCESS_PULSE_HZ} Hz, each cell a little later than the one above: the pulse runs down the column.
  float p = 0.5 + 0.5 * sin(6.28318 * (uTime * ${ACCESS_PULSE_HZ.toFixed(1)} - vRow / ${PULSE_ROWS_PER_CYCLE.toFixed(1)}));
  if (uSteps > 0.5) p = floor(p * uSteps + 0.5) / uSteps;
  // Held (reduced motion): mid-pulse, fully opaque.
  p = mix(0.5, p, uPulse);
  float a = mix(1.0, 0.72 + 0.28 * p, uPulse);
  // A light, hot orange (orange rock is common up top), brightening toward chevron cream on each beat.
  vec3 c = mix(uInk, mix(uFill, uHot, 0.15 + 0.45 * p), vFill);
  gl_FragColor = vec4(c, (vFill > 0.5 ? 0.97 : 0.9) * a);
  #include <colorspace_fragment>
}`,
  });
}

/** Mustard survey stake with an orange pennant, standing on the Rim (origin at its foot, sunk 0.12 into it). */
function postGeometry(): BufferGeometry {
  const g = new GeometryBuilder();
  g.add(box(0.085, 1.0, 0.085), ROLE.logistics, at(0, 0.38, 0), 0.25);
  g.add(box(0.12, 0.06, 0.12), shadeHex(ROLE.logistics, 0.72), at(0, 0.9, 0));
  g.add(box(0.28, 0.17, 0.025), ROLE.extraction, at(0.18, 0.76, 0));
  g.add(box(0.087, 0.05, 0.087), UI.ink, at(0, 0.6, 0));
  return g.build();
}

export class AccessChevrons {
  readonly root = new Group();
  /** The post: a tagged model mesh (render-core swaps in the look materials; see renderer.modelRoots). */
  readonly post: Mesh;
  private readonly marks: InstancedMesh;
  private readonly mat = chevronMaterial();
  private readonly rows: number[] = [];
  private readonly m = new Matrix4();
  private grid: TerrainGrid | null = null;
  private lodes: readonly Lode[] | null = null;
  private lode: Lode | null = null;
  private stamp = -1;
  private topo = -1;
  private moot = false;

  constructor() {
    this.root.name = 'access-chevrons';
    this.marks = new InstancedMesh(chevronGeometry(), this.mat, ACCESS_MAX);
    this.marks.name = 'access-chevron-marks';
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.layers.set(LAYER_LATE);
    // After the terrain and glows, before the factory's build overlays.
    this.marks.renderOrder = 4;
    this.post = roleMesh(postGeometry(), 'solid', 'access-post');
    this.marks.visible = false;
    this.post.visible = false;
    this.root.add(this.marks, this.post);
  }

  /** Pixel Lab steps the pulse (its hard ramp); Toon eases it. */
  setLook(look: Look): void {
    this.mat.uniforms.uSteps.value = look === 'pixel' ? PIXEL_PULSE_STEPS : 0;
  }

  /** Chevrons and post for this frame. `pulse` false (reduced motion): they hold steady. */
  update(world: AccessWorld, timeMs: number, pulse: boolean): void {
    const grid = world.terrain;
    if (grid !== this.grid || grid.lodes !== this.lodes) {
      this.grid = grid;
      this.lodes = grid.lodes;
      this.lode = grid.lodes.find((l) => l.id === world.meta.scriptedLodeId) ?? null;
      this.stamp = -1;
      this.topo = -1;
    }
    const lode = this.lode;
    const f = world.factory;
    // Onboarding hint (MVP scope, a factory to build): only for a discovered scripted lode.
    if (!lode || !f || !lode.discovered) return this.show(false);
    if (f.topologyVersion !== this.topo) {
      this.topo = f.topologyVersion;
      this.moot = drillOnLode(f, lode);
    }
    if (this.moot) return this.show(false);
    const stamp = accessStamp(grid, lode);
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      this.rebuild(grid, lode);
    }
    this.show(this.marks.count > 0);
    const u = this.mat.uniforms;
    u.uTime.value = (timeMs / 1000) % 3600;
    u.uPulse.value = pulse ? 1 : 0;
  }

  /** Instanced chevrons currently drawn (tests, budget reports). */
  get count(): number {
    return this.marks.visible ? this.marks.count : 0;
  }

  /** Make the meshes visible for a compile pass (the decal program compiles behind the loader). */
  setCompileVisible(on: boolean): void {
    if (on) {
      this.marks.userData.hfWasVisible = this.marks.visible;
      this.post.userData.hfWasVisible = this.post.visible;
      this.marks.visible = this.post.visible = true;
      return;
    }
    this.marks.visible = this.marks.userData.hfWasVisible === true;
    this.post.visible = this.post.userData.hfWasVisible === true;
  }

  dispose(): void {
    this.marks.geometry.dispose();
    this.post.geometry.dispose();
    this.mat.dispose();
  }

  private show(on: boolean): void {
    this.marks.visible = on;
    this.post.visible = on;
  }

  private rebuild(grid: TerrainGrid, lode: Lode): void {
    const rows = accessRows(grid, lode, this.rows);
    const x = accessColumn(lode) + 0.5;
    const n = Math.min(ACCESS_MAX, rows.length);
    for (let i = 0; i < n; i++) {
      this.m.makeTranslation(x, -(rows[i] + 0.5), FRONT_Z);
      this.marks.setMatrixAt(i, this.m);
    }
    this.marks.count = n;
    this.marks.instanceMatrix.needsUpdate = true;
    // The post stands on the Rim at the mouth's left front corner, clear of the pod's path down the column.
    this.post.position.set(accessColumn(lode) - 0.1, 0, FRONT_Z - 0.16);
    this.post.updateMatrix();
  }
}

// Gameplay overlays drawn after the opaque scene: the explosive arming preview (canon §3.12: footprint
// + 250 ms ring around the pod), the build ring chip beside the pod while it completes a ghost job (03 §3.5;
// canon §4.8: a sweep that fills over the 1.0 s hold, or a stalled ⊘ while the job is refused) and the pod's
// blob shadow (03 §8.9: #3B2233 at α 0.35).
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { T } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';
import { UI } from './palette';
import { LAYER_LATE } from './materials';
import { FRONT_Z } from './terrain/mesher';

const FOOT_Z = FRONT_Z + 0.03;
const RING_Z = 0.62;
const BAR = 0.09;
/** Build ring chip: size and offset from the pod centre (up and to the right, clear of the hull and the bit). */
export const BUILD_RING_SIZE = 0.74;
const BUILD_RING_DX = 0.9;
const BUILD_RING_DY = 0.66;
/** Stalled ring: dash count around the band. */
const STALL_DASHES = 10;
const SHADOW_HEX = 0x3b2233;
const SHADOW_ALPHA = 0.35;
const SHADOW_REACH = 6;

function ringMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-arming-ring',
    transparent: true,
    depthWrite: false,
    uniforms: { uProgress: { value: 0 }, uColor: { value: new Color(UI.amber) }, uInk: { value: new Color(UI.ink) } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uProgress;
uniform vec3 uColor;
uniform vec3 uInk;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0 || r < 0.62) discard;
  // Clockwise from 12 o'clock.
  float a = atan(vUv.x, vUv.y);
  float t = (a < 0.0 ? a + 6.28318 : a) / 6.28318;
  bool filled = t <= uProgress;
  bool rim = r > 0.92 || r < 0.7;
  vec3 c = rim ? uInk : (filled ? uColor : uInk);
  gl_FragColor = vec4(c, rim ? 0.85 : (filled ? 0.95 : 0.35));
  #include <colorspace_fragment>
}`,
  });
}

/**
 * Build ring chip (03 §3.5): a cream disc in a plum rim whose band fills clockwise in teal as the job's hold
 * counts. Stalled (uStalled = 1; the job is refused, PLAYER-6): nothing fills; the band is a static ring of red
 * dashes and the disc carries a red ⊘ slash, so the hold reads as waiting on the player, not as slow progress.
 */
function buildRingMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'hf-build-ring',
    transparent: true,
    depthWrite: false,
    uniforms: {
      uProgress: { value: 0 },
      uStalled: { value: 0 },
      uFill: { value: new Color(UI.good) },
      uStall: { value: new Color(UI.danger) },
      uInk: { value: new Color(UI.ink) },
      uCream: { value: new Color(UI.cream) },
    },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uProgress;
uniform float uStalled;
uniform vec3 uFill;
uniform vec3 uStall;
uniform vec3 uInk;
uniform vec3 uCream;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  // Clockwise from 12 o'clock.
  float a = atan(vUv.x, vUv.y);
  float t = (a < 0.0 ? a + 6.28318 : a) / 6.28318;
  vec3 c = uCream;
  float alpha = 0.94;
  if (r > 0.88 || (r > 0.56 && r < 0.62)) {
    c = uInk;
  } else if (r > 0.62) {
    if (uStalled > 0.5) {
      bool dash = fract(t * ${STALL_DASHES}.0) < 0.55;
      c = dash ? uStall : uCream;
      alpha = dash ? 0.96 : 0.6;
    } else {
      bool filled = t <= uProgress;
      c = filled ? uFill : mix(uCream, uInk, 0.35);
      alpha = filled ? 0.96 : 0.7;
    }
  } else if (uStalled > 0.5 && abs(vUv.x - vUv.y) * 0.7071 < 0.1) {
    c = uStall;
  }
  gl_FragColor = vec4(c, alpha);
  #include <colorspace_fragment>
}`,
  });
}

export class Overlays {
  readonly root = new Group();
  private readonly footprint: Mesh;
  private readonly footFill: Mesh;
  private readonly ring: Mesh;
  private readonly ringMat: ShaderMaterial;
  private readonly buildRing: Mesh;
  private readonly buildRingMat: ShaderMaterial;
  private readonly shadow: Mesh;
  private readonly shadowMat: MeshBasicMaterial;
  private readonly barPos: Float32Array;

  constructor() {
    this.root.name = 'overlays';
    this.barPos = new Float32Array(16 * 3);
    const barGeom = new BufferGeometry();
    barGeom.setAttribute('position', new BufferAttribute(this.barPos, 3));
    // 4 bars × 2 triangles, CCW toward +z.
    const idx: number[] = [];
    for (let b = 0; b < 4; b++) idx.push(b * 4, b * 4 + 1, b * 4 + 2, b * 4, b * 4 + 2, b * 4 + 3);
    barGeom.setIndex(idx);
    const amber = new MeshBasicMaterial({ color: UI.amber, transparent: true, opacity: 0.95, depthWrite: false, side: DoubleSide });
    this.footprint = new Mesh(barGeom, amber);
    this.footprint.frustumCulled = false;
    this.footFill = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: UI.amber, transparent: true, opacity: 0.16, depthWrite: false }));
    this.ringMat = ringMaterial();
    this.ring = new Mesh(new PlaneGeometry(1.7, 1.7), this.ringMat);
    this.buildRingMat = buildRingMaterial();
    this.buildRing = new Mesh(new PlaneGeometry(BUILD_RING_SIZE, BUILD_RING_SIZE), this.buildRingMat);
    this.buildRing.name = 'build-ring';
    this.shadowMat = new MeshBasicMaterial({ color: SHADOW_HEX, transparent: true, opacity: SHADOW_ALPHA, depthWrite: false });
    this.shadow = new Mesh(new CircleGeometry(0.5, 20), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    for (const m of [this.footprint, this.footFill, this.ring, this.buildRing, this.shadow]) {
      m.renderOrder = 10;
      m.layers.set(LAYER_LATE);
      m.visible = false;
      this.root.add(m);
    }
    this.shadow.renderOrder = 5;
  }

  /** Footprint square of (2R+1) tiles around the pod's cell and a progress ring around the pod. */
  updateArming(arming: { radius: number; progress: number } | null, podX: number, podY: number): void {
    const on = arming !== null && arming.radius > 0;
    this.footprint.visible = on;
    this.footFill.visible = on;
    this.ring.visible = arming !== null;
    if (!arming) return;
    this.ring.position.set(podX, podY, RING_Z);
    this.ringMat.uniforms.uProgress.value = Math.max(0, Math.min(1, arming.progress));
    if (!on) return;
    const cx = Math.floor(podX);
    const cr = Math.floor(-podY);
    const R = arming.radius;
    const x0 = cx - R, x1 = cx + R + 1;
    const y1 = -(cr - R), y0 = -(cr + R + 1);
    this.setBar(0, x0, y1 - BAR, x1, y1);
    this.setBar(1, x0, y0, x1, y0 + BAR);
    this.setBar(2, x0, y0, x0 + BAR, y1);
    this.setBar(3, x1 - BAR, y0, x1, y1);
    const attr = this.footprint.geometry.getAttribute('position') as BufferAttribute;
    attr.needsUpdate = true;
    this.footFill.position.set((x0 + x1) / 2, (y0 + y1) / 2, FOOT_Z - 0.005);
    this.footFill.scale.set(x1 - x0, y1 - y0, 1);
  }

  /**
   * Build ring chip beside the pod while it completes a ghost job (WorldApi.ghostProgress): the sweep fills with
   * `progress`; a non-null `blocked` draws it stalled instead (PLAYER-6). Null hides it.
   */
  updateBuildRing(job: { progress: number; blocked?: unknown } | null, podX: number, podY: number): void {
    this.buildRing.visible = job !== null;
    if (!job) return;
    this.buildRing.position.set(podX + BUILD_RING_DX, podY + BUILD_RING_DY, RING_Z);
    const u = this.buildRingMat.uniforms;
    const stalled = job.blocked !== null && job.blocked !== undefined;
    u.uStalled.value = stalled ? 1 : 0;
    u.uProgress.value = stalled ? 0 : Math.max(0, Math.min(1, job.progress));
  }

  /** Build ring state for tests: hidden, or its stalled flag and sweep. */
  get buildRingState(): { stalled: boolean; progress: number } | null {
    if (!this.buildRing.visible) return null;
    const u = this.buildRingMat.uniforms;
    return { stalled: u.uStalled.value === 1, progress: u.uProgress.value as number };
  }

  /** Blob shadow on the first solid cell top below the pod, fading with height. */
  updateShadow(grid: TerrainGrid, podX: number, podY: number): void {
    const col = Math.floor(podX);
    let groundY = Number.NaN;
    const startRow = Math.floor(-podY);
    for (let r = Math.max(0, startRow); r <= startRow + SHADOW_REACH; r++) {
      if (grid.get(col, r) !== T.AIR) {
        groundY = -r;
        break;
      }
    }
    if (podY > 0 && Number.isNaN(groundY) && grid.get(col, 0) !== T.AIR) groundY = 0;
    const h = podY - groundY;
    if (Number.isNaN(groundY) || h < 0 || h > SHADOW_REACH) {
      this.shadow.visible = false;
      return;
    }
    const k = 1 - h / SHADOW_REACH;
    this.shadow.visible = true;
    this.shadow.position.set(podX, groundY + 0.012, -0.2);
    const s = 0.75 + 0.35 * k;
    this.shadow.scale.set(s * 1.1, s * 0.85, 1);
    this.shadowMat.opacity = SHADOW_ALPHA * k;
  }

  /** Make every overlay visible for a compile pass (their programs compile behind the loader, not mid-play). */
  setCompileVisible(on: boolean): void {
    for (const m of [this.footprint, this.footFill, this.ring, this.buildRing, this.shadow]) {
      const data = m.userData as { hfWasVisible?: boolean };
      if (on) {
        data.hfWasVisible = m.visible;
        m.visible = true;
      } else if (data.hfWasVisible !== undefined) {
        m.visible = data.hfWasVisible;
        delete data.hfWasVisible;
      }
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        (o.material as MeshBasicMaterial | ShaderMaterial).dispose();
      }
    });
  }

  private setBar(i: number, x0: number, y0: number, x1: number, y1: number): void {
    const p = this.barPos;
    const o = i * 12;
    p[o] = x0; p[o + 1] = y0; p[o + 2] = FOOT_Z;
    p[o + 3] = x1; p[o + 4] = y0; p[o + 5] = FOOT_Z;
    p[o + 6] = x1; p[o + 7] = y1; p[o + 8] = FOOT_Z;
    p[o + 9] = x0; p[o + 10] = y1; p[o + 11] = FOOT_Z;
  }
}

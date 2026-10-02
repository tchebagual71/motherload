// Ore and relic glow halos (03 §8.4 emissive codes; §9.2 Toon "halo sprites", §9.3 Pixel Lab "dithered
// halo discs"): one additive instanced draw fed from the glow sources the mesher records per chunk.
// Halos scale with the darkness of their row (1 − ambient), so they read deep and vanish at the surface.
import { AdditiveBlending, Color, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, ShaderMaterial, type Vector2 } from 'three';
import type { Look } from '../shared/types';
import { LAYER_LATE } from './materials';
import { ambientAt } from './palette';
import type { ChunkMeshes } from './terrain/chunks';
import { FRONT_Z } from './terrain/mesher';
import type { CellRect } from './terrain/schedule';

const MAX_GLOWS = 160;
const GLOW_Z = FRONT_Z + 0.015;
const BASE_SIZE = 1.25;
const SIZE_PER_EMISSIVE = 1.0;
const INTENSITY = 1.1;

/** `dither`: the shared world-frame Bayer phase (HfUniforms.uHfDitherWorld); halos are world-fixed. */
function glowMaterial(pixel: boolean, dither: { value: Vector2 }): ShaderMaterial {
  return new ShaderMaterial({
    name: `hf-glow-${pixel ? 'pixel' : 'toon'}`,
    defines: pixel ? { PIXEL_LAB: '' } : {},
    uniforms: pixel ? { uDither: dither } : {},
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
attribute vec4 aGlow;
varying vec4 vGlow;
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vGlow = aGlow;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
varying vec4 vGlow;
varying vec2 vUv;
#ifdef PIXEL_LAB
uniform vec2 uDither;
float bayer(vec2 p) {
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 q = ivec2(mod(floor(p), 4.0));
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}
#endif
void main() {
  float r = length(vUv);
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  a = a * a * vGlow.a;
  #ifdef PIXEL_LAB
  a = floor(a * 4.0 + bayer(gl_FragCoord.xy + uDither)) / 4.0;
  #endif
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vGlow.rgb, a);
}`,
  });
}

export class OreGlows {
  readonly mesh: InstancedMesh;
  private readonly glow: InstancedBufferAttribute;
  private readonly materials: Record<Look, ShaderMaterial>;
  private readonly colour = new Color();
  private count = 0;
  private ambientFloor = 0;
  private readonly visit = (x: number, y: number, hex: number, emissive: number): void => this.add(x, y, hex, emissive);

  constructor(look: Look, dither: { value: Vector2 }) {
    this.materials = { toon: glowMaterial(false, dither), pixel: glowMaterial(true, dither) };
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), this.materials[look], MAX_GLOWS);
    this.mesh.name = 'ore-glows';
    this.glow = new InstancedBufferAttribute(new Float32Array(MAX_GLOWS * 4), 4);
    this.mesh.geometry.setAttribute('aGlow', this.glow);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER_LATE);
    this.mesh.count = 0;
    // Identity-ish matrices: only translation and uniform scale are written per instance.
    const m = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < MAX_GLOWS; i++) m[i * 16 + 10] = m[i * 16 + 15] = 1;
  }

  setLook(look: Look): void {
    this.mesh.material = this.materials[look];
  }

  materialFor(look: Look): ShaderMaterial {
    return this.materials[look];
  }

  /** Rebuild the instance list from the resident chunks overlapping the view. */
  update(chunks: ChunkMeshes, view: CellRect, ambientFloor: number): void {
    this.count = 0;
    this.ambientFloor = ambientFloor;
    chunks.forEachGlow(view, this.visit);
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glow.clearUpdateRanges();
    this.glow.addUpdateRange(0, this.count * 4);
    this.glow.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.materials.toon.dispose();
    this.materials.pixel.dispose();
  }

  private add(x: number, y: number, hex: number, emissive: number): void {
    if (this.count >= MAX_GLOWS) return;
    const dark = 1 - Math.max(this.ambientFloor, ambientAt(Math.floor(-y)));
    if (dark <= 0.05) return;
    const i = this.count++;
    const s = BASE_SIZE + SIZE_PER_EMISSIVE * emissive;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const o = i * 16;
    m[o] = s;
    m[o + 5] = s;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = GLOW_Z;
    const c = this.colour.setHex(hex);
    const g = this.glow.array as Float32Array;
    g[i * 4] = c.r;
    g[i * 4 + 1] = c.g;
    g[i * 4 + 2] = c.b;
    g[i * 4 + 3] = Math.min(1, emissive * dark * INTENSITY);
  }
}

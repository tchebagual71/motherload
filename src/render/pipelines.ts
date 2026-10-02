// The two looks' render paths (04 §5.7, canon §5.1).
// Clean Toon: the context has antialias: false (M0 keeps both looks resident), so Toon renders into an
//   MSAA-4 sRGB target at DPR min(device, 2) and a bilinear blit (with the vignette) resolves to the
//   canvas. When the context itself is antialiased (production Toon), it renders straight to the canvas.
// Pixel Lab: 1 opaque → RT_A (colour + view normal MRT, DepthTexture); 2 edge pass → RT_B, copying
//   depth via gl_FragDepth; 3 transparent/additive → RT_B; 4 nearest blit at k device px per texel,
//   offset by the sub-texel remainder in whole device px.
import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  DepthTexture,
  LinearFilter,
  Mesh,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  UnsignedIntType,
  WebGLRenderTarget,
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import { LAYER_LATE, LAYER_MAIN } from './materials';
import { createEdgeMaterial, createPixelBlitMaterial, createToonBlitMaterial } from './materials/passes';

const CLEAR = 0x2b1e2f;
const MSAA_SAMPLES = 4;

/** A full-screen triangle and its own scene/camera. */
export class FullscreenPass {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly mesh: Mesh;

  constructor(material: ShaderMaterial) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  get material(): ShaderMaterial {
    return this.mesh.material as ShaderMaterial;
  }

  render(renderer: WebGLRenderer, target: WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  /** Compile the pass program for the target it will draw into (output colour space is per target). */
  compile(renderer: WebGLRenderer, target: WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.compile(this.scene, this.camera);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

function setCameraLayers(camera: Camera, mask: number): void {
  camera.layers.mask = mask;
}

const MASK_MAIN = 1 << LAYER_MAIN;
const MASK_LATE = 1 << LAYER_LATE;
const MASK_ALL = MASK_MAIN | MASK_LATE;
/** Camera layer masks of every scene pass (Toon; Pixel Lab passes 1 and 3), e.g. for light-set checks. */
export const PASS_MASKS: readonly number[] = [MASK_ALL, MASK_MAIN, MASK_LATE];

export class ToonPipeline {
  /** Null when rendering straight to an antialiased canvas. */
  target: WebGLRenderTarget | null = null;
  private readonly blit = new FullscreenPass(createToonBlitMaterial());

  private readonly direct: boolean;

  constructor(direct: boolean) {
    this.direct = direct;
  }

  /** Render size in device pixels of the Toon image. */
  resize(width: number, height: number): void {
    if (this.direct) return;
    if (this.target && this.target.width === width && this.target.height === height) return;
    this.target?.dispose();
    const rt = new WebGLRenderTarget(width, height, { samples: MSAA_SAMPLES, depthBuffer: true });
    rt.texture.colorSpace = SRGBColorSpace;
    rt.texture.minFilter = LinearFilter;
    rt.texture.magFilter = LinearFilter;
    rt.texture.generateMipmaps = false;
    this.target = rt;
    this.blit.material.uniforms.tSrc.value = rt.texture;
  }

  get blitMaterial(): ShaderMaterial {
    return this.blit.material;
  }

  /** Drop the GPU target so the next resize() recreates it (context restore). */
  invalidate(): void {
    this.target?.dispose();
    this.target = null;
  }

  compilePasses(renderer: WebGLRenderer): void {
    if (this.target) this.blit.compile(renderer, null);
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, vignette: number, aspect: number): void {
    setCameraLayers(camera, MASK_ALL);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(CLEAR, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    if (!this.target) return;
    const u = this.blit.material.uniforms;
    u.uVignette.value = vignette;
    u.uAspect.value = aspect;
    this.blit.render(renderer, null);
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.blit.dispose();
  }
}

export class PixelPipeline {
  rtA: WebGLRenderTarget | null = null;
  rtB: WebGLRenderTarget | null = null;
  private readonly edge = new FullscreenPass(createEdgeMaterial());
  private readonly blit = new FullscreenPass(createPixelBlitMaterial());

  get width(): number {
    return this.rtA?.width ?? 0;
  }
  get height(): number {
    return this.rtA?.height ?? 0;
  }

  /** RT size in texels (fixed per viewport). */
  resize(w: number, h: number): void {
    if (this.rtA && this.rtA.width === w && this.rtA.height === h) return;
    this.disposeTargets();
    const a = new WebGLRenderTarget(w, h, {
      count: 2,
      depthBuffer: true,
      depthTexture: new DepthTexture(w, h, UnsignedIntType),
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });
    a.textures[0].colorSpace = SRGBColorSpace;
    a.textures[1].colorSpace = NoColorSpace;
    const b = new WebGLRenderTarget(w, h, { depthBuffer: true, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false });
    b.texture.colorSpace = SRGBColorSpace;
    this.rtA = a;
    this.rtB = b;
    const eu = this.edge.material.uniforms;
    eu.tColor.value = a.textures[0];
    eu.tNormal.value = a.textures[1];
    eu.tDepth.value = a.depthTexture;
    this.blit.material.uniforms.tSrc.value = b.texture;
  }

  get materials(): ShaderMaterial[] {
    return [this.edge.material, this.blit.material];
  }

  /** Drop the GPU targets so the next resize() recreates them (context restore). */
  invalidate(): void {
    this.disposeTargets();
  }

  compilePasses(renderer: WebGLRenderer): void {
    if (!this.rtB) return;
    this.edge.compile(renderer, this.rtB);
    this.blit.compile(renderer, null);
  }

  /** Render the four passes. `offX/offY` are whole device px; `k` device px per texel. */
  render(renderer: WebGLRenderer, scene: Scene, camera: OrthographicCamera | PerspectiveCamera, k: number, offX: number, offY: number, vignette: number): void {
    if (!this.rtA || !this.rtB) return;
    // 1. Opaque → RT_A (MRT colour + normal, depth texture).
    setCameraLayers(camera, MASK_MAIN);
    renderer.setRenderTarget(this.rtA);
    renderer.setClearColor(CLEAR, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    // 2. Edge pass → RT_B (writes colour and depth).
    const eu = this.edge.material.uniforms;
    eu.uNear.value = camera.near;
    eu.uFar.value = camera.far;
    eu.uOrtho.value = camera instanceof OrthographicCamera ? 1 : 0;
    this.edge.render(renderer, this.rtB);
    // 3. Transparent/additive → RT_B (depth-tested against the copied depth).
    setCameraLayers(camera, MASK_LATE);
    renderer.setRenderTarget(this.rtB);
    renderer.render(scene, camera);
    setCameraLayers(camera, MASK_ALL);
    // 4. Nearest blit to the canvas.
    const bu = this.blit.material.uniforms;
    bu.uK.value = k;
    bu.uOffset.value.set(offX, offY);
    bu.uVignette.value = vignette;
    this.blit.render(renderer, null);
  }

  dispose(): void {
    this.disposeTargets();
    this.edge.dispose();
    this.blit.dispose();
  }

  private disposeTargets(): void {
    this.rtA?.depthTexture?.dispose();
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.rtA = null;
    this.rtB = null;
  }
}

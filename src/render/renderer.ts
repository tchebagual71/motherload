// Render core (04 §5, canon D4/D5, §3.4, §5.1): classic WebGLRenderer (WebGL2), the two looks, chunked
// slab, surface diorama, models/FX integration, camera rig, picking, quality tiers and context loss.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type ShaderMaterial,
} from 'three';
import { CAMERA, FACTORY_EVERY, FACTORY_PHASE, MINE_H, MINE_W, POD_H, RIM_BUILDINGS, SEAL_ROW, YARD_D_START } from '../shared/canon';
import type { Cell, FactoryApi, Plane as BuildPlane, ViewRect } from '../factory/api';
import type { GameEvent } from '../shared/events';
import { F, type Look, type Lode, type RimBuildingId, type Scope } from '../shared/types';
import { isLodeVisible, scopeFloorRow } from '../terrain/scope';
import type { TerrainGrid } from '../terrain/grid';
import type { WorldApi } from '../world/api';
import type { BuildCamera, CreateRenderer, QualityTier, RenderFrame, RenderInfo, Renderer, RendererOptions, ViewportLayout } from './api';
import { CameraRig, DEG, DigDescentTracker, bayerPhase, composeLookAt, pixelScaleK, pixelTargetSize, quantizeDeg, snapPixelPpu, snapToTexels, type CameraPose, type TexelSnap, type Vec3 } from './camera';
import { ITEM_CAP, FactoryView, type FactoryFrame } from './factory/view';
import {
  BuildCameraRig,
  cellCentreWorld,
  copyPose,
  mineCellOf,
  newPose,
  planeViewRect,
  projectToScreen,
  screenRay,
  screenToMinePoint,
  screenToYardPoint,
  snapBuildPixelPose,
  yardCellOf,
} from './factory/projection';
import { GHOST_EDGE_PX } from './factory/overlayMaterials';
import { createFx } from './fx/fx';
import { addOutlineHulls, applyLookMaterials, disposeMaterialKit, getMaterialKit, setHullsEnabled, setLayerDeep, syncHull, LAYER_LATE, type MaterialKit } from './materials';
import type { FxSystem, PodModel, PodVisualState, RimBuildingsModel, YardPropsModel } from './models/api';
import { createPodModel, nextFastFall } from './models/pod';
import { createRimBuildings } from './models/rim';
import { createYardProps } from './models/yard';
import { OreGlows } from './glows';
import { Overlays } from './overlay';
import { AMBIENT_FLOOR, BRIGHT_MINES_AMBIENT, LIGHT, SURFACE } from './palette';
import { PixelPipeline, ToonPipeline } from './pipelines';
import { QUALITY, REMESH_NEAR_POD, meshOreHulls, oreHullsEnabled, outlineScope, toonDpr, type OutlineScope } from './quality';
import { Surface } from './surface';
import { ChunkMeshes, LAMP_RADII } from './terrain/chunks';
import type { MesherOptions } from './terrain/mesher';
import type { CellRect } from './terrain/schedule';
import { sunDirection } from './materials/uniforms';

const CAMERA_DIST = 120;
const ORTHO_NEAR = 1;
const ORTHO_FAR = 420;
const PIXEL_ANGLE_STEP = 2.5;
const DEFAULT_SURVEY_COLUMN = 23;
const MAX_FRAME_DT = 0.1;
const VIGNETTE = [0.15, 0.3] as const;
const SIGN_HIT_PT = 30;
/** The painted backdrop stands this far behind the look-at point (sets where the horizon sits). */
const BACKDROP_DIST = 15;
/** Cells of margin around the camera rect for factory culling (moving pieces cross at most a tile per tick). */
const FACTORY_VIEW_MARGIN = 2;
/** Working Smelters that smoke, per tier (03 §8.10: off above 12 / 16 / 20 machines). */
const SMOKE_CAP: Readonly<Record<QualityTier, number>> = { low: 12, mid: 16, high: 20 };
/** Logistics overlay: terrain shown at 30% (03 §4.10), faded in and out over 0.2 s. */
const LOGISTICS_TERRAIN = 0.3;
const OVERLAY_FADE_S = 0.2;

const CONE_DIRS = { down: [0, -1], left: [-1, 0], right: [1, 0] } as const;
const SLAB_PLANES = [0.5, -1] as const;
const UNIT_SIGNS = [-1, 1] as const;

/** The survey column: F.SURVEY flags in row 1 (canon §3.2 pass 5), else the default. */
export function findSurveyColumn(grid: TerrainGrid): number {
  for (let x = 0; x < MINE_W; x++) if (grid.hasFlag(x, 1, F.SURVEY)) return x;
  return DEFAULT_SURVEY_COLUMN;
}

/** Rows ≥ this draw the scope floor overlay; the real Seal (v1) needs none. */
function overlayFloorRow(scope: Scope): number {
  const row = scopeFloorRow(scope);
  return row < SEAL_ROW ? row : MINE_H;
}

class HfRenderer implements Renderer {
  private readonly gl: WebGLRenderer;
  private readonly kit: MaterialKit;
  private readonly scene = new Scene();
  private readonly orthoCam = new OrthographicCamera(-1, 1, 1, -1, ORTHO_NEAR, ORTHO_FAR);
  private readonly pixelCam = new OrthographicCamera(-1, 1, 1, -1, ORTHO_NEAR, ORTHO_FAR);
  private readonly perspCam: PerspectiveCamera | null;
  private readonly rig = new CameraRig();
  private readonly digDescent = new DigDescentTracker();
  private readonly chunks: ChunkMeshes;
  private readonly surface: Surface;
  private readonly overlays = new Overlays();
  private readonly glows: OreGlows;
  private readonly pod: PodModel;
  private readonly rim: RimBuildingsModel;
  private readonly fx: FxSystem;
  private yard: YardPropsModel | null = null;
  private yardColumn = -1;
  /** Factory pieces from the world's factory views (MVP+); hidden while the world has no factory. */
  private readonly factoryView: FactoryView;
  /** Build cameras over the play rig (canon §3.4; 03 §5). */
  private readonly buildRig = new BuildCameraRig();
  /** The pose last placed on the cameras: picking and projections use exactly what is on screen. */
  private readonly shownPose: CameraPose = newPose();
  private readonly yardRect: ViewRect = { plane: 'yard', x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly mineRect: ViewRect = { plane: 'mine', x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly pickPt = { x: 0, y: 0 };
  /** Reused per frame (no per-frame allocation); factory set before first use. */
  private readonly factoryFrame: FactoryFrame = {
    factory: null as unknown as FactoryApi,
    grid: null as unknown as TerrainGrid,
    timeMs: 0,
    dt: 0,
    alphaF: 0,
    pose: newPose(),
    yardRect: null,
    mineRect: null,
    build: null,
    ghostProgress: null,
    texel: 0,
    animate: true,
    itemCap: 0,
    smokeCap: 0,
  };
  private readonly rayO: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly rayD: Vec3 = { x: 0, y: 0, z: 0 };
  /** Outline hulls to keep in step with their meshes (pod/rim; the yard's are rebuilt with it). */
  private readonly hulls: Mesh[] = [];
  private yardHulls: Mesh[] = [];
  private readonly toon: ToonPipeline;
  private readonly pixel = new PixelPipeline();
  private readonly directToon: boolean;
  private readonly precompileBoth: boolean;
  private look: Look;
  private quality: QualityTier;
  private layout: ViewportLayout;
  private k = 1;
  private toonScale = 1;
  private readonly device = { w: 1, h: 1 };
  private readonly snap: TexelSnap = { dRight: 0, dUp: 0, offX: 0, offY: 0 };
  /** Texel-snapped look-at of the Pixel Lab camera, and its texel size (world units per RT pixel). */
  private readonly pixelLook = { x: 0, y: 0, z: 0 };
  private texel = 1;
  /** Dynamic-resolution Toon DPR from the frame (null = the tier cap). */
  private dynamicDpr: number | null = null;
  /** Particle budget last handed to FX (tier × battery/reduced-motion share). */
  private fxBudget = -1;
  /** First row the scope floor hides (MINE_H = none): chunks below it + 1 are never made resident. */
  private viewFloor = MINE_H;
  private readonly infoData: RenderInfo;
  private lost = false;
  private lastTimeMs = Number.NaN;
  private world: WorldApi | null = null;
  private grid: TerrainGrid | null = null;
  private mesherOpts: MesherOptions | null = null;
  private readonly view: CellRect = { x0: 0, x1: 0, r0: 0, r1: 0 };
  private readonly visual: PodVisualState;
  private readonly magmaColor = new Color(LIGHT.magma);
  private readonly thrustColor = new Color(LIGHT.thrust);
  private readonly raycaster = new Raycaster();
  private readonly slabPlane = new Plane(new Vector3(0, 0, 1), -0.5);
  private readonly tmpV2 = new Vector2();
  private readonly tmpV3 = new Vector3();
  private readonly tmpV3b = new Vector3();
  private readonly skyToon: ShaderMaterial;
  private readonly skyPixel: ShaderMaterial;
  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
  };
  private readonly onRestored = (): void => {
    this.lost = false;
    this.rebuildGpu();
  };

  constructor(private readonly canvas: HTMLCanvasElement, layout: ViewportLayout, opts: RendererOptions) {
    this.look = opts.look;
    this.quality = opts.quality;
    this.layout = { ...layout };
    this.precompileBoth = opts.precompileBoth;
    // M0 keeps both pipelines resident on an un-antialiased context; production Toon gets native MSAA.
    this.directToon = !opts.precompileBoth && opts.look === 'toon';
    this.gl = new WebGLRenderer({
      canvas,
      antialias: this.directToon,
      alpha: false,
      depth: this.directToon,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.gl.autoClear = false;
    this.gl.info.autoReset = false;
    this.toon = new ToonPipeline(this.directToon);
    this.perspCam = opts.perspective ? new PerspectiveCamera(CAMERA.perspectiveFov, 1, 1, 600) : null;
    this.kit = getMaterialKit();
    this.skyToon = this.kit.sky('toon') as ShaderMaterial;
    this.skyPixel = this.kit.sky('pixel') as ShaderMaterial;
    this.infoData = { drawCalls: 0, triangles: 0, look: this.look, quality: this.quality, pixelScale: 1 };

    this.chunks = new ChunkMeshes(this.kit.terrain(this.look));
    this.glows = new OreGlows(this.look, this.kit.uniforms.uHfDitherWorld);
    this.surface = new Surface(this.kit.terrain(this.look), this.kit.sky(this.look));
    this.pod = createPodModel();
    this.rim = createRimBuildings();
    this.fx = createFx();
    this.hulls.push(...addOutlineHulls(this.pod.root, 'pod', this.kit), ...addOutlineHulls(this.rim.root, 'buildings', this.kit));
    this.factoryView = new FactoryView(this.kit, this.look);
    this.factoryView.root.visible = false;
    this.scene.add(this.surface.root, this.chunks.root, this.glows.mesh, this.rim.root, this.pod.root, this.fx.root, this.overlays.root, this.factoryView.root);
    // Built now (default column) so its instanced variants precompile; rebuilt if the world differs.
    this.setYard(DEFAULT_SURVEY_COLUMN);
    setLayerDeep(this.overlays.root, LAYER_LATE);
    this.addFallbackLights();
    this.visual = {
      x: 0, y: 0, facing: 1, thrust: 0, digging: false, digDir: null, grounded: true, vx: 0, vy: 0,
      tiers: { drill: 1, hull: 1, engine: 1, tank: 1, radiator: 1, bay: 1, scanner: 1 },
      timeMs: 0, fastFall: false,
    };

    this.applyQualityScope();
    this.resize(layout);
    this.applyLook();
    this.precompile();
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
  }

  get info(): RenderInfo {
    return this.infoData;
  }

  get contextLost(): boolean {
    return this.lost;
  }

  // ---- public API --------------------------------------------------------------------------------

  render(frame: RenderFrame): void {
    if (this.lost) return;
    const dt = Number.isNaN(this.lastTimeMs) ? 0 : Math.max(0, Math.min(MAX_FRAME_DT, (frame.timeMs - this.lastTimeMs) / 1000));
    this.lastTimeMs = frame.timeMs;
    this.syncLayout(frame.layout, frame.renderDpr);
    this.ensureWorld(frame.world);
    this.syncFxBudget(frame);
    const world = frame.world;
    const pod = world.pod;
    const a = frame.alpha;
    const px = pod.prevX + (pod.x - pod.prevX) * a;
    const py = pod.prevY + (pod.y - pod.prevY) * a;

    this.handleEvents(frame.events, world.terrain, px, py);
    const pose = this.updateCamera(frame, px, py, dt);
    this.kit.uniforms.uHfAmbientFloor.value = frame.brightMines ? BRIGHT_MINES_AMBIENT : AMBIENT_FLOOR;
    this.updateChunks(world.terrain, px, py);
    this.updateUniforms(frame, pose, px, py);
    this.updateModels(frame, px, py, dt);
    this.updateFactory(frame, pose, dt);
    this.overlays.updateArming(frame.arming, px, py);
    this.overlays.updateShadow(world.terrain, px, py - POD_H / 2);
    this.draw(pose);
  }

  resize(layout: ViewportLayout): void {
    this.layout = { ...layout };
    const { width, height, dpr } = layout;
    const toonD = toonDpr(dpr, this.quality, this.precompileBoth, this.dynamicDpr);
    const canvasDpr = this.directToon && this.look === 'toon' ? toonD : dpr;
    this.gl.setPixelRatio(canvasDpr);
    this.gl.setSize(width, height, false);
    this.device.w = this.canvas.width;
    this.device.h = this.canvas.height;
    this.toonScale = toonD;
    const toonW = Math.max(1, Math.round(width * toonD));
    const toonH = Math.max(1, Math.round(height * toonD));
    if (this.precompileBoth || this.look === 'toon') this.toon.resize(toonW, toonH);
    this.k = pixelScaleK(layout);
    const rt = pixelTargetSize(this.device.w, this.device.h, this.k);
    if (this.precompileBoth || this.look === 'pixel') this.pixel.resize(rt.w, rt.h);
    const u = this.kit.uniforms;
    u.uHfOutlinePx.value = 1.5 * toonD;
    u.uHfResolution.value.set(toonW, toonH);
    if (this.perspCam) this.perspCam.aspect = width / height;
    this.infoData.renderDpr = this.look === 'toon' ? toonD : dpr;
    this.syncGhostEdge();
  }

  /** Ghost outlines (03 §4.3): GHOST_EDGE_PX CSS px in Toon, one low-res texel in Pixel Lab (the target drawn into). */
  private syncGhostEdge(): void {
    if (this.look === 'pixel') this.factoryView.setGhostEdge(1, this.pixel.width, this.pixel.height);
    else this.factoryView.setGhostEdge(GHOST_EDGE_PX * this.toonScale, this.kit.uniforms.uHfResolution.value.x, this.kit.uniforms.uHfResolution.value.y);
  }

  /** Follow the frame's layout: insets/HUD changes re-anchor the camera; size or render-DPR changes resize. */
  private syncLayout(layout: ViewportLayout, renderDpr: number | undefined): void {
    const cur = this.layout;
    const dynamic = renderDpr ?? null;
    if (layout.width !== cur.width || layout.height !== cur.height || layout.dpr !== cur.dpr || dynamic !== this.dynamicDpr) {
      this.dynamicDpr = dynamic;
      this.resize(layout);
      return;
    }
    cur.clearTop = layout.clearTop;
    cur.controlZone = layout.controlZone;
  }

  setLook(look: Look): void {
    if (look === this.look) return;
    this.look = look;
    this.infoData.look = look;
    if (!this.precompileBoth) this.resize(this.layout);
    this.applyLook();
  }

  setQuality(q: QualityTier): void {
    if (q === this.quality) return;
    this.quality = q;
    this.infoData.quality = q;
    this.applyQualityScope();
    this.resize(this.layout);
  }

  worldToScreen(x: number, y: number, z = 0): { x: number; y: number } {
    const v = this.tmpV3.set(x, y, z).project(this.pickCamera());
    return { x: ((v.x + 1) / 2) * this.layout.width, y: ((1 - v.y) / 2) * this.layout.height };
  }

  screenToCell(px: number, py: number): { x: number; r: number } | null {
    const hit = this.pickSlab(px, py);
    if (!hit) return null;
    const x = Math.floor(hit.x);
    const r = Math.floor(-hit.y);
    if (x < 0 || x >= MINE_W || r < 0 || r >= MINE_H) return null;
    return { x, r };
  }

  // ---- Build mode (BuildRendererApi; canon §3.4, 03 §4–5, 04 §6.2) ----------------------------------

  setBuildCamera(cam: BuildCamera | null): void {
    this.buildRig.set(cam, this.shownPose);
    if (cam && this.buildRig.settled) {
      // Pans and zooms apply at once: place the cameras now so picks made before the next frame are exact.
      const pose = this.buildRig.update(0, this.rig.pose);
      if (this.look === 'pixel' && !this.perspCam) this.snapBuildPose(pose);
      this.placeCameras(pose);
      copyPose(pose, this.shownPose);
    }
  }

  screenToYardCell(px: number, py: number): Cell | null {
    if (this.perspCam) {
      this.setRay(px, py);
      const ray = this.raycaster.ray;
      if (Math.abs(ray.direction.y) < 1e-6) return null;
      const t = -ray.origin.y / ray.direction.y;
      if (t < 0) return null;
      return yardCellOf({ x: ray.origin.x + ray.direction.x * t, y: -(ray.origin.z + ray.direction.z * t) });
    }
    return screenToYardPoint(this.shownPose, this.layout, px, py, this.pickPt) ? yardCellOf(this.pickPt) : null;
  }

  screenToMineCell(px: number, py: number): Cell | null {
    if (this.perspCam) {
      const c = this.screenToCell(px, py);
      return c ? { x: c.x, y: c.r } : null;
    }
    return screenToMinePoint(this.shownPose, this.layout, px, py, this.pickPt) ? mineCellOf(this.pickPt) : null;
  }

  cellToScreen(plane: BuildPlane, x: number, y: number): { x: number; y: number } {
    const w = cellCentreWorld(plane, x, y, this.rayO);
    if (this.perspCam) return this.worldToScreen(w.x, w.y, w.z);
    return projectToScreen(this.shownPose, this.layout, w.x, w.y, w.z, { x: 0, y: 0 });
  }

  pickEntity(px: number, py: number): number | null {
    if (!this.world?.factory) return null;
    if (this.perspCam) {
      this.setRay(px, py);
      const r = this.raycaster.ray;
      this.rayO.x = r.origin.x; this.rayO.y = r.origin.y; this.rayO.z = r.origin.z;
      this.rayD.x = r.direction.x; this.rayD.y = r.direction.y; this.rayD.z = r.direction.z;
    } else {
      screenRay(this.shownPose, this.layout, px, py, this.rayO, this.rayD);
    }
    return this.factoryView.pick(this.rayO, this.rayD, this.buildRig.camera?.plane ?? null);
  }

  screenToRimBuilding(px: number, py: number): string | null {
    this.setRay(px, py);
    const hits = this.raycaster.intersectObject(this.rim.root, true);
    for (const h of hits) {
      for (let o: Object3D | null = h.object; o; o = o.parent) {
        const id = (o.userData as { rimId?: string }).rimId;
        if (id) return id;
      }
    }
    // Generous fallback around the signs (≥ 44-pt targets, canon §3.12).
    let best: string | null = null;
    let bestD = SIGN_HIT_PT;
    for (const [id, anchor] of Object.entries(this.rim.signAnchors)) {
      const s = this.worldToScreen(anchor.x, anchor.y, anchor.z);
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.chunks.dispose();
    this.surface.dispose();
    this.overlays.dispose();
    this.factoryView.dispose();
    this.glows.dispose();
    this.toon.dispose();
    this.pixel.dispose();
    this.scene.traverse((o) => {
      const g = (o as { geometry?: { dispose(): void } }).geometry;
      g?.dispose();
    });
    disposeMaterialKit();
    this.gl.dispose();
  }

  // ---- frame steps -------------------------------------------------------------------------------

  /**
   * First frame with a world: mesher options for the scope; factory views when the world hosts a factory (MVP+),
   * else the M0 survey-set props and belt/lift demo for its survey column.
   */
  private ensureWorld(world: WorldApi): void {
    if (this.world === world && this.grid === world.terrain && this.mesherOpts) return;
    this.world = world;
    this.grid = world.terrain;
    const scope = world.scope;
    const floorRow = overlayFloorRow(scope);
    this.viewFloor = floorRow < MINE_H ? floorRow + 1 : MINE_H;
    this.mesherOpts = {
      floorRow,
      lodeVisible: (lode: Lode): boolean => isLodeVisible(lode, scope),
      hulls: meshOreHulls(this.look, this.quality, this.precompileBoth),
    };
    this.chunks.reset();
    this.rig.snap(world.pod.x, world.pod.y);
    this.factoryView.bind(world.factory);
    if (world.factory) {
      // The survey set is real factory entities now (02 §2.2): drop the M0 demo yard.
      this.dropYard();
      return;
    }
    const column = findSurveyColumn(world.terrain);
    if (column !== this.yardColumn || !this.yard) {
      const yard = this.setYard(column);
      applyLookMaterials(yard.root, this.look, this.kit);
      this.applyQualityScope();
    }
  }

  private dropYard(): void {
    if (!this.yard) return;
    this.scene.remove(this.yard.root);
    this.yard.root.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose());
    this.yard = null;
    this.yardHulls = [];
    this.yardColumn = -1;
  }

  private setYard(column: number): YardPropsModel {
    if (this.yard) {
      this.scene.remove(this.yard.root);
      this.yard.root.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose());
    }
    this.yardColumn = column;
    const yard = createYardProps(column);
    this.yard = yard;
    this.yardHulls = addOutlineHulls(yard.root, 'buildings', this.kit);
    this.scene.add(yard.root);
    return yard;
  }

  private handleEvents(events: readonly GameEvent[], grid: TerrainGrid, px: number, py: number): void {
    for (const e of events) {
      this.fx.handle(e, px, py);
      if (e.t === 'explosion') this.chunks.markHot(e.x - e.radius - 1, e.r - e.radius - 1, e.x + e.radius + 1, e.r + e.radius + 1);
      else if (e.t === 'lode-discovered') {
        const lode = grid.lodes.find((l) => l.id === e.lodeId);
        if (lode) this.chunks.forceCells(lode.x0, lode.top, lode.x0 + 2, lode.top + 1);
      } else if (e.t === 'teleport' || e.t === 'respawned') this.rig.snap(px, py);
    }
  }

  private updateCamera(frame: RenderFrame, px: number, py: number, dt: number): CameraPose {
    const pod = frame.world.pod;
    const digDown = this.digDescent.update(pod.dig, pod.y, pod.digging, frame.alpha);
    // While a build camera shows (or tweens), the play rig keeps its play framing: the exit returns to it.
    const building = this.buildRig.active;
    const pose = this.rig.update(
      { podX: px, podY: py, vx: pod.vx, vy: pod.vy, digDown, layout: this.layout, mode: building ? 'play' : frame.mode, touching: frame.touching },
      dt,
    );
    if (this.look === 'pixel' && !this.perspCam) {
      // Pixel Lab: angles step 2.5°, zoom snaps to whole RT px per tile face (03 §9.3).
      pose.yaw = quantizeDeg(pose.yaw, PIXEL_ANGLE_STEP);
      pose.pitch = quantizeDeg(pose.pitch, PIXEL_ANGLE_STEP);
      pose.ppu = snapPixelPpu(pose.ppu, this.layout.dpr, this.k, Math.cos(pose.yaw * DEG));
      composeLookAt(pose, this.rig.focusX, this.rig.focusY, this.layout);
    }
    let shown = pose;
    if (building) {
      shown = this.buildRig.update(dt, pose);
      if (this.look === 'pixel' && !this.perspCam) this.snapBuildPose(shown);
    }
    this.placeCameras(shown);
    copyPose(shown, this.shownPose);
    return shown;
  }

  /**
   * Pixel Lab build cameras (03 §9.3): settled, the zoom rounds UP to whole RT px per tile face (floors hold);
   * tweening, angles step 2.5° and the zoom snaps against the face the rig blends between its two poses.
   */
  private snapBuildPose(p: CameraPose): void {
    snapBuildPixelPose(p, this.buildRig, this.layout.dpr, this.k, PIXEL_ANGLE_STEP);
  }

  private placeCameras(pose: CameraPose): void {
    const { width, height } = this.layout;
    const l = pose.lookAt;
    const d = pose.dir;
    const hw = width / 2 / pose.ppu;
    const hh = height / 2 / pose.ppu;
    const cam = this.orthoCam;
    cam.left = -hw;
    cam.right = hw;
    cam.top = hh;
    cam.bottom = -hh;
    cam.position.set(l.x + d.x * CAMERA_DIST, l.y + d.y * CAMERA_DIST, l.z + d.z * CAMERA_DIST);
    cam.lookAt(l.x, l.y, l.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    if (this.perspCam) {
      const p = this.perspCam;
      const dist = hh / Math.tan((CAMERA.perspectiveFov / 2) * DEG);
      p.near = Math.max(1, dist - 80);
      p.far = dist + 320;
      p.position.set(l.x + d.x * dist, l.y + d.y * dist, l.z + d.z * dist);
      p.lookAt(l.x, l.y, l.z);
      p.updateProjectionMatrix();
      p.updateMatrixWorld();
    }

    if (this.look === 'pixel') {
      const rtW = this.pixel.width;
      const rtH = this.pixel.height;
      const texel = this.k / (pose.ppu * this.layout.dpr);
      this.texel = texel;
      const lookRight = l.x * pose.right.x + l.y * pose.right.y + l.z * pose.right.z;
      const lookUp = l.x * pose.up.x + l.y * pose.up.y + l.z * pose.up.z;
      snapToTexels(lookRight, lookUp, texel, this.k, { w: rtW, h: rtH }, this.device, this.snap);
      const sx = l.x + pose.right.x * this.snap.dRight + pose.up.x * this.snap.dUp;
      const sy = l.y + pose.right.y * this.snap.dRight + pose.up.y * this.snap.dUp;
      const sz = l.z + pose.right.z * this.snap.dRight + pose.up.z * this.snap.dUp;
      this.pixelLook.x = sx;
      this.pixelLook.y = sy;
      this.pixelLook.z = sz;
      const pc = this.pixelCam;
      pc.left = (-rtW / 2) * texel;
      pc.right = (rtW / 2) * texel;
      pc.top = (rtH / 2) * texel;
      pc.bottom = (-rtH / 2) * texel;
      pc.position.set(sx + d.x * CAMERA_DIST, sy + d.y * CAMERA_DIST, sz + d.z * CAMERA_DIST);
      pc.lookAt(sx, sy, sz);
      pc.updateProjectionMatrix();
      pc.updateMatrixWorld();
    }
  }

  /** Cells visible on the slab: the screen corners projected onto z = +0.5 and z = −1. */
  private computeView(): CellRect {
    const cam = this.pickCamera();
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const z of SLAB_PLANES) {
      for (const sx of UNIT_SIGNS) {
        for (const sy of UNIT_SIGNS) {
          this.raycaster.setFromCamera(this.tmpV2.set(sx, sy), cam);
          const ray = this.raycaster.ray;
          const t = (z - ray.origin.z) / ray.direction.z;
          const hx = ray.origin.x + ray.direction.x * t;
          const hy = ray.origin.y + ray.direction.y * t;
          xMin = Math.min(xMin, hx); xMax = Math.max(xMax, hx);
          yMin = Math.min(yMin, hy); yMax = Math.max(yMax, hy);
        }
      }
    }
    const v = this.view;
    v.x0 = Math.max(0, Math.floor(xMin));
    v.x1 = Math.min(MINE_W, Math.ceil(xMax));
    // Below the scope floor everything is sealed band (INT-11): one row past it is all that ever needs meshing.
    v.r0 = Math.min(this.viewFloor, Math.max(0, Math.floor(-yMax)));
    v.r1 = Math.min(this.viewFloor + 1, MINE_H, Math.max(v.r0, Math.ceil(-yMin)));
    return v;
  }

  private updateChunks(grid: TerrainGrid, px: number, py: number): void {
    if (!this.mesherOpts) return;
    const spec = QUALITY[this.quality];
    const view = this.computeView();
    this.chunks.update(grid, view, Math.floor(px), Math.floor(-py), spec.remeshPerFrame, REMESH_NEAR_POD, this.mesherOpts);
    this.glows.update(this.chunks, view, this.kit.uniforms.uHfAmbientFloor.value);
  }

  private updateUniforms(frame: RenderFrame, pose: CameraPose, px: number, py: number): void {
    const u = this.kit.uniforms;
    const pod = frame.world.pod;
    u.uHfTime.value = (frame.timeMs / 1000) % 3600;
    u.uHfPod.value.set(px, py, 0);
    const dir = pod.dig ? CONE_DIRS[pod.dig.dir] : CONE_DIRS.down;
    u.uHfCone.value.set(dir[0], dir[1], 1, 0);
    let lamps = 0;
    // A held pod keeps its thrust in the save, but its flame and lamp are out (INT-2).
    const thrust = frame.podRunning === false ? 0 : pod.thrust;
    if (thrust > 0.05) {
      u.uHfLamps.value[0].set(px, py - 0.55, 0, LAMP_RADII.thrust * (0.6 + 0.4 * thrust));
      u.uHfLampColors.value[0].copy(this.thrustColor).multiplyScalar(0.8);
      lamps = 1;
    }
    u.uHfPodLampCount.value = lamps;
    lamps = this.chunks.collectLights(px, py, lamps, QUALITY[this.quality].lamps, u.uHfLamps.value, u.uHfLampColors.value, this.magmaColor);
    if (frame.world.factory) lamps = this.factoryView.collectLamps(px, py, lamps, QUALITY[this.quality].lamps, u.uHfLamps.value, u.uHfLampColors.value);
    u.uHfLampCount.value = lamps;
    this.updateDither(pose, px, py);
    this.updateBackdrop(pose);
  }

  /**
   * Pixel Lab dither phases (04 §5.7): the snapped camera moves by whole texels, so keying the Bayer
   * matrix on gl_FragCoord alone would re-dither every light falloff and halo per step. World-fixed
   * light uses the snapped centre's texel coordinate; the pod's bubble, cone and flame its own.
   */
  private updateDither(pose: CameraPose, px: number, py: number): void {
    const u = this.kit.uniforms;
    if (this.look !== 'pixel' || this.perspCam) {
      u.uHfDitherWorld.value.set(0, 0);
      u.uHfDitherPod.value.set(0, 0);
      return;
    }
    const { right: r, up } = pose;
    const l = this.pixelLook;
    const lookR = (l.x * r.x + l.y * r.y + l.z * r.z) / this.texel;
    const lookU = (l.x * up.x + l.y * up.y + l.z * up.z) / this.texel;
    const podR = (px * r.x + py * r.y) / this.texel;
    const podU = (px * up.x + py * up.y) / this.texel;
    u.uHfDitherWorld.value.set(bayerPhase(lookR), bayerPhase(lookU));
    u.uHfDitherPod.value.set(bayerPhase(lookR - podR), bayerPhase(lookU - podU));
  }

  /** Backdrop uniforms for the camera actually rendering this frame (04 §5.1 Sky). */
  private updateBackdrop(pose: CameraPose): void {
    const u = (this.look === 'pixel' ? this.skyPixel : this.skyToon).uniforms;
    const pixel = this.look === 'pixel' && !this.perspCam;
    const cam = pixel ? this.pixelCam : this.orthoCam;
    const l = cam === this.pixelCam ? this.pixelLook : pose.lookAt;
    const cosP = Math.cos(pose.pitch * DEG);
    const lookRight = l.x * pose.right.x + l.y * pose.right.y + l.z * pose.right.z;
    const base = (u.uBase.value as Vector2).set(lookRight, l.y - BACKDROP_DIST * Math.tan(pose.pitch * DEG));
    (u.uHalf.value as Vector2).set((cam.right - cam.left) / 2, (cam.top - cam.bottom) / 2);
    u.uCosP.value = cosP;
    // The backdrop's own frame: x along right, height foreshortened by cos(pitch) (passes.ts sky).
    if (pixel) (u.uDither.value as Vector2).set(bayerPhase(base.x / this.texel), bayerPhase((base.y * cosP) / this.texel));
  }

  private updateModels(frame: RenderFrame, px: number, py: number, dt: number): void {
    const pod = frame.world.pod;
    const live = frame.podRunning !== false;
    const v = this.visual;
    v.x = px;
    v.y = py;
    v.facing = pod.facing;
    v.thrust = live ? pod.thrust : 0;
    v.digging = live && pod.digging;
    v.digDir = live && pod.dig ? pod.dig.dir : null;
    v.grounded = pod.grounded;
    v.vx = pod.vx;
    v.vy = pod.vy;
    v.tiers = pod.tiers;
    v.timeMs = frame.timeMs;
    v.fastFall = nextFastFall(v.fastFall, pod.vy);
    v.reducedMotion = frame.reducedMotion;
    v.still = frame.battery === true;
    this.pod.update(v);
    this.rim.update(frame.timeMs, armedPads(frame.world), !v.still);
    this.yard?.update(frame.timeMs);
    this.fx.update(dt * 1000, v);
    if (this.look === 'toon') {
      for (const h of this.hulls) syncHull(h);
      for (const h of this.yardHulls) syncHull(h);
    }
  }

  /** Factory views for the camera rect (04 §3.3): structure on topology changes, motion per frame. */
  private updateFactory(frame: RenderFrame, pose: CameraPose, dt: number): void {
    const world = frame.world;
    const f = world.factory;
    this.surface.setYardRows(f ? f.yardRows : YARD_D_START);
    if (!f) {
      this.kit.uniforms.uHfTerrainDim.value = 1;
      return;
    }
    const layout = this.layout;
    const yardOn = planeViewRect(pose, layout, 'yard', FACTORY_VIEW_MARGIN, this.yardRect);
    const mineOn = planeViewRect(pose, layout, 'mine', FACTORY_VIEW_MARGIN, this.mineRect);
    // α_f (04 §3.3): steps since the last factory tick plus the step interpolation, over the 3-step tick.
    const since = (((world.stepNo - FACTORY_PHASE - 1) % FACTORY_EVERY) + FACTORY_EVERY) % FACTORY_EVERY;
    const alphaF = Math.min(0.999, (since + frame.alpha) / FACTORY_EVERY);
    const ff = this.factoryFrame;
    ff.factory = f;
    ff.grid = world.terrain;
    ff.timeMs = frame.timeMs;
    ff.dt = dt;
    ff.alphaF = alphaF;
    ff.pose = pose;
    ff.yardRect = yardOn ? this.yardRect : null;
    ff.mineRect = mineOn ? this.mineRect : null;
    ff.viewport = this.perspCam ? null : layout;
    ff.build = frame.mode === 'build' || this.buildRig.active ? (frame.build ?? null) : null;
    ff.ghostProgress = world.ghostProgress();
    ff.texel = this.look === 'pixel' && !this.perspCam ? this.texel : 0;
    ff.animate = !(frame.reducedMotion || frame.battery === true);
    ff.itemCap = ITEM_CAP[this.quality];
    ff.smokeCap = frame.battery === true ? SMOKE_CAP[this.quality] / 2 : SMOKE_CAP[this.quality];
    this.factoryView.update(ff);
    // Logistics overlay (03 §4.10): ease the terrain to 30% and back over 0.2 s.
    const dim = this.kit.uniforms.uHfTerrainDim;
    const target = ff.build?.overlay === 'logistics' ? LOGISTICS_TERRAIN : 1;
    const step = dt / OVERLAY_FADE_S;
    dim.value = dim.value < target ? Math.min(target, dim.value + step) : Math.max(target, dim.value - step);
  }

  private draw(pose: CameraPose): void {
    const gl = this.gl;
    gl.info.reset();
    const vignette = VIGNETTE[0] + (VIGNETTE[1] - VIGNETTE[0]) * pose.t;
    if (this.look === 'pixel') {
      const cam = this.perspCam ?? this.pixelCam;
      const offX = this.perspCam ? 0 : this.snap.offX;
      const offY = this.perspCam ? 0 : this.snap.offY;
      this.pixel.render(gl, this.scene, cam, this.k, offX, offY, vignette);
      this.infoData.pixelScale = this.k;
    } else {
      this.toon.render(gl, this.scene, this.renderCamera(), vignette, this.layout.width / this.layout.height);
      this.infoData.pixelScale = 1;
    }
    this.infoData.drawCalls = gl.info.render.calls;
    this.infoData.triangles = gl.info.render.triangles;
  }

  // ---- looks, quality, compile ------------------------------------------------------------------

  private applyLook(): void {
    const look = this.look;
    this.chunks.setMaterial(this.kit.terrain(look));
    this.glows.setLook(look);
    this.surface.setMaterials(this.kit.terrain(look), this.kit.sky(look));
    for (const root of this.modelRoots()) applyLookMaterials(root, look, this.kit);
    this.factoryView.setLook(look);
    this.syncGhostEdge();
    this.applyQualityScope();
  }

  /** Battery mode and reduced motion halve the particles (04 §5.8; 03 §7). */
  private syncFxBudget(frame: RenderFrame): void {
    const share = frame.battery === true || frame.reducedMotion ? 0.5 : 1;
    const budget = Math.round(QUALITY[this.quality].particles * share);
    if (budget === this.fxBudget) return;
    this.fxBudget = budget;
    this.fx.setBudget(budget);
  }

  private applyQualityScope(): void {
    const scope: OutlineScope = outlineScope(this.quality, this.precompileBoth);
    this.fxBudget = -1;
    this.fx.setBudget(QUALITY[this.quality].particles);
    this.kit.uniforms.uHfOreHulls.value = oreHullsEnabled(scope) ? 1 : 0;
    const hulls = meshOreHulls(this.look, this.quality, this.precompileBoth);
    if (this.mesherOpts && this.mesherOpts.hulls !== hulls) {
      // Production look/tier change: remesh resident chunks with (or without) hull geometry.
      this.mesherOpts.hulls = hulls;
      this.chunks.forceAll();
    }
    setHullsEnabled(this.pod.root, 'pod', true, this.look);
    for (const root of [this.rim.root, this.yard?.root]) if (root) setHullsEnabled(root, 'buildings', scope !== 'pod', this.look);
    // Factory outlines: buildings and items on mid/high; low outlines only the selected piece (04 §5.5).
    this.factoryView.setHulls(scope !== 'pod', true);
  }

  private modelRoots(): Object3D[] {
    const roots: Object3D[] = [this.pod.root, this.rim.root, this.fx.root];
    if (this.yard) roots.push(this.yard.root);
    return roots;
  }

  /** Compile every program of the active look (and, in M0, the other one) behind the loader. */
  private precompile(): void {
    const looks: Look[] = this.precompileBoth ? [this.look === 'toon' ? 'pixel' : 'toon', this.look] : [this.look];
    const current = this.look;
    // Factory pieces, ghosts (prepass, outline, body), bubbles and overlays too: three compiles visible objects only.
    this.factoryView.setCompileVisible(true);
    for (const look of looks) {
      this.look = look;
      this.applyLook();
      const cam = look === 'pixel' ? this.pixelCam : this.renderCamera();
      this.gl.setRenderTarget(look === 'pixel' ? this.pixel.rtA : this.toon.target);
      this.gl.compile(this.scene, cam);
      if (look === 'pixel') this.pixel.compilePasses(this.gl);
      else this.toon.compilePasses(this.gl);
    }
    this.look = current;
    this.factoryView.setCompileVisible(false);
    this.applyLook();
    this.gl.setRenderTarget(null);
  }

  /** Context restored: rebuild targets, re-upload chunks, recompile (04 §5.6). */
  private rebuildGpu(): void {
    this.toon.invalidate();
    this.pixel.invalidate();
    this.resize(this.layout);
    this.kit.uniforms.uHfAmbient.value.needsUpdate = true;
    this.chunks.forceAll();
    this.precompile();
  }

  private renderCamera(): OrthographicCamera | PerspectiveCamera {
    return this.perspCam ?? this.orthoCam;
  }

  private pickCamera(): OrthographicCamera | PerspectiveCamera {
    return this.perspCam ?? this.orthoCam;
  }

  private setRay(px: number, py: number): void {
    const ndc = this.tmpV2.set((px / this.layout.width) * 2 - 1, -(py / this.layout.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.pickCamera());
  }

  private pickSlab(px: number, py: number): Vector3 | null {
    this.setRay(px, py);
    return this.raycaster.ray.intersectPlane(this.slabPlane, this.tmpV3);
  }

  /** Real lights only for materials outside the look kit (placeholders); look materials ignore them. */
  private addFallbackLights(): void {
    this.scene.add(...createFallbackLights());
  }
}

/**
 * Armed-pad bitmask for the Rim lights (bit i = RIM_BUILDINGS[i]; 03 §6.4). A pad the pod is not standing on
 * re-arms as soon as the pod leaves it (canon §2.4), so only the pad under the pod can be disarmed (latched).
 */
export function armedPads(world: Pick<WorldApi, 'isPadArmed' | 'padUnderPod'>): number {
  const under = world.padUnderPod();
  let mask = 0;
  for (let i = 0; i < RIM_BUILDINGS.length; i++) {
    const id = RIM_BUILDINGS[i].id as RimBuildingId;
    if (id !== under || world.isPadArmed(id)) mask |= 1 << i;
  }
  return mask;
}

/**
 * The hemisphere + sun fallback lights, on every layer. three gathers only the lights a pass's camera
 * layers can see and keys every program on the light counts, so lights on layer 0 alone made Pixel Lab
 * pass 3 (LAYER_LATE) draw with no lights while precompile() had built its programs with two: the first
 * thrust, arming or look flip then compiled shaders mid-play (canon §5.1 "flip ≤ 1 frame").
 */
export function createFallbackLights(): [HemisphereLight, DirectionalLight] {
  const hemi = new HemisphereLight(SURFACE.hemiSky, SURFACE.hemiGround, 0.55);
  const sun = new DirectionalLight(SURFACE.sun, 1);
  sunDirection(sun.position).multiplyScalar(50);
  hemi.layers.enableAll();
  sun.layers.enableAll();
  return [hemi, sun];
}

export const createRenderer: CreateRenderer = (canvas, layout, opts) => new HfRenderer(canvas, layout, opts);

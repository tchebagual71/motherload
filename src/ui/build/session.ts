// Build session (03 §4; canon §4.11; 04 §6.2): the build-mode state behind the dock, tray and gestures. It owns
// the armed tool, the pending (uncommitted) ghost, the build camera and the undo labels, validates every change
// with the factory's synchronous validators (red preview + 03 §6.2 text), commits through the factory / World
// commands and writes AppState.buildFrame for the renderer. The input module feeds it gestures (GestureSink).
import { signal, type Signal } from '@preact/signals';
import type { AppController } from '../../app/types';
import {
  BUILDINGS,
  DIR,
  type BuildingKind,
  type Cell,
  type Dir,
  type EntityView,
  type Err,
  type FactoryApi,
  type GhostSpec,
  type GhostView,
  type Plane,
  type Res,
  type RouterMode,
} from '../../factory/api';
import type { GestureSink } from '../../input/build/machine';
import type { BuildCamera, BuildFrame, BuildRendererApi } from '../../render/api';
import type { Lode } from '../../shared/types';
import type { WorldApi } from '../../world/api';
import { formatCash } from '../format';
import { BUILD_ZOOM, clampCamera, clampPpu, defaultCamera, entryPlane, isOneByOne, planeBounds, ZOOM_STEP } from './camera';
import { buildingName, errText, kitBill, undoText } from './text';
import {
  W,
  beltPathUnchanged,
  drillSites,
  extendPath,
  footprintAt,
  inFootprint,
  lPath,
  liftChip,
  liftEnds,
  lodeDrillSite,
  lodeUnder,
  mineRun,
  pathDirs,
  removalAsk,
  removalPrice,
  sameCell,
  snapDrill,
  snapEndDir,
  tabOf,
  takesInput,
  toolOnPlane,
  yardBeltCost,
  yardBeltRefund,
  type MineRun,
  type Rect,
  type Tool,
  type TrayTab,
} from './tools';

/** A Headframe for a lift topping out at row 0 (02 §2.2; 03 §4.5 step 4). */
export type HeadframePlan = { state: 'existing'; x0: number } | { state: 'new'; x0: number; err: Err | null } | { state: 'invalid' };

/** The uncommitted ghost (03 §4.3): ✓ commits it, ✗ clears it. */
export type Pending =
  /** One footprint: a Yard building, or an underground Router / Auto-Drill. */
  | { t: 'piece'; kind: BuildingKind; x: number; y: number; dir: Dir }
  /** Yard belts painted along a path (02 §2.1). */
  | { t: 'path'; cells: Cell[]; endDir?: Dir }
  /** Underground belt run, row-locked (03 §4.4). */
  | { t: 'run'; run: MineRun }
  /** Bucket Lift by two endpoints (03 §4.5); top null until the second tap. */
  | { t: 'lift'; x: number; foot: number; top: number | null; headframe: HeadframePlan | null }
  /** Bulldoze marks (03 §4.7): one building or ghost, plus painted belt cells. */
  | { t: 'remove'; id: number | null; ghost: number | null; cells: Cell[] };

export interface BuildPorts {
  app: AppController;
  renderer(): BuildRendererApi | null;
  /** World area in CSS px (edge auto-pan, loupe). */
  area(): Rect;
}

/** Underground deconstruction with the Kit back to the bay (World services; the factory alone refunds to the Stockpile). */
interface UndergroundOps {
  deconstructUnderground?(id: number): Res<{ refund: number }>;
  removeUndergroundBelts?(cells: readonly Cell[]): Res<{ refund: number }>;
}

const UNDO_LABELS = 64;
const MK = 1;

function err(code: Err['code'], extra: Omit<Err, 'ok' | 'code'> = {}): Err {
  return { ok: false, code, ...extra };
}

export class BuildSession implements GestureSink {
  /** Bumped on every structural change (tool, pending ghost, validity, inspect): the dock, tray and chips. */
  readonly version: Signal<number> = signal(0);
  /** Bumped when only the cursor, loupe or camera moved (ghost labels, loupe). */
  readonly cursorVersion: Signal<number> = signal(0);

  active = false;
  plane: Plane = 'yard';
  cam: BuildCamera = { plane: 'yard', cx: 24, cy: 4, ppu: BUILD_ZOOM.yard.base, yaw: 0 };
  tool: Tool | null = null;
  readonly tab: Record<Plane, TrayTab> = { yard: 'logistics', mine: 'logistics' };
  /** ↻ rotation remembered per type (03 §4.3); belts and buildings face away from the Rim by default. */
  readonly rot: Partial<Record<BuildingKind, Dir>> = {};
  panLatch = false;
  /** L mode for Yard belts (03 §4.4) and its ⇋ leg flip. */
  lMode = false;
  lFlip = false;
  /** ◫ Logistics overlay (status bubbles). */
  overlay = false;
  shoppingOpen = false;
  pending: Pending | null = null;
  /** Validator result for `pending` (null = valid). */
  error: Err | null = null;
  cursorCell: Cell | null = null;
  /** Finger position for the loupe, or null. */
  loupeAt: { x: number; y: number } | null = null;
  /** Inspect sheet target. */
  inspectId: number | null = null;
  inspectGhost: number | null = null;
  /** Inspect → Deconstruct asked first (the removal loses money, removalAsk): a second tap removes this id. */
  askRemove: number | null = null;
  /** After Place drill: offer "Route to surface" from this drill footprint (03 §4.6). */
  routeFrom: { x: number; y: number; w: number; h: number } | null = null;

  private readonly undoLabels: string[] = [];
  private readonly redoLabels: string[] = [];
  /** The other plane's camera within one session ([Yard│Mine] swaps); cleared when the session ends. */
  private readonly camByPlane: Partial<Record<Plane, BuildCamera>> = {};
  /** Zoom and yaw remembered across sessions; the centre is framed afresh on every entry (03 §4.1, §5). */
  private readonly viewByPlane: Partial<Record<Plane, Pick<BuildCamera, 'ppu' | 'yaw'>>> = {};
  private strokeStartCell: Cell | null = null;
  /** Last cell of the stroke (Bulldoze paints every cell it crossed). */
  private strokeLast: Cell | null = null;
  private beforeStroke: Pending | null = null;
  /** Offset from the lifted point to a dragged piece's min corner (a tap inside the ghost is a drag handle). */
  private grab: { dx: number; dy: number } | null = null;
  /** Called when the session ends (the input glue drops its gesture). */
  onEnd: (() => void) | null = null;

  constructor(private readonly ports: BuildPorts) {}

  // ---------------------------------------------------------------- accessors

  get app(): AppController {
    return this.ports.app;
  }
  get world(): WorldApi {
    return this.ports.app.world;
  }
  get factory(): FactoryApi | null {
    return this.ports.app.world.factory;
  }
  get instant(): boolean {
    return this.ports.app.state.settings.peek().instantBuild === true;
  }
  get canUndo(): boolean {
    return this.factory?.canUndo ?? false;
  }
  get canRedo(): boolean {
    return this.factory?.canRedo ?? false;
  }
  /** ✓ is live: something is pending and it passes the validator. */
  get canConfirm(): boolean {
    return this.pending !== null && this.error === null && !(this.pending.t === 'lift' && this.pending.top === null) && !this.emptyRemove() && !this.unchangedPath();
  }
  get area(): Rect {
    return this.ports.area();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Enter build mode (the controller has set the mode and the pause reason). Returns false without a factory. */
  begin(plane?: Plane): boolean {
    if (!this.factory) return false;
    this.active = true;
    const pod = this.world.pod;
    this.plane = plane ?? entryPlane(pod.y);
    this.camByPlane.yard = this.camByPlane.mine = undefined;
    if (this.tool && !toolOnPlane(this.tool, this.plane)) this.tool = null;
    // Framed on the pod (Mine) or the Headframe near it (Yard) every time: the pod may have moved since.
    this.cam = this.defaultCam(this.plane);
    this.pending = null;
    this.error = null;
    this.cursorCell = null;
    this.loupeAt = null;
    this.inspectId = null;
    this.inspectGhost = null;
    this.askRemove = null;
    this.routeFrom = null;
    this.panLatch = false;
    this.pushCamera();
    this.publish();
    return true;
  }

  /** Leave build mode: uncommitted ghosts are dropped (canon §4.11 ghost-and-confirm). */
  end(): void {
    if (!this.active) return;
    this.active = false;
    this.rememberView();
    this.camByPlane.yard = this.camByPlane.mine = undefined;
    this.pending = null;
    this.error = null;
    this.cursorCell = null;
    this.loupeAt = null;
    this.inspectId = null;
    this.inspectGhost = null;
    this.askRemove = null;
    this.shoppingOpen = false;
    this.grab = null;
    this.onEnd?.();
    this.ports.app.state.buildFrame.value = null;
    this.bump();
  }

  // ---------------------------------------------------------------- dock and tray

  setPlane(p: Plane): void {
    if (!this.active || p === this.plane) return;
    this.camByPlane[this.plane] = this.cam;
    this.rememberView();
    this.plane = p;
    this.cam = this.camByPlane[p] ?? this.defaultCam(p);
    this.pending = null;
    this.error = null;
    this.cursorCell = null;
    this.inspectId = null;
    this.inspectGhost = null;
    if (this.tool && !toolOnPlane(this.tool, p)) this.tool = null;
    this.applyZoomFloor();
    this.pushCamera();
    this.publish();
  }

  setTab(t: TrayTab): void {
    this.tab[this.plane] = t;
    this.bump();
  }

  /** A card: arm its tool (a second tap disarms). Locked cards explain their rung (03 §6.2 E_LOCKED). */
  arm(tool: Tool | null): void {
    if (!this.active) return;
    if (tool !== null && tool !== 'bulldoze') {
      const spec = BUILDINGS[tool].mks[0];
      const f = this.factory;
      if (f && !f.isUnlocked(spec.rung)) {
        this.app.toast(errText(err('E_LOCKED', { rung: spec.rung })), 'info');
        return;
      }
    }
    const next = tool === this.tool ? null : tool;
    if (next !== this.tool) {
      this.pending = null;
      this.error = null;
    }
    this.tool = next;
    // The armed card stays in view (Place drill, Route to surface): its tab opens. Bulldoze shows on the dock's ✗.
    if (next !== null && next !== 'bulldoze') {
      const tab = tabOf(this.plane, next, this.tab[this.plane]);
      if (tab) this.tab[this.plane] = tab;
    }
    this.inspectId = null;
    this.inspectGhost = null;
    this.applyZoomFloor();
    this.pushCamera();
    this.publish();
  }

  /** ↻ (R): 90° clockwise, remembered per type; Yard only (02 §2.1). */
  rotate(): void {
    if (!this.active || this.plane !== 'yard') return;
    const p = this.pending;
    const kind: BuildingKind | null = p?.t === 'piece' ? p.kind : p?.t === 'path' ? 'belt' : this.tool && this.tool !== 'bulldoze' ? this.tool : null;
    if (!kind || !BUILDINGS[kind].rotates) return;
    const d = (((this.rot[kind] ?? DIR.S) + 1) & 3) as Dir;
    this.rot[kind] = d;
    if (p?.t === 'piece') p.dir = d;
    else if (p?.t === 'path' && p.cells.length === 1) p.endDir = d;
    this.validate();
    this.publish();
  }

  togglePanLatch(): void {
    this.panLatch = !this.panLatch;
    this.bump();
  }

  toggleLMode(): void {
    this.lMode = !this.lMode;
    this.bump();
  }

  flipL(): void {
    this.lFlip = !this.lFlip;
    const p = this.pending;
    if (p?.t === 'path' && p.cells.length > 1 && this.lMode) {
      p.cells = lPath(p.cells[0], p.cells[p.cells.length - 1], this.lFlip);
      this.validate();
    }
    this.publish();
  }

  toggleOverlay(): void {
    this.overlay = !this.overlay;
    this.writeFrame(); // the renderer dims the terrain and marks jam heads (BuildFrame.overlay)
    this.bump();
  }

  toggleShopping(): void {
    this.shoppingOpen = !this.shoppingOpen;
    this.bump();
  }

  /** −/+ buttons and the wheel. */
  zoomBy(factor: number): void {
    if (!this.active) return;
    this.cam = { ...this.cam, ppu: clampPpu(this.plane, this.cam.ppu * factor, this.plane === 'yard' && isOneByOne(this.tool)) };
    this.pushCamera();
    this.bumpCursor();
  }
  zoomIn(): void {
    this.zoomBy(ZOOM_STEP);
  }
  zoomOut(): void {
    this.zoomBy(1 / ZOOM_STEP);
  }

  /** ⟳ / [ ]: one 90° yaw step (Yard; canon §3.4 four snaps). */
  yawStep(step: 1 | -1): void {
    if (!this.active || this.plane !== 'yard') return;
    this.cam = { ...this.cam, yaw: ((this.cam.yaw + step + 4) & 3) as BuildCamera['yaw'] };
    this.pushCamera();
    this.bumpCursor();
  }

  /** Keyboard pan (WASD / arrows): one tile in a screen direction. */
  nudgeView(sx: number, sy: number): void {
    const d = this.screenToPlaneDelta(sx * this.cam.ppu, sy * this.cam.ppu);
    if (d) this.moveCamera(d.x, d.y);
  }

  /** Nudge arrows (03 §4.3): move the pending piece one cell (underground: sideways only). */
  nudge(dx: number, dy: number): void {
    const p = this.pending;
    if (!this.active || p?.t !== 'piece' || (this.plane === 'mine' && dy !== 0)) return;
    p.x += dx;
    p.y += dy;
    this.validate();
    this.publish();
  }

  /** ✗: clear the pending ghost; with nothing pending, arm or disarm Bulldoze (03 §4.3, §4.7). */
  clear(): void {
    if (!this.active) return;
    if (this.pending) {
      this.pending = null;
      this.error = null;
      this.publish();
      return;
    }
    this.arm(this.tool === 'bulldoze' ? null : 'bulldoze');
  }

  /** Esc: close the inspect sheet, else clear the pending ghost, else disarm; returns false when nothing was open. */
  back(): boolean {
    if (this.inspectId !== null || this.inspectGhost !== null) {
      this.closeInspect();
      return true;
    }
    if (this.pending) {
      this.pending = null;
      this.error = null;
      this.publish();
      return true;
    }
    if (this.tool) {
      this.arm(null);
      return true;
    }
    return false;
  }

  /** ✓: commit the pending ghost (03 §4.3). */
  confirm(): boolean {
    const f = this.factory;
    const p = this.pending;
    if (!this.active || !f || !p) return false;
    this.validate();
    if (this.error) {
      this.fail(this.error);
      return false;
    }
    // Nothing to commit yet (a lift without its top, an empty mark, belts already there): ✓ is off.
    if (!this.canConfirm) {
      this.publish();
      return false;
    }
    const ok = this.commit(f, p);
    if (ok) {
      this.pending = null;
      this.error = null;
      this.app.afterAction({ ok: true });
    }
    this.publish();
    return ok;
  }

  undo(): void {
    this.history('undo');
  }
  redo(): void {
    this.history('redo');
  }

  // ---------------------------------------------------------------- inspect (03 §6.3: tap a building → 50% sheet)

  openInspect(id: number): void {
    this.inspectId = id;
    this.inspectGhost = null;
    this.askRemove = null;
    this.publish();
  }

  openGhostInspect(id: number): void {
    this.inspectGhost = id;
    this.inspectId = null;
    this.askRemove = null;
    this.publish();
  }

  closeInspect(): void {
    this.inspectId = null;
    this.inspectGhost = null;
    this.askRemove = null;
    this.publish();
  }

  setRecipe(id: number, recipe: string | null): void {
    // The current recipe again is not a step (the factory records nothing): no undo label for it.
    if ((this.factory?.inspect(id)?.recipe ?? null) === recipe) return;
    this.run(() => this.factory?.setRecipe(id, recipe) ?? err('E_INVALID'), recipe ? `Recipe ${recipe}` : 'Recipe off');
  }

  setRouterMode(id: number, mode: RouterMode, filter?: string): void {
    this.run(() => this.factory?.setRouterMode(id, mode, filter ? { filter } : undefined) ?? err('E_INVALID'), `Router: ${mode}`);
  }

  setUnloadFilter(id: number, item: string | null): void {
    this.run(() => this.factory?.setUnloadFilter(id, item) ?? err('E_INVALID'), 'Unload filter');
  }

  /**
   * Deconstruct (inspect sheet): surface 100% refund; underground Kit to the bay when it can (02 §2.7). A removal
   * that loses money (the free rusted survey set refunds $0, 02 §2.2) only asks on the first tap (`askRemove`,
   * the sheet shows removalAsk's question with the rebuild price); the second tap removes.
   */
  deconstruct(id: number): boolean {
    const e = this.factory?.entity(id);
    if (!e) return false;
    if (this.askRemove !== id && removalAsk(e) !== null) {
      this.askRemove = id;
      this.publish();
      return false;
    }
    this.askRemove = null;
    const ok = this.run(() => this.removeEntity(e), `Removed ${buildingName(e.kind)}`);
    if (ok && this.inspectId === id) this.inspectId = null;
    this.publish();
    return ok;
  }

  /** "Keep it": drop the Deconstruct question. */
  keepBuilding(): void {
    if (this.askRemove === null) return;
    this.askRemove = null;
    this.publish();
  }

  removeGhost(id: number): boolean {
    const g = this.factory?.ghosts().find((x) => x.id === id);
    const ok = this.run(() => this.factory?.removeGhost(id) ?? err('E_INVALID'), g ? `Removed ${buildingName(g.kind)} ghost` : 'Removed ghost');
    if (ok && this.inspectGhost === id) this.inspectGhost = null;
    this.publish();
    return ok;
  }

  // ---------------------------------------------------------------- Place drill and Route to surface (03 §3.5, §4.6)

  /** Context "Place drill": Mine plane, Auto-Drill armed and its ghost snapped to the lode (survey plan for the scripted one). */
  placeDrill(lodeId: number): void {
    const f = this.factory;
    const lode = this.world.terrain.lodes.find((l) => l.id === lodeId);
    if (!f || !lode) return;
    if (!this.active) this.app.enterBuild();
    if (!this.active) return;
    this.setPlane('mine');
    if (this.tool !== 'autoDrill') this.arm('autoDrill');
    let site: Cell;
    if (lodeId === this.world.meta.scriptedLodeId) site = f.surveyPlan().drill;
    else {
      const sites = [{ x: lode.x0, y: lode.top - 2 }, { x: lode.x0 + 1, y: lode.top - 2 }];
      const podX = this.world.pod.x;
      sites.sort((a, b) => Math.abs(a.x + 1 - podX) - Math.abs(b.x + 1 - podX));
      site = sites.find((s) => f.canPlaceGhost({ kind: 'autoDrill', x: s.x, y: s.y }) === null) ?? sites[0];
    }
    this.pending = { t: 'piece', kind: 'autoDrill', x: site.x, y: site.y, dir: DIR.S };
    this.routeFrom = { x: site.x, y: site.y, w: 2, h: 2 };
    this.centreOn(site.x + 1, site.y + 1);
    this.validate();
    this.publish();
  }

  /** A straight shaft from `foot` to row 0 that is fully excavated, over a valid Headframe column (MVP-37). */
  routeFromFoot(foot: Cell): { x: number; foot: number; top: number; headframe: HeadframePlan } | null {
    const f = this.factory;
    if (!f) return null;
    for (const x of [foot.x, foot.x - 1, foot.x + 1]) {
      if (x < 0 || x >= W || foot.y < 1) continue;
      if (f.canPlaceGhost({ kind: 'lift', x, foot: foot.y, top: 0 }) !== null) continue;
      const hf = this.headframePlan(x);
      if (hf.state === 'invalid') continue;
      return { x, foot: foot.y, top: 0, headframe: hf };
    }
    return null;
  }

  /** Route to surface from a drill footprint: a foot beside it (an adjacent drill feeds the foot, 02 §3.4). */
  routeFromPiece(r: { x: number; y: number; w: number; h: number }): { x: number; foot: number; top: number; headframe: HeadframePlan } | null {
    const f = this.factory;
    if (!f) return null;
    // The scripted lode's drill site has Dot's shaft beside it (02 §2.2 survey set).
    const plan = f.surveyPlan();
    if (r.y === plan.drill.y && Math.abs(r.x - plan.drill.x) <= 1) {
      const s = this.routeFromFoot({ x: plan.lift.x, y: plan.lift.foot });
      if (s && s.x === plan.lift.x) return s;
    }
    for (const x of [r.x - 1, r.x + r.w]) {
      for (let y = r.y + r.h - 1; y >= r.y; y--) {
        const s = this.routeFromFoot({ x, y });
        if (s && s.x === x) return s;
      }
    }
    return null;
  }

  /** "Route to surface": arm the Lift with the suggested shaft as the pending ghost (✓ commits lift + Headframe). */
  routeToSurface(from?: { x: number; y: number; w: number; h: number }): boolean {
    const lift = this.pending?.t === 'lift' ? this.pending : null;
    const src = from ?? (lift ? null : this.routeFrom);
    const s = src ? this.routeFromPiece(src) : lift ? this.routeFromFoot({ x: lift.x, y: lift.foot }) : null;
    if (!s) {
      this.app.toast('Lifts need a straight shaft to the Rim', 'info');
      return false;
    }
    this.setPlane('mine');
    if (this.tool !== 'lift') this.arm('lift');
    this.inspectId = null;
    this.inspectGhost = null;
    this.routeFrom = null;
    this.pending = { t: 'lift', x: s.x, foot: s.foot, top: 0, headframe: s.headframe };
    this.validate();
    this.publish();
    return true;
  }

  // ---------------------------------------------------------------- gestures (input/build/machine.ts)

  cursor(x: number, y: number): void {
    if (!this.active) return;
    const c = this.pick(x, y);
    if (!sameCell(c, this.cursorCell)) {
      this.cursorCell = c;
      this.writeFrame();
      this.bumpCursor();
    }
  }

  tap(x: number, y: number): void {
    if (!this.active) return;
    const c = this.pick(x, y);
    this.cursorCell = c;
    const tool = this.tool;
    if (tool === null) {
      this.inspectAt(x, y, c);
      return;
    }
    if (!c) return;
    const f = this.factory;
    if (!f) return;
    if (tool === 'bulldoze') this.markAt(x, y, c);
    else if (tool === 'lift') this.liftTap(c);
    else if (tool === 'belt' && this.plane === 'yard') this.pending = { t: 'path', cells: [c], endDir: this.rot.belt ?? DIR.S };
    else if (tool === 'belt') this.pending = { t: 'run', run: mineRun(c, c) };
    else {
      const p = this.pending;
      // A tap inside the pending ghost is a drag handle: it never moves or rotates it (03 §4.2).
      if (!(p?.t === 'piece' && p.kind === tool && inFootprint(c, p.x, p.y, BUILDINGS[tool].w, BUILDINGS[tool].h))) {
        const at = this.pieceAt(tool, x, y, c);
        this.pending = { t: 'piece', kind: tool, x: at.x, y: at.y, dir: this.rot[tool] ?? DIR.S };
      }
    }
    this.validate();
    if (this.error) this.refuse(this.error);
    else if (this.instant && this.instantCommits()) {
      this.confirm();
      return;
    }
    this.publish();
  }

  longPress(x: number, y: number): void {
    if (!this.active) return;
    this.inspectAt(x, y, this.pick(x, y));
  }

  strokeStart(x: number, y: number): void {
    if (!this.active || !this.tool) return;
    const c = this.pick(x, y);
    this.beforeStroke = clonePending(this.pending);
    this.strokeStartCell = c;
    this.strokeLast = c;
    this.cursorCell = c;
    this.grab = null;
    if (!c) return;
    const tool = this.tool;
    if (tool === 'bulldoze') {
      // "Drag paints belts" (03 §4.7): add to the marks; a drag starting on a building marks it.
      const p = this.removePending();
      if (this.beltAt(c)) this.markBelt(p, c);
      else this.markAt(x, y, c);
    } else if (tool === 'belt') {
      this.pending = this.plane === 'yard' ? { t: 'path', cells: [c] } : { t: 'run', run: mineRun(c, c) };
    } else if (tool === 'lift') {
      const p = this.pending;
      if (p?.t === 'lift' && Math.abs(c.x - p.x) <= 1 && c.y < p.foot) p.top = Math.max(0, c.y);
      else this.pending = { t: 'lift', x: c.x, foot: c.y, top: null, headframe: null };
    } else {
      const p = this.pending;
      const def = BUILDINGS[tool];
      if (p?.t === 'piece' && p.kind === tool && inFootprint(c, p.x, p.y, def.w, def.h)) {
        this.grab = { dx: p.x - c.x, dy: p.y - c.y };
      } else {
        const at = this.pieceAt(tool, x, y, c);
        this.pending = { t: 'piece', kind: tool, x: at.x, y: at.y, dir: this.rot[tool] ?? DIR.S };
      }
    }
    this.validate();
    this.publish();
  }

  strokeMove(x: number, y: number): void {
    if (!this.active || !this.tool) return;
    const c = this.pick(x, y);
    const moved = !sameCell(c, this.cursorCell);
    this.cursorCell = c;
    if (!c || !moved) {
      if (moved) this.writeFrame();
      return;
    }
    const p = this.pending;
    const start = this.strokeStartCell;
    const prev = this.strokeLast ?? c;
    this.strokeLast = c;
    switch (this.tool) {
      case 'bulldoze': {
        // Every cell the finger crossed (a fast drag skips cells).
        const r = this.removePending();
        for (const k of extendPath([prev], c)) if (this.beltAt(k)) this.markBelt(r, k);
        break;
      }
      case 'belt':
        if (p?.t === 'path') {
          p.cells = this.lMode && start ? lPath(start, c, this.lFlip) : extendPath(p.cells, c);
          p.endDir = undefined;
        } else if (p?.t === 'run' && start) p.run = mineRun(start, c);
        break;
      case 'lift': {
        if (p?.t !== 'lift') break;
        const ends = liftEnds({ x: p.x, y: p.foot }, c);
        p.top = ends ? ends.top : null;
        break;
      }
      default: {
        if (p?.t !== 'piece') break;
        if (this.grab) {
          p.x = c.x + this.grab.dx;
          p.y = c.y + this.grab.dy;
        } else {
          const at = this.pieceAt(p.kind, x, y, c);
          p.x = at.x;
          p.y = at.y;
        }
      }
    }
    this.validate();
    this.publish();
  }

  strokeEnd(): void {
    if (!this.active) return;
    this.grab = null;
    this.strokeStartCell = null;
    this.beforeStroke = null;
    this.validate();
    if (this.error && this.pending) this.refuse(this.error);
    else if (this.instant && this.instantCommits()) {
      this.confirm();
      return;
    }
    this.publish();
  }

  strokeFreeze(): void {
    if (!this.active) return;
    this.grab = null;
    this.strokeStartCell = null;
    this.beforeStroke = null;
    this.validate();
    this.publish();
  }

  strokeDiscard(): void {
    if (!this.active) return;
    this.pending = this.beforeStroke;
    this.beforeStroke = null;
    this.strokeStartCell = null;
    this.grab = null;
    this.validate();
    this.publish();
  }

  pan(dx: number, dy: number): void {
    if (!this.active) return;
    const d = this.screenToPlaneDelta(dx, dy);
    if (d) this.moveCamera(-d.x, -d.y);
  }

  zoom(scale: number, sx: number, sy: number): void {
    if (!this.active) return;
    const ppu = clampPpu(this.plane, this.cam.ppu * scale, this.plane === 'yard' && isOneByOne(this.tool));
    if (ppu === this.cam.ppu) return;
    // Keep the plane point under the fingers' centre in place.
    const p = this.planePoint(sx, sy);
    const k = this.cam.ppu / ppu;
    const cx = p ? p.x - (p.x - this.cam.cx) * k : this.cam.cx;
    const cy = p ? p.y - (p.y - this.cam.cy) * k : this.cam.cy;
    this.cam = clampCamera({ ...this.cam, ppu, cx, cy }, this.bounds());
    this.pushCamera();
    this.bumpCursor();
  }

  yawSnap(step: 1 | -1): void {
    this.yawStep(step);
  }

  panEnd(): void {
    if (this.panLatch) {
      this.panLatch = false;
      this.bump();
    }
  }

  loupe(finger: { x: number; y: number } | null): void {
    const next = finger ? { x: finger.x, y: finger.y } : null;
    if (!next && !this.loupeAt) return;
    this.loupeAt = next;
    this.bumpCursor();
  }

  /** Edge auto-pan (canon §3.12): screen-direction velocity in tiles/s for `dt` seconds. */
  edgePan(vx: number, vy: number, dt: number): void {
    if (!this.active) return;
    const len = Math.hypot(vx, vy);
    if (len === 0) return;
    const d = this.screenToPlaneDelta(vx / len, vy / len);
    if (!d) return;
    const n = Math.hypot(d.x, d.y);
    if (n === 0) return;
    this.moveCamera((d.x / n) * len * dt, (d.y / n) * len * dt);
  }

  // ---------------------------------------------------------------- views for the UI

  /** The pending chip (03 §4.1, 28 pt): cost, Kits, or the validator's reason. */
  chip(): { text: string; tone: 'info' | 'bad' | 'good' } | null {
    const p = this.pending;
    const f = this.factory;
    if (!f) return null;
    if (!p) return this.tool ? { text: this.hint(this.tool), tone: 'info' } : null;
    if (this.error) return { text: errText(this.error, this.errCtx()), tone: 'bad' };
    switch (p.t) {
      case 'piece': {
        if (this.plane === 'yard') return { text: `${buildingName(p.kind)} · ${formatCash(BUILDINGS[p.kind].mks[0].cash)}`, tone: 'info' };
        return { text: `${buildingName(p.kind)} · ${kitBill(BUILDINGS[p.kind].mks[0].kit ?? '', 1)}`, tone: 'info' };
      }
      case 'path': {
        if (this.unchangedPath()) return { text: 'Belts already there', tone: 'info' };
        const dirs = pathDirs(p.cells, p.endDir ?? this.endSnap(p.cells));
        const cost = yardBeltCost(p.cells, dirs, f.beltWords('yard'), BUILDINGS.belt.mks[0].cash);
        return { text: `${formatCash(cost)} · ${p.cells.length} tile${p.cells.length === 1 ? '' : 's'}`, tone: 'info' };
      }
      case 'run':
        return { text: kitBill('belt', p.run.length), tone: 'info' };
      case 'lift':
        return p.top === null ? { text: 'Tap the top of the shaft', tone: 'info' } : { text: liftChip(p.foot, p.top), tone: 'info' };
      case 'remove':
        return this.removeChip(p);
    }
  }

  /** Does the selected Kit-less bulldoze hold anything? */
  private emptyRemove(): boolean {
    const p = this.pending;
    return p?.t === 'remove' && p.id === null && p.ghost === null && p.cells.length === 0;
  }

  /** A Yard path that repaints belts exactly as they are: the factory would record no step (02 §2.1). */
  private unchangedPath(): boolean {
    const p = this.pending;
    const f = this.factory;
    if (p?.t !== 'path' || !f) return false;
    const dirs = pathDirs(p.cells, p.endDir ?? this.endSnap(p.cells));
    const ids = f.yardBuildings();
    return beltPathUnchanged(
      p.cells,
      dirs,
      f.beltWords('yard'),
      MK,
      (x, y) => (x >= 0 && x < W && y >= 0 ? (ids[y * W + x] ?? 0) : 0),
      (id) => f.entity(id)?.kind === 'router',
      f.isUnlocked(BUILDINGS.router.mks[0].rung),
    );
  }

  /** Screen anchor (CSS px) of the pending ghost's label: the middle of its far row (the top on screen), or null. */
  ghostAnchor(): { x: number; y: number } | null {
    const r = this.ports.renderer();
    const fp = this.ghostRect();
    if (!r || !fp) return null;
    return r.cellToScreen(this.plane, fp.x + (fp.w - 1) / 2, fp.y + (this.plane === 'yard' ? fp.h - 1 : 0));
  }

  /** The pending ghost's label anchor is inside the world area: its red reason shows on the ghost (03 §6.2). */
  ghostOnScreen(): boolean {
    const a = this.ghostAnchor();
    const r = this.area;
    return !!a && Number.isFinite(a.x) && Number.isFinite(a.y) && a.x >= r.x0 && a.x <= r.x1 && a.y >= r.y0 && a.y <= r.y1;
  }

  /** CSS px of a (fractional) cell centre on the current plane, or null before the renderer exists. */
  cellScreen(x: number, y: number): { x: number; y: number } | null {
    return this.ports.renderer()?.cellToScreen(this.plane, x, y) ?? null;
  }

  // ---------------------------------------------------------------- internals: picking

  /** The cell under a screen point on the current plane (renderer picking). */
  pick(x: number, y: number): Cell | null {
    const r = this.ports.renderer();
    if (!r) return null;
    const c = this.plane === 'yard' ? r.screenToYardCell(x, y) : r.screenToMineCell(x, y);
    if (!c) return null;
    if (this.plane === 'yard' && (c.y < 1 || c.y > 32)) return null;
    return c;
  }

  /** Fractional plane coordinates of a screen point (the local projection of cellToScreen, exact for the ortho camera). */
  planePoint(x: number, y: number): { x: number; y: number } | null {
    const r = this.ports.renderer();
    if (!r) return null;
    const ax = Math.floor(this.cam.cx);
    const ay = Math.floor(this.cam.cy);
    const j = this.jacobian(r, ax, ay);
    if (!j) return null;
    const s0 = r.cellToScreen(this.plane, ax, ay);
    const dx = x - s0.x;
    const dy = y - s0.y;
    return { x: ax + 0.5 + j.ia * dx + j.ib * dy, y: ay + 0.5 + j.ic * dx + j.id * dy };
  }

  /** Plane delta (cells) for a screen delta (px), from the local projection at the camera centre. */
  screenToPlaneDelta(dx: number, dy: number): { x: number; y: number } | null {
    const r = this.ports.renderer();
    if (!r) return null;
    const j = this.jacobian(r, Math.floor(this.cam.cx), Math.floor(this.cam.cy));
    if (!j) return null;
    return { x: j.ia * dx + j.ib * dy, y: j.ic * dx + j.id * dy };
  }

  /** Inverse of the 2×2 map plane → screen around a cell. */
  private jacobian(r: BuildRendererApi, x: number, y: number): { ia: number; ib: number; ic: number; id: number } | null {
    const s0 = r.cellToScreen(this.plane, x, y);
    const sx = r.cellToScreen(this.plane, x + 1, y);
    const sy = r.cellToScreen(this.plane, x, y + 1);
    const a = sx.x - s0.x;
    const c = sx.y - s0.y;
    const b = sy.x - s0.x;
    const d = sy.y - s0.y;
    const det = a * d - b * c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return null;
    return { ia: d / det, ib: -b / det, ic: -c / det, id: a / det };
  }

  /**
   * Where a footprint tool lands for a touch: centred on the lifted point. A drill snaps to a lode (03 §4.9): a
   * touch anywhere on a discovered lode (or the rows above it) takes that lode's drill site, the valid one if
   * either is (the survey plan's first on the scripted lode), else the nearer, so its red ghost gives the real
   * reason; elsewhere it snaps to a site within a cell.
   */
  private pieceAt(kind: BuildingKind, x: number, y: number, c: Cell): Cell {
    const def = BUILDINGS[kind];
    const fp = this.planePoint(x, y);
    const inCell = fp && Math.floor(fp.x) === c.x && Math.floor(fp.y) === c.y ? fp : { x: c.x + 0.5, y: c.y + 0.5 };
    const at = footprintAt(inCell.x, inCell.y, def.w, def.h);
    if (kind !== 'autoDrill') return at;
    // Unknown seams (v1 lodes in an MVP build) take no drill (canon §5.5).
    const visible = (l: Lode): boolean => l.scope !== 'v1' || this.world.scope === 'v1';
    const f = this.factory;
    const lode = lodeUnder(c, this.world.terrain.lodes, visible);
    if (lode) {
      const first = f && lode.id === this.world.meta.scriptedLodeId ? f.surveyPlan().drill : null;
      return lodeDrillSite(lode, inCell.x, (s) => !!f && f.canPlaceGhost({ kind: 'autoDrill', x: s.x, y: s.y }) === null, first);
    }
    const sites = drillSites(this.world.terrain.lodes, visible);
    return snapDrill(at, sites, (s) => !f || f.canPlaceGhost({ kind: 'autoDrill', x: s.x, y: s.y })?.code !== 'E_LODE') ?? snapDrill(at, sites) ?? at;
  }

  /** Factory entity under a point: the renderer's pick, else the cell lookup. */
  entityAt(x: number, y: number, c: Cell | null): number | null {
    const f = this.factory;
    if (!f) return null;
    const id = this.ports.renderer()?.pickEntity(x, y) ?? null;
    if (id !== null && f.entity(id)?.plane === this.plane) return id;
    if (!c) return null;
    if (this.plane === 'yard') {
      const b = f.yardBuildings()[c.y * W + c.x] ?? 0;
      return b > 0 ? b : null;
    }
    const e = f.entities().find((k) => k.plane === 'mine' && inFootprint(c, k.x, k.y, k.w, k.h));
    return e ? e.id : null;
  }

  private ghostAt(c: Cell): GhostView | null {
    if (this.plane !== 'mine') return null;
    return this.factory?.ghosts().find((g) => inFootprint(c, g.x, g.y, g.w, g.h)) ?? null;
  }

  private beltAt(c: Cell): boolean {
    const words = this.factory?.beltWords(this.plane);
    return !!words && (words[c.y * W + c.x] ?? 0) !== 0;
  }

  private inspectAt(x: number, y: number, c: Cell | null): void {
    const id = this.entityAt(x, y, c);
    if (id !== null) {
      this.openInspect(id);
      return;
    }
    const g = c ? this.ghostAt(c) : null;
    if (g) {
      this.openGhostInspect(g.id);
      return;
    }
    if (this.inspectId !== null || this.inspectGhost !== null) this.closeInspect();
    else this.publish();
  }

  // ---------------------------------------------------------------- internals: tools

  private hint(tool: Tool): string {
    if (tool === 'bulldoze') return 'Tap to mark, drag over belts';
    if (tool === 'belt') return this.plane === 'yard' ? 'Drag to paint belts' : 'Drag along a floor';
    if (tool === 'lift') return 'Tap the foot of the shaft';
    if (tool === 'autoDrill') return 'Tap the lode';
    return 'Tap to place';
  }

  private removePending(): Extract<Pending, { t: 'remove' }> {
    if (this.pending?.t !== 'remove') this.pending = { t: 'remove', id: null, ghost: null, cells: [] };
    return this.pending as Extract<Pending, { t: 'remove' }>;
  }

  private markBelt(p: Extract<Pending, { t: 'remove' }>, c: Cell): void {
    if (!p.cells.some((k) => sameCell(k, c))) p.cells.push({ x: c.x, y: c.y });
  }

  /** Bulldoze tap (03 §4.7): mark a building or ghost (a second tap unmarks), else toggle a belt cell. */
  private markAt(x: number, y: number, c: Cell): void {
    const p = this.removePending();
    const id = this.entityAt(x, y, c);
    if (id !== null) {
      p.id = p.id === id ? null : id;
      p.ghost = null;
      return;
    }
    const g = this.ghostAt(c);
    if (g) {
      p.ghost = p.ghost === g.id ? null : g.id;
      p.id = null;
      return;
    }
    if (this.beltAt(c)) {
      const k = p.cells.findIndex((q) => sameCell(q, c));
      if (k >= 0) p.cells.splice(k, 1);
      else p.cells.push(c);
    }
  }

  /** Lift taps (03 §4.5): the foot, then the top (column ±1); a tap below or far away starts a new foot. */
  private liftTap(c: Cell): void {
    const p = this.pending;
    if (p?.t === 'lift') {
      const ends = liftEnds({ x: p.x, y: p.foot }, c);
      if (ends) {
        p.top = ends.top;
        return;
      }
    }
    this.pending = { t: 'lift', x: c.x, foot: c.y, top: null, headframe: null };
  }

  /** Instant build commits placements on lift; painting and Bulldoze still preview (03 §4.3). */
  private instantCommits(): boolean {
    const p = this.pending;
    if (!p) return false;
    if (p.t === 'piece') return true;
    if (p.t === 'path') return p.cells.length === 1;
    if (p.t === 'run') return p.run.length === 1;
    if (p.t === 'lift') return p.top !== null;
    return false;
  }

  /** A Headframe for column x: one already there, a new one (with its cost check), or none possible. */
  headframePlan(x: number): HeadframePlan {
    const f = this.factory;
    if (!f) return { state: 'invalid' };
    for (const e of f.entities()) {
      if (e.plane === 'yard' && e.kind === 'headframe' && x >= e.x && x < e.x + e.w) return { state: 'existing', x0: e.x };
    }
    let fallback: HeadframePlan = { state: 'invalid' };
    for (const x0 of [x, x - 1]) {
      const e = f.canPlace('headframe', MK, x0, 1, DIR.S);
      if (!e) return { state: 'new', x0, err: null };
      if (e.code !== 'E_COLUMN' && e.code !== 'E_YARD' && fallback.state === 'invalid') fallback = { state: 'new', x0, err: e };
    }
    return fallback;
  }

  /** End-of-stroke port snap for Yard belts (03 §4.4). */
  private endSnap(cells: readonly Cell[]): Dir | undefined {
    const f = this.factory;
    if (!f || cells.length < 2) return undefined;
    const ids = f.yardBuildings();
    return snapEndDir(cells, (x, y, d) => {
      if (x < 0 || x >= W || y < 1 || y > f.yardRows) return false;
      const id = ids[y * W + x] ?? 0;
      const e = id ? f.entity(id) : null;
      return !!e && takesInput(e.kind, e.dir, d);
    });
  }

  private specOf(p: Pending): GhostSpec | null {
    if (p.t === 'piece') {
      if (p.kind === 'router') return { kind: 'router', x: p.x, y: p.y };
      if (p.kind === 'autoDrill') return { kind: 'autoDrill', mk: MK, x: p.x, y: p.y };
      return null;
    }
    if (p.t === 'run') return { kind: 'belt', mk: MK, x: p.run.x, y: p.run.y, dir: p.run.dir, length: p.run.length };
    if (p.t === 'lift' && p.top !== null) return { kind: 'lift', mk: MK, x: p.x, foot: p.foot, top: p.top };
    return null;
  }

  /** Run the synchronous validator on the pending ghost (02 §2.5): red preview + reason in the same frame. */
  validate(): void {
    const f = this.factory;
    const p = this.pending;
    this.error = null;
    if (!f || !p) return;
    switch (p.t) {
      case 'piece':
        this.error = this.plane === 'yard' ? f.canPlace(p.kind, MK, p.x, p.y, p.dir) : f.canPlaceGhost(this.specOf(p) as GhostSpec);
        return;
      case 'path': {
        const endDir = p.endDir ?? this.endSnap(p.cells);
        const dirs = pathDirs(p.cells, endDir);
        for (let i = 0; i < p.cells.length && !this.error; i++) this.error = f.canPlace('belt', MK, p.cells[i].x, p.cells[i].y, dirs[i]);
        if (this.error) return;
        const cost = yardBeltCost(p.cells, dirs, f.beltWords('yard'), BUILDINGS.belt.mks[0].cash);
        const cash = this.world.wallet.cash;
        if (cost > cash) this.error = err('E_FUNDS', { need: cost - cash });
        return;
      }
      case 'run': {
        // "Stops red at the first floorless cell" (03 §4.4): walk from the start; the run ends on the first bad cell.
        const run = p.run;
        for (let i = 0; i < run.cells.length; i++) {
          const c = run.cells[i];
          const e = f.canPlaceGhost({ kind: 'belt', mk: MK, x: c.x, y: c.y, dir: run.dir, length: 1 });
          if (!e) continue;
          if (i < run.cells.length - 1) p.run = { ...run, length: i + 1, cells: run.cells.slice(0, i + 1) };
          this.error = e;
          return;
        }
        this.error = f.canPlaceGhost(this.specOf(p) as GhostSpec);
        return;
      }
      case 'lift': {
        p.headframe = null;
        if (p.top === null) {
          const e = f.canPlaceGhost({ kind: 'lift', mk: MK, x: p.x, foot: p.foot, top: Math.max(0, p.foot - 1) });
          this.error = e && (e.y === undefined || e.y === p.foot) ? e : null;
          return;
        }
        this.error = f.canPlaceGhost(this.specOf(p) as GhostSpec);
        if (!this.error && p.top === 0) p.headframe = this.headframePlan(p.x);
        return;
      }
      case 'remove':
        return;
    }
  }

  private errCtx(): { kind?: BuildingKind; lodeHasDrill?: boolean } {
    const p = this.pending;
    if (!p) return {};
    if (p.t === 'piece') {
      const code = this.error?.code;
      if (p.kind !== 'autoDrill' || (code !== 'E_LODE' && code !== 'E_OCCUPIED')) return { kind: p.kind };
      // One drill per lode (02 §2.4): a built one refuses the site (E_LODE), a drill ghost overlaps it (E_OCCUPIED).
      const lode = this.world.terrain.lodes.find((l) => l.top === p.y + 2 && (p.x === l.x0 || p.x === l.x0 + 1));
      const f = this.factory;
      const onLode = (k: { kind: BuildingKind; x: number; y: number }): boolean => !!lode && k.kind === 'autoDrill' && k.y === lode.top - 2 && k.x >= lode.x0 && k.x <= lode.x0 + 1;
      const hasDrill = !!f && (f.entities().some(onLode) || f.ghosts().some(onLode));
      return { kind: p.kind, lodeHasDrill: hasDrill };
    }
    if (p.t === 'lift') return { kind: 'lift' };
    if (p.t === 'path' || p.t === 'run') return { kind: 'belt' };
    return {};
  }

  private removeChip(p: Extract<Pending, { t: 'remove' }>): { text: string; tone: 'info' | 'bad' } {
    const f = this.factory;
    const parts: string[] = [];
    let refund = 0;
    const e = p.id !== null ? f?.entity(p.id) : null;
    // The rusted survey set was free (02 §2.2): nothing comes back, and getting it again costs the list price.
    const survey = e?.plane === 'yard' && e.rusted ? e : null;
    if (e) {
      parts.push(survey ? `survey ${buildingName(e.kind)}` : buildingName(e.kind));
      refund += removalPrice(e).refund;
    }
    if (p.ghost !== null) parts.push('ghost');
    if (p.cells.length > 0 && f) {
      if (this.plane === 'yard') {
        // The factory's own diff (02 §2.7): a Junction pays back both tiles, and its crossing line goes too.
        const r = yardBeltRefund(p.cells, f.beltWords('yard'), (t) => BUILDINGS.belt.mks[t - 1]?.cash ?? 0);
        refund += r.refund;
        parts.push(`${r.tiles} belt${r.tiles === 1 ? '' : 's'}${r.crossings > 0 ? `, ${r.crossings} crossing${r.crossings === 1 ? '' : 's'}` : ''}`);
      } else parts.push(`${p.cells.length} belt${p.cells.length === 1 ? '' : 's'}`);
    }
    if (parts.length === 0) return { text: 'Tap to mark, drag over belts', tone: 'info' };
    const back = survey ? `rebuild ${formatCash(removalPrice(survey).rebuild)}` : this.plane === 'yard' ? `refund ${formatCash(refund)}` : 'Kits back';
    return { text: `Remove ${parts.join(' + ')} · ${back}`, tone: 'bad' };
  }

  /** Commit a validated pending ghost; records undo labels. */
  private commit(f: FactoryApi, p: Pending): boolean {
    switch (p.t) {
      case 'piece': {
        const name = buildingName(p.kind);
        if (this.plane === 'yard') return this.run(() => f.place(p.kind, MK, p.x, p.y, p.dir), name);
        const ok = this.run(() => f.placeGhost(this.specOf(p) as GhostSpec), `${name} ghost`);
        // A placed drill offers "Route to surface" next (03 §4.6).
        if (ok && p.kind === 'autoDrill') this.routeFrom = { x: p.x, y: p.y, w: 2, h: 2 };
        return ok;
      }
      case 'path': {
        const endDir = p.endDir ?? this.endSnap(p.cells);
        let label: string | null = `Belt ×${p.cells.length}`;
        return this.run(() => {
          const r = f.paintBelts(p.cells, MK, endDir);
          // 0 tiles changed: the factory recorded no step, so no label (the toasts stay in step with undo).
          if (r.ok) label = r.tiles > 0 ? `Belt ×${r.tiles}` : null;
          return r;
        }, () => label);
      }
      case 'run':
        return this.run(() => f.placeGhost(this.specOf(p) as GhostSpec), `Belt ghost ×${p.run.length}`);
      case 'lift': {
        const ok = this.run(() => f.placeGhost(this.specOf(p) as GhostSpec), `Lift ghost, ${p.foot - (p.top ?? p.foot)} rows`);
        const hf = p.headframe;
        if (ok && hf?.state === 'new' && hf.err === null) this.run(() => f.place('headframe', MK, hf.x0, 1, DIR.S), 'Headframe');
        else if (ok && hf?.state === 'new' && hf.err) this.app.toast(`Headframe: ${errText(hf.err, { kind: 'headframe' })}`, 'warn');
        return ok;
      }
      case 'remove': {
        let any = false;
        if (p.ghost !== null) any = this.run(() => f.removeGhost(p.ghost as number), 'Removed ghost') || any;
        const e = p.id !== null ? f.entity(p.id) : null;
        if (e) any = this.run(() => this.removeEntity(e), `Removed ${buildingName(e.kind)}`) || any;
        // Only cells that still hold a belt: an empty removal records no step (and so takes no label).
        const cells = p.cells.filter((c) => this.beltAt(c));
        if (cells.length > 0) any = this.run(() => this.removeBelts(cells), `Removed belt ×${cells.length}`) || any;
        return any;
      }
    }
  }

  private removeEntity(e: EntityView): Res<{ refund: number }> {
    const f = this.factory;
    if (!f) return err('E_INVALID');
    if (e.plane === 'yard') return f.deconstruct(e.id);
    const w = this.world as WorldApi & UndergroundOps;
    if (typeof w.deconstructUnderground === 'function') return w.deconstructUnderground(e.id);
    return f.deconstruct(e.id); // no World Kit sink: the Kit goes to the Stockpile (02 §2.7)
  }

  private removeBelts(cells: readonly Cell[]): Res<{ refund: number }> {
    const f = this.factory;
    if (!f) return err('E_INVALID');
    if (this.plane === 'yard') return f.removeBelts('yard', cells);
    const w = this.world as WorldApi & UndergroundOps;
    if (typeof w.removeUndergroundBelts === 'function') return w.removeUndergroundBelts(cells);
    return f.removeBelts('mine', cells);
  }

  /**
   * Run a recorded factory command: toast and error sound on failure; an undo label on success. A label function
   * returning null means the command was a no-op the factory did not record (03 §4.8: toasts name the real step).
   */
  private run(cmd: () => Res, label: string | (() => string | null)): boolean {
    let r: Res;
    try {
      r = cmd();
    } catch {
      r = err('E_INVALID');
    }
    if (!r.ok) {
      this.fail(r);
      return false;
    }
    const text = typeof label === 'function' ? label() : label;
    if (text === null) return true;
    this.undoLabels.push(text);
    if (this.undoLabels.length > UNDO_LABELS) this.undoLabels.shift();
    this.redoLabels.length = 0;
    this.app.afterAction({ ok: true });
    return true;
  }

  private history(kind: 'undo' | 'redo'): void {
    const f = this.factory;
    if (!f) return;
    const cash = this.world.wallet.cash;
    const r = kind === 'undo' ? f.undo() : f.redo();
    if (!r.ok) {
      this.app.toast(r.code === 'E_EMPTY' ? (kind === 'undo' ? 'Nothing to undo' : 'Nothing to redo') : errText(r), 'info');
      return;
    }
    const from = kind === 'undo' ? this.undoLabels : this.redoLabels;
    const to = kind === 'undo' ? this.redoLabels : this.undoLabels;
    const label = from.pop() ?? null;
    if (label !== null) to.push(label);
    this.app.toast(undoText(kind === 'undo' ? 'Undid' : 'Redid', label, this.world.wallet.cash - cash), 'info');
    this.app.afterAction({ ok: true });
    this.validate();
    this.publish();
  }

  private fail(e: Err, sound = true): void {
    const text = errText(e, this.errCtx());
    if (sound) this.app.afterAction({ ok: false, reason: text });
    else this.app.toast(text, 'warn');
  }

  /**
   * A red ghost after a tap or stroke: its reason is on the ghost label and in the pending chip, so it is toasted
   * only when the ghost is off screen (03 §6.2: at most one transient text).
   */
  private refuse(e: Err): void {
    if (!this.ghostOnScreen()) this.fail(e, false);
  }

  // ---------------------------------------------------------------- internals: camera

  /** The entry framing for a plane (03 §4.1, §5), with the zoom and Yard yaw the player last left it at. */
  defaultCam(plane: Plane): BuildCamera {
    const f = this.factory;
    const pod = this.world.pod;
    const view = this.viewByPlane[plane];
    const cam = defaultCamera(plane, { podX: pod.x, podY: pod.y, entities: f ? f.entities() : [] }, plane === 'yard' ? (view?.yaw ?? 0) : 0);
    const ppu = view?.ppu ?? cam.ppu;
    return clampCamera({ ...cam, ppu: clampPpu(plane, ppu, plane === 'yard' && isOneByOne(this.tool)) }, this.bounds(plane));
  }

  private rememberView(): void {
    this.viewByPlane[this.plane] = { ppu: this.cam.ppu, yaw: this.cam.yaw };
  }

  private bounds(plane: Plane = this.plane): ReturnType<typeof planeBounds> {
    return planeBounds(plane, this.factory?.yardRows ?? 8, this.world.story.deepestRow);
  }

  /** Arming a 1×1 tool eases the Yard zoom to its 44-ppu floor (03 §4.9). */
  private applyZoomFloor(): void {
    const ppu = clampPpu(this.plane, this.cam.ppu, this.plane === 'yard' && isOneByOne(this.tool));
    if (ppu !== this.cam.ppu || this.cam.plane !== this.plane) this.cam = { ...this.cam, plane: this.plane, ppu };
  }

  private centreOn(x: number, y: number): void {
    this.cam = clampCamera({ ...this.cam, cx: x, cy: y }, this.bounds());
    this.pushCamera();
  }

  private moveCamera(dx: number, dy: number): void {
    const next = clampCamera({ ...this.cam, cx: this.cam.cx + dx, cy: this.cam.cy + dy }, this.bounds());
    if (next.cx === this.cam.cx && next.cy === this.cam.cy) return;
    this.cam = next;
    this.pushCamera();
    this.bumpCursor();
  }

  private pushCamera(): void {
    if (!this.active) return;
    if (this.cam.plane !== this.plane) this.cam = { ...this.cam, plane: this.plane };
    this.ports.renderer()?.setBuildCamera(this.cam);
  }

  // ---------------------------------------------------------------- internals: publishing

  /** Plane cells the pending ghost covers (a path: its last tile), or null. */
  ghostRect(): { x: number; y: number; w: number; h: number } | null {
    const p = this.pending;
    if (!p) return null;
    switch (p.t) {
      case 'piece':
        return { x: p.x, y: p.y, w: BUILDINGS[p.kind].w, h: BUILDINGS[p.kind].h };
      case 'path': {
        const c = p.cells[p.cells.length - 1];
        return c ? { x: c.x, y: c.y, w: 1, h: 1 } : null;
      }
      case 'run': {
        const x0 = Math.min(...p.run.cells.map((c) => c.x));
        return { x: x0, y: p.run.y, w: p.run.length, h: 1 };
      }
      case 'lift': {
        const top = p.top ?? p.foot;
        return { x: p.x, y: top, w: 1, h: p.foot - top + 1 };
      }
      case 'remove': {
        const e = p.id !== null ? this.factory?.entity(p.id) : null;
        if (e) return { x: e.x, y: e.y, w: e.w, h: e.h };
        const g = p.ghost !== null ? this.factory?.ghosts().find((k) => k.id === p.ghost) : null;
        if (g) return { x: g.x, y: g.y, w: g.w, h: g.h };
        const c = p.cells[p.cells.length - 1];
        return c ? { x: c.x, y: c.y, w: 1, h: 1 } : null;
      }
    }
  }

  private preview(): BuildFrame['preview'] {
    const p = this.pending;
    const f = this.factory;
    if (!p || !f) return null;
    const valid = this.error === null;
    switch (p.t) {
      case 'piece': {
        const d = BUILDINGS[p.kind];
        return { kind: p.kind, mk: MK, x: p.x, y: p.y, w: d.w, h: d.h, dir: d.rotates ? p.dir : DIR.S, valid };
      }
      case 'path': {
        const dirs = pathDirs(p.cells, p.endDir ?? this.endSnap(p.cells));
        const c = p.cells[0];
        return { kind: 'belt', mk: MK, x: c.x, y: c.y, w: 1, h: 1, dir: dirs[dirs.length - 1], valid, path: p.cells.slice() };
      }
      case 'run': {
        const x0 = Math.min(...p.run.cells.map((c) => c.x));
        return { kind: 'belt', mk: MK, x: x0, y: p.run.y, w: p.run.length, h: 1, dir: p.run.dir, valid, path: p.run.cells.slice() };
      }
      case 'lift': {
        const top = p.top ?? p.foot;
        return { kind: 'lift', mk: MK, x: p.x, y: top, w: 1, h: p.foot - top + 1, dir: DIR.N, valid };
      }
      case 'remove': {
        const e = p.id !== null ? f.entity(p.id) : null;
        const g = p.ghost !== null ? f.ghosts().find((k) => k.id === p.ghost) : null;
        const path = p.cells.length > 0 ? p.cells.slice() : undefined;
        if (e) return { kind: e.kind, mk: e.mk, x: e.x, y: e.y, w: e.w, h: e.h, dir: e.dir, valid: false, path };
        if (g) return { kind: g.kind, mk: g.mk, x: g.x, y: g.y, w: g.w, h: g.h, dir: g.dir, valid: false, path };
        if (path) return { kind: 'belt', mk: MK, x: path[0].x, y: path[0].y, w: 1, h: 1, dir: DIR.E, valid: false, path };
        return null;
      }
    }
  }

  /** Write AppState.buildFrame (the renderer copies it into RenderFrame.build every frame). */
  private writeFrame(): void {
    if (!this.active) return;
    const p = this.pending;
    const marked = p?.t === 'remove' ? p.id : null;
    // `tool`: the armed building (null for none or Bulldoze), so the underground placement highlight can show
    // where it may go before the first tap (03 §4.12).
    const frame: BuildFrame = {
      plane: this.plane,
      cursor: this.cursorCell ? { x: this.cursorCell.x, y: this.cursorCell.y } : null,
      preview: this.preview(),
      bulldoze: this.tool === 'bulldoze',
      selectedId: this.inspectId ?? marked,
      overlay: this.overlay ? 'logistics' : null,
      tool: this.tool === 'bulldoze' ? null : this.tool,
    };
    this.ports.app.state.buildFrame.value = frame;
  }

  private publish(): void {
    this.writeFrame();
    this.bump();
    this.bumpCursor();
  }

  private bump(): void {
    this.version.value++;
  }

  private bumpCursor(): void {
    this.cursorVersion.value++;
  }
}

function clonePending(p: Pending | null): Pending | null {
  if (!p) return null;
  switch (p.t) {
    case 'piece':
      return { ...p };
    case 'path':
      return { ...p, cells: p.cells.slice() };
    case 'run':
      return { ...p, run: { ...p.run, cells: p.run.cells.slice() } };
    case 'lift':
      return { ...p };
    case 'remove':
      return { ...p, cells: p.cells.slice() };
  }
}

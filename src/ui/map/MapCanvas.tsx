// The basic map's canvas (03 §6.6): the charted-cell image scaled with nearest filtering, the Rim buildings above
// row 0, registered layers (lifts), lode markers (? / P / N / R, ≥ 24 pt), Dot's pings and the pod. One finger
// pans, two pinch (3–14 pt per cell), a tap snaps to the nearest marker within 22 pt. Drawn on demand, plus a
// 10-Hz pulse for the pings and the pod while the sheet is open.
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { MINE_W, RIM_BUILDINGS, TOUCH, type RimBuildingId } from '../../shared/canon';
import { ORES, POD, ROLE, SURFACE, UI } from '../../render/palette';
import {
  FOG,
  MAP_SKY_ROWS,
  MARKER_PT,
  centreOn,
  clampView,
  initialView,
  knownLodes,
  mapLayers,
  mapRows,
  paintMap,
  snapMarker,
  toScreen,
  zoomAbout,
  type MapLode,
  type MapView,
  type Marker,
} from './mapModel';

export type MapSelection = { kind: 'lode'; lode: MapLode } | { kind: 'pod'; row: number };

const RIM_COLOUR: Record<RimBuildingId, number> = { pump: ROLE.furnace, assay: ORES[3].base, garage: ROLE.assembly, shed: ROLE.storage };
const RIM_LABEL: Record<RimBuildingId, string> = { pump: 'Pump', assay: 'Assay', garage: 'Garage', shed: 'Shed' };
const LODE_FILL = ROLE.extraction;
const PULSE_MS = 100;
const PULSE_PERIOD_MS = 1400;

function css(c: number, a = 1): string {
  return `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${a})`;
}

interface Pointer {
  x: number;
  y: number;
  x0: number;
  y0: number;
  t0: number;
}

/** Map state for one open sheet: image, view, markers and the gesture in progress. */
class MapPainter {
  readonly image = document.createElement('canvas');
  view: MapView | null = null;
  lodes: MapLode[] = [];
  readonly markers: Marker[] = [];
  selected: string | null = null;
  reducedMotion = false;
  private readonly pointers = new Map<number, Pointer>();
  private pinchD = 0;
  private dirty = true;
  private raf = 0;
  private lastPulse = 0;

  constructor(
    private readonly app: AppController,
    private readonly canvas: HTMLCanvasElement,
    private readonly onSelect: (s: MapSelection | null) => void,
  ) {
    const w = app.world;
    const rows = mapRows(w.scope);
    this.image.width = MINE_W;
    this.image.height = rows;
    const ctx = this.image.getContext('2d');
    // The UI harness's fake world has no terrain: an all-fog map.
    if (ctx && w.terrain) {
      const data = ctx.createImageData(MINE_W, rows);
      paintMap(w.terrain, w.scope, data.data);
      ctx.putImageData(data, 0, 0);
    }
    this.lodes = w.terrain ? knownLodes(w.terrain.lodes, w.scope, w.story.deepestRow) : [];
  }

  get rows(): number {
    return mapRows(this.app.world.scope);
  }

  podRow(): number {
    return -this.app.world.pod.y;
  }

  /** Canvas resized (pt): keep the view centre, or start centred on the pod. */
  resize(w: number, h: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    if (!this.view) this.view = initialView(w, h, this.rows, Math.max(0, this.podRow()));
    else {
      this.view.w = w;
      this.view.h = h;
      clampView(this.view, this.rows);
    }
    this.invalidate();
  }

  centreOnPod(): void {
    if (!this.view) return;
    centreOn(this.view, this.app.world.pod.x, this.podRow(), this.rows);
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly tick = (t: number): void => {
    this.raf = 0;
    const pulse = !this.reducedMotion && t - this.lastPulse >= PULSE_MS;
    if (this.dirty || pulse) {
      this.lastPulse = t;
      this.dirty = false;
      this.draw(t);
    }
    if (!this.reducedMotion || this.dirty) this.raf = requestAnimationFrame(this.tick);
  };

  // ---- gestures (canvas-local pt) ------------------------------------------------------------

  down(id: number, x: number, y: number, t: number): void {
    this.pointers.set(id, { x, y, x0: x, y0: y, t0: t });
    if (this.pointers.size === 2) this.pinchD = this.spread();
  }

  move(id: number, x: number, y: number): void {
    const p = this.pointers.get(id);
    const v = this.view;
    if (!p || !v) return;
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    if (this.pointers.size >= 2) {
      const d = this.spread();
      const mid = this.mid();
      if (this.pinchD > 0 && d > 0) zoomAbout(v, d / this.pinchD, mid.x, mid.y, this.rows);
      this.pinchD = d;
      // Both fingers moving together pan as well (half each).
      v.ox += dx / 2;
      v.oy += dy / 2;
    } else {
      v.ox += dx;
      v.oy += dy;
    }
    clampView(v, this.rows);
    this.invalidate();
  }

  up(id: number, x: number, y: number, t: number): void {
    const p = this.pointers.get(id);
    this.pointers.delete(id);
    if (this.pointers.size < 2) this.pinchD = 0;
    if (!p || this.pointers.size > 0) return;
    const tap = t - p.t0 < TOUCH.tapMs && Math.hypot(x - p.x0, y - p.y0) < TOUCH.tapMovePt;
    if (tap) this.tap(x, y);
  }

  cancel(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size < 2) this.pinchD = 0;
  }

  /** Mouse wheel / trackpad pinch (desktop). */
  wheel(dy: number, x: number, y: number): void {
    if (!this.view) return;
    zoomAbout(this.view, Math.exp(-dy * 0.002), x, y, this.rows);
    this.invalidate();
  }

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private mid(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
  }

  private tap(x: number, y: number): void {
    const hit = snapMarker(this.markers, x, y);
    this.selected = hit?.id ?? null;
    if (!hit) this.onSelect(null);
    else if (hit.id === 'pod') this.onSelect({ kind: 'pod', row: Math.max(0, Math.floor(this.podRow())) });
    else {
      const lode = this.lodes.find((l) => `lode${l.id}` === hit.id);
      this.onSelect(lode ? { kind: 'lode', lode } : null);
    }
    this.invalidate();
  }

  // ---- drawing --------------------------------------------------------------------------------

  private draw(t: number): void {
    const v = this.view;
    const ctx = this.canvas.getContext('2d');
    if (!v || !ctx) return;
    const dpr = this.canvas.width / Math.max(1, v.w);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css(FOG);
    ctx.fillRect(0, 0, v.w, v.h);
    this.drawSky(ctx, v);
    ctx.imageSmoothingEnabled = false;
    const top = toScreen(v, 0, 0);
    ctx.drawImage(this.image, top.x, top.y, MINE_W * v.scale, this.rows * v.scale);
    for (const layer of mapLayers()) layer.draw(ctx, v, toScreen);
    const phase = this.reducedMotion ? 0.5 : (t % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
    this.markers.length = 0;
    for (const l of this.lodes) this.drawLode(ctx, v, l, phase);
    this.drawPod(ctx, v, phase);
  }

  private drawSky(ctx: CanvasRenderingContext2D, v: MapView): void {
    const sky = toScreen(v, 0, -MAP_SKY_ROWS);
    ctx.fillStyle = css(SURFACE.skyBottom);
    ctx.fillRect(sky.x, sky.y, MINE_W * v.scale, MAP_SKY_ROWS * v.scale);
    ctx.font = `700 ${Math.max(8, Math.min(12, v.scale * 1.4))}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of RIM_BUILDINGS) {
      const p = toScreen(v, b.x0, -2);
      const w = (b.x1 - b.x0 + 1) * v.scale;
      ctx.fillStyle = css(RIM_COLOUR[b.id]);
      ctx.fillRect(p.x, p.y, w, 2 * v.scale);
      ctx.strokeStyle = css(UI.ink);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x + 0.75, p.y + 0.75, w - 1.5, 2 * v.scale - 1.5);
      if (v.scale >= 5) {
        ctx.fillStyle = css(UI.ink);
        ctx.fillText(RIM_LABEL[b.id], p.x + w / 2, p.y + v.scale);
      }
    }
  }

  private drawLode(ctx: CanvasRenderingContext2D, v: MapView, l: MapLode, phase: number): void {
    const p = toScreen(v, l.cx, l.cr);
    const id = `lode${l.id}`;
    this.markers.push({ id, x: p.x, y: p.y });
    const r = MARKER_PT / 2;
    if (l.pinged) {
      ctx.strokeStyle = css(ROLE.chevron, 1 - phase);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4 + phase * 14, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x + r, p.y);
    ctx.lineTo(p.x, p.y + r);
    ctx.lineTo(p.x - r, p.y);
    ctx.closePath();
    ctx.fillStyle = css(l.colour ?? LODE_FILL);
    ctx.fill();
    ctx.lineWidth = this.selected === id ? 4 : 2;
    ctx.strokeStyle = css(this.selected === id ? ROLE.chevron : UI.ink);
    ctx.stroke();
    ctx.fillStyle = css(UI.ink);
    ctx.font = '900 12px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.letter, p.x, p.y + 0.5);
  }

  private drawPod(ctx: CanvasRenderingContext2D, v: MapView, phase: number): void {
    const pod = this.app.world.pod;
    const p = toScreen(v, pod.x, Math.max(-MAP_SKY_ROWS + 0.5, this.podRow()));
    this.markers.push({ id: 'pod', x: p.x, y: p.y });
    const r = MARKER_PT / 2;
    ctx.strokeStyle = css(POD.visor, 0.9 * (1 - phase));
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + phase * 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = css(POD.body);
    ctx.strokeStyle = css(this.selected === 'pod' ? ROLE.chevron : UI.ink);
    ctx.lineWidth = this.selected === 'pod' ? 4 : 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = css(POD.visor);
    ctx.beginPath();
    ctx.arc(p.x + 2 * pod.facing, p.y - 1, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface MapCanvasProps {
  app: AppController;
  onSelect(s: MapSelection | null): void;
  /** Receives the "Center on pod" action once the canvas is up. */
  centreRef: { current: (() => void) | null };
}

export function MapCanvas({ app, onSelect, centreRef }: MapCanvasProps): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = wrap.current;
    const cv = canvas.current;
    if (!box || !cv) return;
    const painter = new MapPainter(app, cv, onSelect);
    painter.reducedMotion = app.state.settings.peek().reducedMotion;
    centreRef.current = () => painter.centreOnPod();
    const measure = (): void => painter.resize(box.clientWidth, box.clientHeight);
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(box);
    const local = (e: MouseEvent): [number, number] => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const onDown = (e: PointerEvent): void => {
      cv.setPointerCapture?.(e.pointerId);
      painter.down(e.pointerId, ...local(e), e.timeStamp);
    };
    const onMove = (e: PointerEvent): void => painter.move(e.pointerId, ...local(e));
    const onUp = (e: PointerEvent): void => painter.up(e.pointerId, ...local(e), e.timeStamp);
    const onCancel = (e: PointerEvent): void => painter.cancel(e.pointerId);
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      painter.wheel(e.deltaY, ...local(e));
    };
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onCancel);
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro?.disconnect();
      painter.dispose();
      centreRef.current = null;
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onCancel);
      cv.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div ref={wrap} class="hf-map-wrap">
      <canvas ref={canvas} class="hf-map-canvas" role="img" aria-label="Map of the charted mine" />
    </div>
  );
}

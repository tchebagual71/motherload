// Build-mode screen (03 §2.3–2.4, §4.1; UX review M8): the top bar is status only (cash, plane, ◫ overlay); the
// 56-pt dock band [✕ Done] [↶] [↷] … [✋] [↻] [✗] [✓] (✓ on the dominant-thumb side) sits over the 128-pt card tray
// ([Yard│Mine] + tabs, 64 × 76 cards); − / + zoom and ⟳ yaw stack on the non-dominant side; the pending chip, L mode
// and the Shopping list sit on the dominant side. The world area between them takes the build gestures.
import type { Signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { BUILDINGS } from '../../factory/api';
import { TOUCH } from '../../shared/canon';
import { formatCash, formatCashHud } from '../format';
import { GoalChip } from '../story/GoalChip';
import type { Viewport } from '../viewport';
import { LABEL, NUDGE_BOX, labelBox, labelWidth, nudgeSpot } from './aids';
import { Glyph, kindGlyph, roleColour, type GlyphName } from './glyphs';
import { InspectSheet } from './Inspect';
import { drawLoupe, loupeCaption, loupeCells } from './loupe';
import type { BuildSession } from './session';
import { buildingName, kitName } from './text';
import {
  BTN,
  BUBBLE_SAY,
  DOCK_H,
  LOUPE,
  TABS,
  TRAY_H,
  bubbleLines,
  cardsFor,
  dockLayout,
  kitsInCargo,
  loupePlace,
  shoppingList,
  shoppingSummary,
  type DockId,
  type Rect,
} from './tools';
import './build.css';

export interface BuildLayerProps {
  app: AppController;
  build: BuildSession;
  vp: Signal<Viewport>;
}

const EDGE = 8;
const GAP = 8;
/**
 * The tap that opened build mode (BUILD, ≡ → Build) ends with a native click a moment later, which would land on
 * whatever dock or tray button now sits under the finger: build controls ignore clicks this soon after opening.
 */
export const GHOST_CLICK_MS = 400;

type Guard = (fn: () => void) => () => void;

export function BuildLayer({ app, build, vp }: BuildLayerProps): JSX.Element {
  build.version.value;
  const v = vp.value;
  const left = app.state.settings.value.leftHanded;
  const dockTop = v.h - v.ib - TRAY_H - DOCK_H;
  const opened = useRef(performance.now());
  const guard: Guard = (fn) => () => {
    if (performance.now() - opened.current >= GHOST_CLICK_MS) fn();
  };
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The story slot is not shown here: toasts must not stay pushed down under a card from play mode.
    (root.current?.closest('.hf-ui') as HTMLElement | null)?.style.setProperty('--hf-story-h', '0px');
  }, []);
  const panInDock = dockLayout(v.w, left).some((s) => s.id === 'pan');
  return (
    <div ref={root} class={`hf-build${left ? ' hf-build-left' : ''}`} data-plane={build.plane}>
      <TopBar app={app} build={build} guard={guard} />
      <BuildGoal app={app} />
      <GhostAids app={app} build={build} guard={guard} />
      {build.overlay && <StatusList app={app} build={build} />}
      <Loupe app={app} build={build} vp={vp} />
      <SideStack build={build} dockTop={dockTop} left={left} pan={!panInDock} guard={guard} />
      <Chips app={app} build={build} dockTop={dockTop} left={left} vh={v.h} guard={guard} />
      <HeadframePip build={build} top={v.it + 44 + 40} left={left} />
      <Dock app={app} build={build} top={dockTop} width={v.w} left={left} guard={guard} />
      <Tray app={app} build={build} guard={guard} />
      {(build.inspectId !== null || build.inspectGhost !== null) && <InspectSheet app={app} build={build} />}
    </div>
  );
}

/** The goal chip (01 §2.3) stays in build mode: onboarding goals are build steps. Radio cards wait for play. */
function BuildGoal({ app }: { app: AppController }): JSX.Element | null {
  app.state.hudTick.value;
  const goal = app.state.goal.value;
  const now = performance.now();
  if (!goal || app.state.toasts.value.some((t) => t.until > now)) return null;
  return (
    <div class="hf-story">
      <GoalChip goal={goal} />
    </div>
  );
}

// ---------------------------------------------------------------- top bar (status only)

function TopBar({ app, build, guard }: { app: AppController; build: BuildSession; guard: Guard }): JSX.Element {
  app.state.hudTick.value;
  const cash = app.world.wallet.cash;
  return (
    <div class="hf-bt-top" role="group" aria-label="Build status">
      <span class="hf-bt-cash hf-digits" aria-label={`Cash ${formatCash(cash)}`}>
        {formatCashHud(cash)}
      </span>
      <span class="hf-bt-title">Build · {build.plane === 'yard' ? 'Yard' : 'Mine'}</span>
      <button
        type="button"
        class={`hf-bt-icon${build.overlay ? ' hf-on' : ''}`}
        aria-label="Logistics overlay (O)"
        aria-pressed={build.overlay}
        onClick={guard(() => build.toggleOverlay())}
      >
        <Glyph name="overlay" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- dock band

const DOCK_LABEL: Readonly<Record<DockId, string>> = {
  done: 'Done (Esc)',
  undo: 'Undo (Ctrl Z)',
  redo: 'Redo (Ctrl Shift Z)',
  pan: 'Pan latch',
  rotate: 'Rotate (R)',
  clear: 'Clear',
  ok: 'Confirm (Enter)',
};
const DOCK_GLYPH: Readonly<Record<DockId, GlyphName>> = {
  done: 'done',
  undo: 'undo',
  redo: 'redo',
  pan: 'pan',
  rotate: 'rotate',
  clear: 'bulldoze',
  ok: 'ok',
};

function Dock({ app, build, top, width, left, guard }: { app: AppController; build: BuildSession; top: number; width: number; left: boolean; guard: Guard }): JSX.Element {
  const slots = dockLayout(width, left);
  const yard = build.plane === 'yard';
  const pending = build.pending !== null;
  const act = (id: DockId): void => {
    switch (id) {
      case 'done':
        app.exitBuild();
        return;
      case 'undo':
        build.undo();
        return;
      case 'redo':
        build.redo();
        return;
      case 'pan':
        build.togglePanLatch();
        return;
      case 'rotate':
        build.rotate();
        return;
      case 'clear':
        build.clear();
        return;
      case 'ok':
        build.confirm();
        return;
    }
  };
  return (
    <div class="hf-dock" style={{ top: `${top}px`, height: `${DOCK_H}px` }} role="toolbar" aria-label="Build tools">
      {slots.map((s) => {
        if (s.id === 'rotate' && !yard) return null; // no ↻ underground (03 §2.4)
        const disabled =
          (s.id === 'undo' && !build.canUndo) || (s.id === 'redo' && !build.canRedo) || (s.id === 'ok' && !build.canConfirm) || (s.id === 'rotate' && !canRotate(build));
        const on = (s.id === 'pan' && build.panLatch) || (s.id === 'clear' && build.tool === 'bulldoze');
        const label = s.id === 'clear' ? (pending ? 'Clear ghost' : build.tool === 'bulldoze' ? 'Bulldoze on' : 'Bulldoze (Delete)') : DOCK_LABEL[s.id];
        return (
          <button
            key={s.id}
            type="button"
            class={`hf-dock-btn hf-dock-${s.id}${on ? ' hf-on' : ''}`}
            style={{ left: `${s.x}px`, width: `${s.w}px`, height: `${BTN}px` }}
            data-dock={s.id}
            aria-label={label}
            aria-pressed={s.id === 'pan' || s.id === 'clear' ? on : undefined}
            disabled={disabled}
            onClick={guard(() => act(s.id))}
          >
            <Glyph name={s.id === 'clear' && pending ? 'done' : DOCK_GLYPH[s.id]} size={s.id === 'ok' ? 26 : 22} />
            {s.id === 'done' && <span class="hf-dock-cap">Done</span>}
          </button>
        );
      })}
    </div>
  );
}

/** ↻ applies to the pending piece, a one-tile belt, or the armed type (02 §2.1: Yard pieces that rotate). */
function canRotate(b: BuildSession): boolean {
  if (b.plane !== 'yard') return false;
  const p = b.pending;
  if (p?.t === 'piece') return BUILDINGS[p.kind].rotates;
  if (p?.t === 'path') return p.cells.length === 1;
  return b.tool !== null && b.tool !== 'bulldoze' && BUILDINGS[b.tool].rotates;
}

// ---------------------------------------------------------------- zoom / yaw stack (non-dominant side)

function SideStack({ build, dockTop, left, pan, guard }: { build: BuildSession; dockTop: number; left: boolean; pan: boolean; guard: Guard }): JSX.Element {
  const side = left ? { right: `${EDGE}px` } : { left: `${EDGE}px` };
  const at = (k: number): string => `${dockTop - (BTN + GAP) * k}px`;
  const yaw = build.plane === 'yard';
  return (
    <>
      {pan && (
        <button
          type="button"
          class={`hf-side-btn${build.panLatch ? ' hf-on' : ''}`}
          style={{ ...side, top: at(yaw ? 4 : 3) }}
          data-dock="pan"
          aria-label="Pan latch"
          aria-pressed={build.panLatch}
          onClick={guard(() => build.togglePanLatch())}
        >
          <Glyph name="pan" />
        </button>
      )}
      {yaw && (
        <button type="button" class="hf-side-btn" style={{ ...side, top: at(3) }} aria-label="Turn the view 90° ( ] )" onClick={guard(() => build.yawStep(1))}>
          <Glyph name="yaw" />
        </button>
      )}
      <button type="button" class="hf-side-btn" style={{ ...side, top: at(2) }} aria-label="Zoom in (+)" onClick={guard(() => build.zoomIn())}>
        <Glyph name="plus" />
      </button>
      <button type="button" class="hf-side-btn" style={{ ...side, top: at(1) }} aria-label="Zoom out (−)" onClick={guard(() => build.zoomOut())}>
        <Glyph name="minus" />
      </button>
    </>
  );
}

// ---------------------------------------------------------------- chips (dominant side)

function Chips({ app, build, dockTop, left, vh, guard }: { app: AppController; build: BuildSession; dockTop: number; left: boolean; vh: number; guard: Guard }): JSX.Element {
  app.state.hudTick.value; // Kits in the bay change as ghosts complete
  const side = left ? { left: `${EDGE}px` } : { right: `${EDGE}px` };
  const chip = build.chip();
  const f = app.world.factory;
  const ghosts = build.plane === 'mine' && f ? f.ghosts() : [];
  const lines = ghosts.length > 0 ? shoppingList(ghosts, kitsInCargo(app.world.pod.cargo)) : [];
  const summary = lines.length > 0 ? shoppingSummary(lines) : null;
  const yardBelt = build.plane === 'yard' && build.tool === 'belt';
  const route = routeOffer(build);
  let y = dockTop - GAP - 28;
  const stack: JSX.Element[] = [];
  if (chip) {
    stack.push(
      <div key="pending" class={`hf-pending hf-pending-${chip.tone}`} style={{ ...side, top: `${y}px` }} role="status" aria-live="polite">
        {chip.text}
      </div>,
    );
    y -= 28 + GAP;
  }
  if (summary) {
    stack.push(
      <button
        key="shop"
        type="button"
        class={`hf-shop-chip${summary.short ? ' hf-short' : ''}`}
        style={{ ...side, top: `${y - 16}px` }}
        aria-expanded={build.shoppingOpen}
        onClick={guard(() => build.toggleShopping())}
      >
        <Glyph name="kits" size={18} />
        {summary.text}
        {summary.short ? ' ⚠' : ''}
      </button>,
    );
    y -= 44 + GAP - 16;
  }
  if (route) {
    stack.push(
      <button key="route" type="button" class="hf-route-chip" style={{ ...side, top: `${y - 16}px` }} onClick={guard(() => void build.routeToSurface())}>
        <Glyph name="route" size={18} />
        Route to surface
      </button>,
    );
    y -= 44 + GAP - 16;
  }
  if (yardBelt) {
    const top = y - 16;
    stack.push(
      <button
        key="lmode"
        type="button"
        class={`hf-side-btn hf-lmode${build.lMode ? ' hf-on' : ''}`}
        style={{ ...side, top: `${top}px` }}
        aria-label="L mode (L)"
        aria-pressed={build.lMode}
        onClick={guard(() => build.toggleLMode())}
      >
        <Glyph name="lmode" />
      </button>,
    );
    if (build.lMode) {
      const flipSide = left ? { left: `${EDGE + BTN + GAP}px` } : { right: `${EDGE + BTN + GAP}px` };
      stack.push(
        <button key="lflip" type="button" class="hf-side-btn" style={{ ...flipSide, top: `${top}px` }} aria-label="Flip the L legs" onClick={guard(() => build.flipL())}>
          <Glyph name="flip" />
        </button>,
      );
    }
  }
  return (
    <>
      {stack}
      {build.shoppingOpen && summary && (
        <div class="hf-shop-list" style={{ ...side, bottom: `${vh - y - 28}px` }} role="dialog" aria-label="Shopping list">
          <h3>Shopping list</h3>
          <ul>
            {lines.map((l) => (
              <li key={l.kit} class={l.buyKits > 0 ? 'hf-short' : ''}>
                <span>{kitName(l.kit)}</span>
                <span class="hf-digits">
                  {l.haveKits}/{l.needKits}
                  {l.buyKits > 0 ? ` · buy ${l.buyKits}` : ' ✓'}
                </span>
              </li>
            ))}
          </ul>
          <p>{summary.short ? 'Buy at the Supply Shed, then come back: Pip builds ghosts by staying close.' : 'All Kits aboard: stay within 2 tiles of each ghost.'}</p>
        </div>
      )}
    </>
  );
}

/** "Route to surface" is offered after Place drill, and for a lift foot not yet topped out (03 §4.6). */
function routeOffer(b: BuildSession): boolean {
  if (b.plane !== 'mine') return false;
  const p = b.pending;
  if (p?.t === 'lift') return p.top !== 0 && b.routeFromFoot({ x: p.x, y: p.foot }) !== null;
  if (b.routeFrom && (b.tool === 'autoDrill' || b.tool === 'lift') && !p) return b.routeFromPiece(b.routeFrom) !== null;
  return false;
}

// ---------------------------------------------------------------- Headframe picture-in-picture (03 §4.5 step 4)

function HeadframePip({ build, top, left }: { build: BuildSession; top: number; left: boolean }): JSX.Element | null {
  const p = build.pending;
  if (p?.t !== 'lift' || p.top !== 0 || !p.headframe || build.plane !== 'mine') return null;
  const hf = p.headframe;
  const side = left ? { right: `${EDGE}px` } : { left: `${EDGE}px` };
  let body: string;
  let tone = 'good';
  if (hf.state === 'existing') body = `Headframe stands at x ${hf.x0}–${hf.x0 + 1} ✓`;
  else if (hf.state === 'new' && hf.err === null) body = `+ Headframe at x ${hf.x0}–${hf.x0 + 1} · $200`;
  else if (hf.state === 'new') {
    body = `Headframe: ${hf.err?.code === 'E_FUNDS' ? `need ${formatCash(hf.err.need ?? 0)} more` : 'spot blocked'}`;
    tone = 'bad';
  } else {
    body = 'No Headframe column here';
    tone = 'bad';
  }
  return (
    <div class={`hf-pip hf-pip-${tone}`} style={{ ...side, top: `${top}px` }} role="status">
      <span class="hf-pip-title">Yard</span>
      <span class="hf-pip-yard" aria-hidden="true">
        <i class="hf-pip-rim" />
        <i class="hf-pip-hf" style={{ left: `${hf.state === 'invalid' ? 50 : 38}%` }} />
      </span>
      <span class="hf-pip-text">{body}</span>
    </div>
  );
}

// ---------------------------------------------------------------- ghost label, status list, loupe

/** Plane directions for the nudge arrows: Yard E, N (toward the Rim), W, S; underground E and W only. */
const NUDGE: readonly { dx: number; dy: number; label: string }[] = [
  { dx: 1, dy: 0, label: 'Nudge east' },
  { dx: -1, dy: 0, label: 'Nudge west' },
  { dx: 0, dy: 1, label: 'Nudge away from the Rim' },
  { dx: 0, dy: -1, label: 'Nudge toward the Rim' },
];

/** Top of the world area the reason label keeps clear of: the goal chip, or the toast stack (styles.css .hf-toasts). */
function labelTopClear(app: AppController, y0: number): number {
  const now = performance.now();
  const toasts = app.state.toasts.value.filter((t) => t.until > now).length;
  if (toasts > 0) return y0 + 22 + toasts * 46;
  return app.state.goal.value ? y0 + 40 : y0 + 4;
}

/**
 * The pending ghost's aids: the red reason label on the ghost (03 §6.2), a ⊘ badge that marks an invalid ghost
 * without relying on its hue (a valid Smelter's coral is close to the invalid red, 03 §4.3), and the 44-pt nudge
 * arrows (03 §4.3: 4 on the Yard, 2 underground) placed clear of the label and of the fingers that grab the ghost.
 */
function GhostAids({ app, build, guard }: { app: AppController; build: BuildSession; guard: Guard }): JSX.Element | null {
  build.cursorVersion.value;
  app.state.hudTick.value; // toasts expire
  const labelRef = useRef<HTMLDivElement>(null);
  const p = build.pending;
  const fp = build.ghostRect();
  const area = build.area;
  const bad = !!p && !!build.error && build.active;
  const chip = bad ? build.chip() : null;
  let label: { x: number; y: number; w: number; h: number } | null = null;
  let anchor: { x: number; y: number } | null = null;
  let below = 0;
  const topClear = labelTopClear(app, area.y0);
  if (bad && chip && fp && build.ghostOnScreen()) {
    anchor = build.ghostAnchor();
    for (const [x, y] of [[fp.x, fp.y], [fp.x + fp.w - 1, fp.y], [fp.x, fp.y + fp.h - 1], [fp.x + fp.w - 1, fp.y + fp.h - 1]]) {
      const c = build.cellScreen(x, y);
      if (c) below = Math.max(below, c.y + 16);
    }
    if (anchor) label = labelBox(anchor, below, labelWidth(chip.text), LABEL.h, area, topClear);
  }
  useLayoutEffect(() => {
    // Re-centre on the measured width (the estimate only reserves room for the arrows).
    const el = labelRef.current;
    if (!el || !anchor || !label) return;
    const w = el.offsetWidth;
    if (!w || Math.abs(w - label.w) < 1) return;
    const b = labelBox(anchor, below, w, label.h, area, topClear);
    if (b) el.style.transform = `translate3d(${Math.round(b.x)}px, ${Math.round(b.y)}px, 0)`;
  });
  if (!p || !build.active || !fp) return null;
  const badge = bad ? build.cellScreen(fp.x + (fp.w - 1) / 2, fp.y + (fp.h - 1) / 2) : null;
  const arrows: JSX.Element[] = [];
  if (p.t === 'piece' && !build.loupeAt) {
    const def = BUILDINGS[p.kind];
    const cx = p.x + def.w / 2;
    const cy = p.y + def.h / 2;
    const c = build.cellScreen(cx - 0.5, cy - 0.5);
    // Where a finger rests to aim at each footprint cell (the lifted point is 44 pt above it).
    const fingers: { x: number; y: number }[] = [];
    for (let y = p.y; y < p.y + def.h; y++) {
      for (let x = p.x; x < p.x + def.w; x++) {
        const s = build.cellScreen(x, y);
        if (s) fingers.push({ x: s.x, y: s.y + TOUCH.liftedPointPt });
      }
    }
    const avoid: Rect[] = label ? [{ x0: label.x - 4, y0: label.y - 4, x1: label.x + label.w + 4, y1: label.y + label.h + 4 }] : [];
    const dirs = build.plane === 'yard' ? NUDGE : NUDGE.slice(0, 2);
    for (const d of c ? dirs : []) {
      const half = (d.dx !== 0 ? def.w : def.h) / 2;
      const a = nudgeSpot((reach) => build.cellScreen(cx + d.dx * (half + reach) - 0.5, cy + d.dy * (half + reach) - 0.5), fingers, avoid, area);
      if (!a || !c) continue;
      avoid.push({ x0: a.x - NUDGE_BOX / 2, y0: a.y - NUDGE_BOX / 2, x1: a.x + NUDGE_BOX / 2, y1: a.y + NUDGE_BOX / 2 });
      const deg = (Math.atan2(a.y - c.y, a.x - c.x) * 180) / Math.PI;
      arrows.push(
        <button
          key={d.label}
          type="button"
          class="hf-nudge"
          style={{ transform: `translate3d(${Math.round(a.x - NUDGE_BOX / 2)}px, ${Math.round(a.y - NUDGE_BOX / 2)}px, 0)` }}
          aria-label={d.label}
          onClick={guard(() => build.nudge(d.dx, d.dy))}
        >
          <span>
            <svg width="16" height="16" viewBox="0 0 24 24" style={{ transform: `rotate(${Math.round(deg)}deg)` }} aria-hidden="true">
              <path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
        </button>,
      );
    }
  }
  return (
    <>
      {badge && Number.isFinite(badge.x) && Number.isFinite(badge.y) && badge.y >= area.y0 && badge.y <= area.y1 && (
        <span class="hf-ghost-badge" style={{ transform: `translate3d(${Math.round(badge.x - 13)}px, ${Math.round(badge.y - 13)}px, 0)` }} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="3" />
            <path d="M6 18L18 6" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </span>
      )}
      {label && chip && (
        <div
          ref={labelRef}
          class={`hf-ghost-label hf-ghost-${chip.tone}`}
          style={{ transform: `translate3d(${Math.round(label.x)}px, ${Math.round(label.y)}px, 0)`, maxWidth: `${LABEL.maxW}px` }}
          aria-hidden="true"
        >
          {chip.text}
        </div>
      )}
      {arrows}
    </>
  );
}

/**
 * ◫ Logistics overlay, text part (03 §4.10). The status bubbles are the renderer's, world-anchored in 3D
 * (render/factory/view.ts); what it cannot give is words for a screen reader. This list is their twin, picked
 * with the renderer's own glyph table (bubbleLines → statusGlyph), so the two never disagree.
 */
function StatusList({ app, build }: { app: AppController; build: BuildSession }): JSX.Element | null {
  app.state.hudTick.value;
  build.cursorVersion.value;
  const f = app.world.factory;
  if (!f) return null;
  const lines = bubbleLines(f.entities(), build.plane, build.cam.cx, build.cam.cy);
  return (
    <ul class="hf-sr hf-status-list" aria-label="Building status">
      {lines.length === 0 ? <li>Nothing stalled</li> : lines.map((l) => <li key={l.id}>{`${buildingName(l.kind)}: ${BUBBLE_SAY[l.glyph]}`}</li>)}
    </ul>
  );
}

function Loupe({ app, build, vp }: { app: AppController; build: BuildSession; vp: Signal<Viewport> }): JSX.Element | null {
  build.cursorVersion.value;
  const canvas = useRef<HTMLCanvasElement>(null);
  const at = build.loupeAt;
  const c = build.cursorCell;
  const f = app.world.factory;
  const left = app.state.settings.peek().leftHanded;
  const size = LOUPE.size;
  const place = at ? loupePlace(at.x, at.y, build.area, left) : null;
  const cells = at && c && f ? loupeCells(app.world, f, build.plane, c, app.state.buildFrame.peek()) : null;
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || !cells) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (el.width !== px) el.width = el.height = px;
    const g = el.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLoupe(g, cells, size, build.plane);
  });
  vp.value;
  if (!place || !cells || !c) return null;
  return (
    <div class="hf-loupe" style={{ transform: `translate3d(${Math.round(place.x)}px, ${Math.round(place.y)}px, 0)` }} aria-hidden="true">
      <canvas ref={canvas} style={{ width: `${size}px`, height: `${size}px` }} />
      <span class="hf-loupe-cap">{loupeCaption(cells, c)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- tray: [Yard│Mine] + tabs + cards

function Tray({ app, build, guard }: { app: AppController; build: BuildSession; guard: Guard }): JSX.Element {
  app.state.hudTick.value;
  const f = app.world.factory;
  const plane = build.plane;
  const tab = build.tab[plane];
  const tabs = TABS[plane];
  const carried = kitsInCargo(app.world.pod.cargo);
  const cards = f ? cardsFor(plane, tabs.some((t) => t.id === tab) ? tab : 'logistics', { unlocked: (r) => f.isUnlocked(r), carried, v1: app.world.scope === 'v1' }) : [];
  const planes = plane === 'yard' ? (['yard', 'mine'] as const) : (['mine', 'yard'] as const);
  const instant = app.state.settings.value.instantBuild === true;
  return (
    <div class="hf-tray" role="group" aria-label="Buildings">
      <div class="hf-tray-tabs" data-scroll="">
        <div class="hf-seg hf-plane-seg" role="radiogroup" aria-label="Build plane">
          {planes.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={p === plane} class={p === plane ? 'hf-seg-btn hf-on' : 'hf-seg-btn'} onClick={guard(() => build.setPlane(p))}>
              {p === 'yard' ? 'Yard' : 'Mine'}
            </button>
          ))}
        </div>
        {tabs.map((t) => (
          <button key={t.id} type="button" class={`hf-tab${t.id === tab ? ' hf-on' : ''}`} aria-pressed={t.id === tab} onClick={guard(() => build.setTab(t.id))}>
            {t.label}
          </button>
        ))}
      </div>
      <div class="hf-tray-cards" data-scroll="">
        {cards.map((c) => (
          <button
            key={c.tool}
            type="button"
            class={`hf-bcard${build.tool === c.tool ? ' hf-on' : ''}${c.locked ? ' hf-locked' : ''}${c.highlight ? ' hf-hl' : ''}`}
            data-tool={c.tool}
            aria-pressed={build.tool === c.tool}
            aria-label={c.locked ? `${c.name}, locked. ${c.lockText}` : `${c.name}, ${c.sub}`}
            onClick={guard(() => build.arm(c.tool))}
          >
            <span class="hf-bcard-icon" style={{ background: c.locked ? '#BDB3A6' : roleColour(c.tool) }}>
              <Glyph name={c.locked ? 'lock' : kindGlyph(c.tool)} size={22} />
            </span>
            <span class={c.name.length > 7 ? 'hf-bcard-name hf-long' : 'hf-bcard-name'}>{c.name}</span>
            <span class="hf-bcard-sub">{c.locked ? (c.lockText ?? '').replace('Unlocks: ', '') : c.sub}</span>
          </button>
        ))}
        {tab === 'tools' && (
          <button
            type="button"
            class={`hf-bcard hf-bcard-wide${instant ? ' hf-on' : ''}`}
            aria-pressed={instant}
            onClick={guard(() => app.updateSettings({ instantBuild: !instant }))}
          >
            <span class="hf-bcard-icon" style={{ background: instant ? '#2EC4B6' : '#E6D3BA' }}>
              <Glyph name="ok" size={22} />
            </span>
            <span class="hf-bcard-name">Instant</span>
            <span class="hf-bcard-sub">{instant ? 'On: no ✓' : 'Off: confirm'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

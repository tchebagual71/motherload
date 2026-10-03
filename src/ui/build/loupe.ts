// Loupe (canon §3.12; 03 §4.9): an 88-pt schematic of the 3 × 3 cells around the lifted point, so the cell under the
// thumb stays visible. Drawn into a small 2D canvas from the factory views and the mine grid (never from the WebGL
// buffer). Cell classification is pure; drawing takes a CanvasRenderingContext2D.
import { BUILDINGS, type BuildingKind, type Cell, type FactoryApi, type Plane } from '../../factory/api';
import type { BuildFrame } from '../../render/api';
import { F, T } from '../../shared/types';
import type { WorldApi } from '../../world/api';
import { roleColour } from './glyphs';
import { W, inFootprint } from './tools';

export type LoupeBase = 'yard' | 'unbought' | 'rim' | 'air' | 'solid' | 'lode' | 'unseen' | 'off';

export interface LoupeCell {
  base: LoupeBase;
  /** Building or ghost on the cell (role colour). */
  kind: BuildingKind | null;
  ghost: boolean;
  /** Belt direction 0..3, or -1. */
  belt: number;
  /** Covered by the build preview: 1 valid, -1 invalid, 0 not. */
  preview: number;
}

/** Classify the 3 × 3 cells around `c`, row by row (top row first on screen = farther Yard row / higher mine row). */
export function loupeCells(world: WorldApi, f: FactoryApi, plane: Plane, c: Cell, frame: BuildFrame | null): LoupeCell[] {
  const out: LoupeCell[] = [];
  const words = f.beltWords(plane);
  const ids = plane === 'yard' ? f.yardBuildings() : null;
  const ents = plane === 'mine' ? f.entities().filter((e) => e.plane === 'mine') : null;
  const ghosts = plane === 'mine' ? f.ghosts() : null;
  const pv = frame?.preview ?? null;
  // Screen-up is +row on the Yard (away from the Rim) and −row in the mine.
  const rowStep = plane === 'yard' ? -1 : 1;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const x = c.x + i;
      const y = c.y + j * rowStep;
      const cell: LoupeCell = { base: 'off', kind: null, ghost: false, belt: -1, preview: 0 };
      out.push(cell);
      if (x < 0 || x >= W || y < 0) continue;
      if (plane === 'yard') {
        if (y > 32) continue;
        cell.base = y === 0 ? 'rim' : y > f.yardRows ? 'unbought' : 'yard';
        const id = ids?.[y * W + x] ?? 0;
        const e = id ? f.entity(id) : null;
        if (e) cell.kind = e.kind;
      } else {
        const g = world.terrain;
        if (y >= g.h) continue;
        const code = g.get(x, y);
        cell.base = !g.hasFlag(x, y, F.SEEN) ? 'unseen' : code === T.AIR ? 'air' : code === T.LODE_ROCK ? 'lode' : 'solid';
        const e = ents?.find((k) => inFootprint({ x, y }, k.x, k.y, k.w, k.h));
        if (e) cell.kind = e.kind;
        else {
          const gh = ghosts?.find((k) => inFootprint({ x, y }, k.x, k.y, k.w, k.h));
          if (gh) {
            cell.kind = gh.kind;
            cell.ghost = true;
          }
        }
      }
      const w = words[y * W + x] ?? 0;
      if (w !== 0) cell.belt = (w >> 10) & 3;
      if (pv) {
        const inPath = pv.path ? pv.path.some((p) => p.x === x && p.y === y) : inFootprint({ x, y }, pv.x, pv.y, pv.w, pv.h);
        if (inPath) cell.preview = pv.valid ? 1 : -1;
      }
    }
  }
  return out;
}

const BASE: Readonly<Record<LoupeBase, string>> = {
  yard: '#D9CBA4',
  unbought: '#A99C80',
  rim: '#C9A98A',
  air: '#3A2E36',
  solid: '#7A5A43',
  lode: '#B8703F',
  unseen: '#1E1820',
  off: '#2B1E2F',
};

/** Paint the schematic into a `size` × `size` px context (already scaled for DPR). */
export function drawLoupe(g: CanvasRenderingContext2D, cells: readonly LoupeCell[], size: number, plane: Plane): void {
  const s = size / 3;
  g.clearRect(0, 0, size, size);
  for (let k = 0; k < 9; k++) {
    const cell = cells[k];
    const x = (k % 3) * s;
    const y = Math.floor(k / 3) * s;
    g.fillStyle = BASE[cell.base];
    g.fillRect(x, y, s, s);
    if (cell.kind) {
      g.globalAlpha = cell.ghost ? 0.5 : 1;
      g.fillStyle = roleColour(cell.kind);
      g.fillRect(x + 2, y + 2, s - 4, s - 4);
      g.globalAlpha = 1;
    }
    if (cell.belt >= 0) drawArrow(g, x, y, s, cell.belt, plane);
    if (cell.preview !== 0) {
      g.globalAlpha = cell.preview > 0 ? 0.5 : 0.45;
      g.fillStyle = cell.preview > 0 ? '#F6C343' : '#E0249A';
      g.fillRect(x, y, s, s);
      g.globalAlpha = 1;
      if (cell.preview < 0) hatch(g, x, y, s);
    }
    g.strokeStyle = 'rgba(43,30,47,0.35)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  }
  // The cell under the lifted point.
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = 2.5;
  g.strokeRect(s + 1.5, s + 1.5, s - 3, s - 3);
}

function drawArrow(g: CanvasRenderingContext2D, x: number, y: number, s: number, dir: number, plane: Plane): void {
  // Screen direction: E right, W left; Yard S (+row) is up-screen, mine S (+row) is down-screen.
  const ang = dir === 0 ? 0 : dir === 2 ? Math.PI : (dir === 1) === (plane === 'yard') ? -Math.PI / 2 : Math.PI / 2;
  g.save();
  g.translate(x + s / 2, y + s / 2);
  g.rotate(ang);
  g.fillStyle = '#FFE9A8';
  g.beginPath();
  g.moveTo(s * 0.28, 0);
  g.lineTo(-s * 0.18, -s * 0.22);
  g.lineTo(-s * 0.18, s * 0.22);
  g.closePath();
  g.fill();
  g.restore();
}

function hatch(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, s, s);
  g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.5;
  for (let d = -s; d < s; d += 7) {
    g.beginPath();
    g.moveTo(x + d, y + s);
    g.lineTo(x + d + s, y);
    g.stroke();
  }
  g.restore();
}

/** Kind label for the loupe caption. */
export function loupeCaption(cells: readonly LoupeCell[], c: Cell): string {
  const mid = cells[4];
  const what = mid.kind ? BUILDINGS[mid.kind].name : mid.belt >= 0 ? 'Belt' : '';
  return what ? `${what} · ${c.x},${c.y}` : `${c.x},${c.y}`;
}

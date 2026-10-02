// "Pip" (PIP-7), the player's dig pod (03 §8.6, §8.11). A cute rounded white pod with a teal visor,
// orange accents, a spinning drill that points where it digs, thruster flames, a blinking Sniffer LED,
// and per-line tier variants (3 geometry steps + a trim band) swapped without per-frame allocation.
import { Color, Group, type BufferGeometry, type Mesh } from 'three';
import { HARD_LANDING_V, LINES, POD_H, VX_MAX, type Line } from '../../shared/canon';
import { POD, UI } from '../palette';
import type { PodModel, PodVisualState } from './api';
import { ComposedGeometry, roleMesh, type PartArrays } from './kit';
import {
  BODY_LINES,
  buildDrill,
  buildFlames,
  buildLineParts,
  buildShell,
  NOZZLE_EXIT_Y,
  tierStep,
  type DrillVariant,
} from './pod-parts';

const HALF_H = POD_H / 2;
const DEG = Math.PI / 180;

// 03 §8.11 animation constants.
const LEAN_MAX = 8 * DEG;
const SQUASH_Y = 0.15; // landing squash 0.85 …
const SQUASH_XZ = 0.1; // … / 1.10
const SQUASH_OMEGA = 22; // rad/s: ≈ 180 ms to settle visibly
const SQUASH_ZETA = 0.45;
const STRETCH_Y = 0.06; // thrust stretch 1.06 …
const STRETCH_XZ = 0.03; // … / 0.97
const JITTER = 0.02; // drill jitter ±0.02 at 30 Hz
const JITTER_HZ = 30;
const BOB = 0.03; // idle bob ±0.03 at 0.6 Hz
const BOB_HZ = 0.6;
const LED_HZ = 2;
const FAST_FALL_TINT = 0.45;

// Drill mounts in the facing frame (see pod-parts for the shell layout).
const DRILL_DOWN = { x: 0.06, y: -0.06 } as const;
const DRILL_SIDE = { x: 0.14, y: -0.1 } as const;
const DRILL_EXTEND = 0.2;
const DRILL_SIDE_BASE = 0.06;
const DRILL_SPIN = 26; // rad/s while digging

const MAX_DT = 0.1;
const BODY_LINE_INDEX = BODY_LINES.map((line) => LINES.indexOf(line));

/** Exponential smoothing factor for a rate (1/s) over dt seconds. */
function approach(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

function clampTier(t: number | undefined): number {
  const v = Math.round(t ?? 1);
  return v < 1 ? 1 : v > 7 ? 7 : v;
}

class PipModel implements PodModel {
  readonly root = new Group();
  private readonly leanGroup = new Group();
  private readonly squashGroup = new Group();
  private readonly facingGroup = new Group();
  private readonly drillPivot = new Group();

  private readonly body: ComposedGeometry;
  private readonly metal: ComposedGeometry;
  private readonly shellSolid: PartArrays;
  private readonly shellMetal: PartArrays;
  private readonly parts: ReturnType<typeof buildLineParts>;
  private readonly drills: DrillVariant[];
  private readonly flames: BufferGeometry[];
  private readonly drillMesh: Mesh;
  private readonly flameMesh: Mesh;
  private readonly ledMesh: Mesh;

  private readonly tiers = new Int8Array(LINES.length);
  private readonly trimColors = POD.trims.map((h) => new Color(h));
  private readonly amber = new Color(UI.amber);
  private tinted = false;
  private drill: DrillVariant;

  // Animation state.
  private lastMs = Number.NaN;
  private wasGrounded = true;
  private airVy = 0;
  private squash = 0;
  private squashV = 0;
  private stretch = 0;
  private lean = 0;
  private flip = 1;
  private side = 0;
  private sideSign = 1;
  private extend = 0;
  private spin = 0;
  private spinV = 0;
  private idle = 0;

  constructor() {
    const shell = buildShell();
    this.shellSolid = shell.solid;
    this.shellMetal = shell.metal;
    this.parts = buildLineParts();
    this.drills = [1, 2, 3, 4, 5, 6, 7].map(buildDrill);
    this.flames = ([0, 1, 2] as const).map(buildFlames);
    this.drill = this.drills[0];

    let solidCap = shell.solid.count;
    let metalCap = shell.metal.count;
    for (const line of BODY_LINES) {
      solidCap += Math.max(...this.parts[line].map((p) => p.solid.count));
      metalCap += Math.max(...this.parts[line].map((p) => p.metal.count + p.trim.count));
    }
    this.body = new ComposedGeometry(solidCap, 0.8);
    this.metal = new ComposedGeometry(metalCap, 0.8);

    this.root.name = 'pod';
    this.squashGroup.position.y = -HALF_H;
    this.facingGroup.position.y = HALF_H;
    this.root.add(this.leanGroup);
    this.leanGroup.add(this.squashGroup);
    this.squashGroup.add(this.facingGroup);

    const bodyMesh = roleMesh(this.body.geometry, 'solid', 'pod-body');
    const metalMesh = roleMesh(this.metal.geometry, 'metal', 'pod-metal');
    const visorMesh = roleMesh(shell.visor, 'glass', 'pod-visor');
    this.ledMesh = roleMesh(shell.led, 'emissive', 'pod-led');
    this.drillMesh = roleMesh(this.drill.geometry, 'metal', 'pod-drill');
    this.flameMesh = roleMesh(this.flames[0], 'flame', 'pod-flame');
    this.flameMesh.position.y = NOZZLE_EXIT_Y;
    this.flameMesh.visible = false;
    this.drillPivot.add(this.drillMesh);
    this.facingGroup.add(bodyMesh, metalMesh, visorMesh, this.ledMesh, this.drillPivot, this.flameMesh);

    this.tiers.fill(1);
    this.compose();
    this.placeDrill();
  }

  update(s: PodVisualState): void {
    const dt = this.advanceClock(s.timeMs);
    const t = s.timeMs / 1000;
    this.syncVariants(s.tiers, s.fastFall);
    this.animateBody(s, dt, t);
    this.animateDrill(s, dt);
    this.animateFlame(s, t);
    this.ledMesh.visible = Math.floor(t * LED_HZ * 2) % 2 === 0;
  }

  private advanceClock(ms: number): number {
    const dt = Number.isNaN(this.lastMs) ? 0 : (ms - this.lastMs) / 1000;
    this.lastMs = ms;
    return dt < 0 ? 0 : dt > MAX_DT ? MAX_DT : dt;
  }

  // ---- variants -------------------------------------------------------------------------------

  private syncVariants(tiers: Record<Line, number>, fastFall: boolean): void {
    const tintDirty = fastFall !== this.tinted;
    let bodyDirty = false;
    for (let i = 0; i < LINES.length; i++) {
      const line = LINES[i];
      const tier = clampTier(tiers[line]);
      if (tier === this.tiers[i]) continue;
      const prev = this.tiers[i];
      this.tiers[i] = tier;
      if (line === 'drill') {
        this.drill = this.drills[tier - 1];
        this.drillMesh.geometry = this.drill.geometry;
        continue;
      }
      if (line === 'engine' && tierStep(prev) !== tierStep(tier)) this.flameMesh.geometry = this.flames[tierStep(tier)];
      bodyDirty = true;
    }
    this.tinted = fastFall;
    // A tint flip repaints colours only: recomposing would bump the position version and make the
    // Toon outline hulls re-weld their normals (2–11 ms) on every drop past or below the threshold.
    if (bodyDirty) this.compose();
    else if (tintDirty) this.body.retint(this.tinted ? this.amber : null, FAST_FALL_TINT);
  }

  /** Rebuild the body meshes from the shell + current line variants (copies only; no allocation). */
  private compose(): void {
    const tint = this.tinted ? this.amber : null;
    this.body.begin();
    this.metal.begin();
    this.body.append(this.shellSolid, tint, FAST_FALL_TINT);
    this.metal.append(this.shellMetal);
    for (let i = 0; i < BODY_LINES.length; i++) {
      const tier = this.tiers[BODY_LINE_INDEX[i]];
      const part = this.parts[BODY_LINES[i]][tierStep(tier)];
      this.body.append(part.solid, tint, FAST_FALL_TINT);
      this.metal.append(part.metal);
      this.metal.appendSolidColor(part.trim, this.trimColors[tier - 1]);
    }
    this.body.end();
    this.metal.end();
  }

  // ---- animation ------------------------------------------------------------------------------

  private animateBody(s: PodVisualState, dt: number, t: number): void {
    if (!s.grounded) this.airVy = s.vy;
    else if (!this.wasGrounded) this.squash = Math.min(1, Math.max(0.3, -this.airVy / 8));
    this.wasGrounded = s.grounded;
    this.stepSquashSpring(dt);

    this.stretch += (Math.max(0, s.thrust) - this.stretch) * approach(10, dt);
    const idleTarget = !s.digging && Math.abs(s.vx) < 0.4 && Math.abs(s.vy) < 0.4 ? 1 : 0;
    this.idle += (idleTarget - this.idle) * approach(4, dt);
    const wave = Math.sin(t * Math.PI * 2 * BOB_HZ);
    // Grounded idle "breathes" from the skids up; hovering idle bobs.
    const breathe = s.grounded ? 1 + (BOB / POD_H) * wave * this.idle : 1;
    const bob = s.grounded ? 0 : BOB * wave * this.idle;

    const sy = (1 - SQUASH_Y * this.squash) * (1 + STRETCH_Y * this.stretch) * breathe;
    const sxz = (1 + SQUASH_XZ * this.squash) * (1 - STRETCH_XZ * this.stretch);
    this.squashGroup.scale.set(sxz, sy, sxz);

    const vxn = Math.max(-1, Math.min(1, s.vx / VX_MAX));
    this.lean += (-vxn * LEAN_MAX - this.lean) * approach(10, dt);
    this.leanGroup.rotation.z = this.lean;

    this.flip += (s.facing - this.flip) * approach(22, dt);
    const fx = Math.abs(this.flip) < 0.12 ? (this.flip < 0 ? -0.12 : 0.12) : this.flip;
    this.facingGroup.scale.x = fx;

    const shake = JITTER * this.extend * (s.digging ? 1 : 0);
    const jx = shake * Math.sin(t * Math.PI * 2 * JITTER_HZ);
    const jy = shake * Math.sin(t * Math.PI * 2 * JITTER_HZ * 1.37 + 1.1);
    this.root.position.set(s.x + jx, s.y + bob + jy, 0);
  }

  /** Damped spring on the squash amount (ζ 0.45); semi-implicit Euler in ≤ 1/120 s substeps. */
  private stepSquashSpring(dt: number): void {
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      this.squashV += (-SQUASH_OMEGA * SQUASH_OMEGA * this.squash - 2 * SQUASH_ZETA * SQUASH_OMEGA * this.squashV) * h;
      this.squash += this.squashV * h;
      left -= h;
    }
  }

  private animateDrill(s: PodVisualState, dt: number): void {
    const sideways = s.digDir === 'left' || s.digDir === 'right';
    if (sideways) this.sideSign = (s.digDir === 'right' ? 1 : -1) * s.facing;
    this.side += ((sideways ? 1 : 0) - this.side) * approach(16, dt);
    this.extend += ((s.digging ? 1 : 0) - this.extend) * approach(14, dt);
    this.spinV += ((s.digging ? DRILL_SPIN : 0) - this.spinV) * approach(s.digging ? 12 : 3, dt);
    this.spin = (this.spin + this.spinV * dt) % (Math.PI * 2);
    this.placeDrill();
  }

  private placeDrill(): void {
    const a = this.side;
    this.drillPivot.position.set(DRILL_DOWN.x + (DRILL_SIDE.x - DRILL_DOWN.x) * a, DRILL_DOWN.y + (DRILL_SIDE.y - DRILL_DOWN.y) * a, 0);
    this.drillPivot.rotation.z = a * this.sideSign * (Math.PI / 2);
    // Retracted, the tip rests at the skid line; extended, it bites ~0.2 into the next cell.
    const down = HALF_H + DRILL_DOWN.y - this.drill.length + DRILL_EXTEND * this.extend;
    const side = DRILL_SIDE_BASE + 0.12 * this.extend;
    this.drillMesh.position.y = -(down + (side - down) * a);
    this.drillMesh.rotation.y = this.spin;
  }

  private animateFlame(s: PodVisualState, t: number): void {
    const th = Math.max(0, Math.min(1, s.thrust));
    this.flameMesh.visible = th > 0.02;
    if (!this.flameMesh.visible) return;
    const flicker = 0.85 + 0.15 * Math.sin(t * 47) * Math.sin(t * 31 + 0.7);
    const w = 0.7 + 0.3 * th;
    this.flameMesh.scale.set(w, (0.25 + 0.75 * th) * flicker, w);
  }
}

/** Fast-fall tint hysteresis (tiles/s): on above the Hard Landing speed (canon §3.6), off below 5.4. */
export const FAST_FALL_ON_V = HARD_LANDING_V;
export const FAST_FALL_OFF_V = 5.4;

/**
 * Next fast-fall tint state for a vertical speed: amber at |v_y| > 5.88 (canon §3.6), cleared only
 * below 5.4 so braking near the threshold does not flicker the tint every step.
 */
export function nextFastFall(on: boolean, vy: number): boolean {
  const v = Math.abs(vy);
  return on ? v >= FAST_FALL_OFF_V : v > FAST_FALL_ON_V;
}

/** Create Pip. All tier variants are pre-built; `update()` only copies or swaps them on tier changes. */
export function createPodModel(): PodModel {
  return new PipModel();
}

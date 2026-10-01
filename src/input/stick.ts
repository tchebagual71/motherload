// Floating stick math (canon §3.12; 03 §3.1). Pure: no DOM; fed with screen-space points (y down).
// Output sy is UP-positive (PodIntent convention).

export interface StickConfig {
  /** Base radius in pt (canon §3.12: 44/52/60 by control size). */
  radius: number;
  /** Dead zone in pt (canon: 8). */
  deadZone: number;
  /** The base slides when the thumb passes this multiple of the radius (03 §3.1 [UX]: 1.25). */
  followFactor: number;
}

export class FloatingStick {
  active = false;
  pointerId = -1;
  baseX = 0;
  baseY = 0;
  /** Raw finger position. */
  fingerX = 0;
  fingerY = 0;
  /** Knob centre: the finger clamped to the base radius. */
  knobX = 0;
  knobY = 0;
  /** Stick output in [-1, 1]; sy UP-positive. Zero inside the dead zone. */
  sx = 0;
  sy = 0;
  /** Rescaled magnitude m′ = (m − d)/(1 − d), clamped to [0, 1]. */
  magnitude = 0;
  private cfg: StickConfig;

  constructor(cfg: StickConfig) {
    this.cfg = { ...cfg };
  }

  configure(cfg: StickConfig): void {
    this.cfg = { ...cfg };
  }

  get radius(): number {
    return this.cfg.radius;
  }

  /** Spawn the stick centred on the touch. */
  spawn(pointerId: number, x: number, y: number): void {
    this.active = true;
    this.pointerId = pointerId;
    this.baseX = this.fingerX = this.knobX = x;
    this.baseY = this.fingerY = this.knobY = y;
    this.sx = this.sy = this.magnitude = 0;
  }

  move(x: number, y: number): void {
    if (!this.active) return;
    this.fingerX = x;
    this.fingerY = y;
    const { radius, deadZone, followFactor } = this.cfg;
    let dx = x - this.baseX;
    let dy = y - this.baseY;
    let dist = Math.sqrt(dx * dx + dy * dy);
    const follow = radius * followFactor;
    if (dist > follow) {
      // Drag the base along so the thumb stays at the follow distance.
      const k = (dist - follow) / dist;
      this.baseX += dx * k;
      this.baseY += dy * k;
      dx = x - this.baseX;
      dy = y - this.baseY;
      dist = follow;
    }
    const clamped = Math.min(dist, radius);
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    this.knobX = this.baseX + ux * clamped;
    this.knobY = this.baseY + uy * clamped;
    const d = deadZone / radius;
    const m = clamped / radius;
    const mPrime = m <= d ? 0 : Math.min(1, (m - d) / (1 - d));
    this.magnitude = mPrime;
    // Exact zeros inside the dead zone (no -0 from a negative direction).
    this.sx = mPrime === 0 ? 0 : ux * mPrime;
    this.sy = mPrime === 0 ? 0 : -uy * mPrime;
  }

  /** Release (or cancel): output returns to zero at once (03 §3.1). */
  release(): void {
    this.active = false;
    this.pointerId = -1;
    this.sx = this.sy = this.magnitude = 0;
    this.knobX = this.baseX;
    this.knobY = this.baseY;
  }
}

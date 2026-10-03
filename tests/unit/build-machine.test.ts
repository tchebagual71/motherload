// Build-mode gesture arbitration (04 §6.2; 03 §4.2; canon §3.12) driven by synthetic pointer sequences.
import { describe, expect, it } from 'vitest';
import { GESTURE, GestureMachine, type GestureSink } from '../../src/input/build/machine';
import { EDGE_PAN, edgePanVelocity, edgeSpeed } from '../../src/input/build/edgePan';

type Call = [string, ...number[]];

class Rec implements GestureSink {
  calls: Call[] = [];
  cursor(x: number, y: number): void {
    this.calls.push(['cursor', x, y]);
  }
  tap(x: number, y: number): void {
    this.calls.push(['tap', x, y]);
  }
  longPress(x: number, y: number): void {
    this.calls.push(['longPress', x, y]);
  }
  strokeStart(x: number, y: number): void {
    this.calls.push(['strokeStart', x, y]);
  }
  strokeMove(x: number, y: number): void {
    this.calls.push(['strokeMove', x, y]);
  }
  strokeEnd(): void {
    this.calls.push(['strokeEnd']);
  }
  strokeFreeze(): void {
    this.calls.push(['strokeFreeze']);
  }
  strokeDiscard(): void {
    this.calls.push(['strokeDiscard']);
  }
  pan(dx: number, dy: number): void {
    this.calls.push(['pan', dx, dy]);
  }
  zoom(scale: number, cx: number, cy: number): void {
    this.calls.push(['zoom', scale, cx, cy]);
  }
  yawSnap(step: 1 | -1): void {
    this.calls.push(['yawSnap', step]);
  }
  panEnd(): void {
    this.calls.push(['panEnd']);
  }
  loupe(f: { x: number; y: number } | null): void {
    this.calls.push(f ? ['loupe', f.x, f.y] : ['loupe']);
  }
  names(): string[] {
    return this.calls.map((c) => c[0]);
  }
  has(name: string): boolean {
    return this.calls.some((c) => c[0] === name);
  }
}

function rig(opts: { tool?: boolean; latch?: boolean } = {}) {
  const sink = new Rec();
  const cfg = { tool: opts.tool ?? true, latch: opts.latch ?? false };
  const m = new GestureMachine(sink, { toolArmed: () => cfg.tool, panLatch: () => cfg.latch });
  return { m, sink, cfg };
}

const LIFT = GESTURE.liftPt;

describe('build gestures: taps, long-press and the lifted point', () => {
  it('puts the cursor 44 pt above the finger from touch-down and taps there', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    expect(sink.calls[0]).toEqual(['cursor', 100, 300 - LIFT]);
    expect(m.state).toBe('pending');
    m.up(1, 103, 302, 120);
    expect(sink.calls.at(-1)).toEqual(['tap', 100, 300 - LIFT]);
    expect(m.state).toBe('idle');
    expect(m.pointers).toBe(0);
  });

  it('a mouse click has no lifted point', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0, kind: 'mouse', button: 0 });
    m.up(1, 100, 300, 50);
    expect(sink.calls.at(-1)).toEqual(['tap', 100, 300]);
  });

  it('jitter under 10 pt stays a tap and moves the cursor with the finger', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.move(1, 106, 305, 40);
    expect(sink.calls.at(-1)).toEqual(['cursor', 106, 305 - LIFT]);
    m.up(1, 106, 305, 90);
    expect(sink.names()).toEqual(['cursor', 'cursor', 'tap']);
  });

  it('a release before the long-press is still a tap; time alone never leaves PENDING (03 §4.2)', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 10, y: 400, t: 0 });
    m.tick(300);
    m.up(1, 10, 400, 320);
    expect(sink.has('tap')).toBe(true);
    expect(sink.has('longPress')).toBe(false);
  });

  it('450 ms still is a long-press (inspect); the release then does nothing', () => {
    const { m, sink } = rig({ tool: false });
    m.down({ id: 1, x: 10, y: 400, t: 1000 });
    m.tick(1000 + GESTURE.longPressMs - 1);
    expect(sink.has('longPress')).toBe(false);
    m.tick(1000 + GESTURE.longPressMs);
    expect(sink.calls.at(-1)).toEqual(['longPress', 10, 400 - LIFT]);
    expect(m.state).toBe('long');
    m.move(1, 60, 400, 1500);
    m.up(1, 60, 400, 1600);
    expect(sink.names()).toEqual(['cursor', 'longPress']);
    expect(m.state).toBe('idle');
  });

  it('no long-press once the finger moved 10 pt', () => {
    const { m, sink } = rig({ tool: false });
    m.down({ id: 1, x: 10, y: 400, t: 0 });
    m.move(1, 22, 400, 50);
    m.tick(600);
    expect(sink.has('longPress')).toBe(false);
  });
});

describe('build gestures: strokes and panning', () => {
  it('with a tool armed, a 10-pt drag strokes from the lifted point at touch-down', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.move(1, 112, 300, 30);
    expect(m.state).toBe('stroke');
    expect(sink.calls.slice(1)).toEqual([
      ['strokeStart', 100, 300 - LIFT],
      ['strokeMove', 112, 300 - LIFT],
    ]);
    m.move(1, 140, 290, 60);
    m.up(1, 150, 290, 90);
    expect(sink.names().slice(-2)).toEqual(['strokeMove', 'strokeEnd']);
    expect(m.state).toBe('idle');
  });

  it('with no tool a drag pans the view by the full movement since touch-down', () => {
    const { m, sink } = rig({ tool: false });
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.move(1, 112, 305, 30);
    expect(m.state).toBe('pan');
    expect(sink.calls.at(-1)).toEqual(['pan', 12, 5]);
    m.move(1, 120, 300, 50);
    expect(sink.calls.at(-1)).toEqual(['pan', 8, -5]);
    m.up(1, 120, 300, 70);
    expect(sink.calls.at(-1)).toEqual(['panEnd']);
    expect(sink.has('tap')).toBe(false);
  });

  it('the ✋ Pan latch pans with the tool still armed', () => {
    const { m, sink } = rig({ tool: true, latch: true });
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.move(1, 100, 330, 30);
    expect(m.state).toBe('pan');
    expect(sink.has('strokeStart')).toBe(false);
    m.up(1, 100, 330, 60);
    expect(sink.calls.at(-1)).toEqual(['panEnd']);
  });

  it('a right-drag pans (desktop, 03 §3.7)', () => {
    const { m, sink } = rig({ tool: true });
    m.down({ id: 1, x: 100, y: 300, t: 0, kind: 'mouse', button: 2 });
    expect(m.state).toBe('pan');
    m.move(1, 104, 300, 10);
    expect(sink.calls).toEqual([['pan', 4, 0]]);
  });

  it('shows the loupe after 150 ms of stroke and hides it on release', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.move(1, 120, 300, 20);
    m.tick(100);
    expect(sink.has('loupe')).toBe(false);
    m.move(1, 130, 300, 20 + GESTURE.loupeMs);
    expect(sink.calls.at(-1)).toEqual(['loupe', 130, 300]);
    m.up(1, 130, 300, 400);
    expect(sink.calls.filter((c) => c[0] === 'loupe').at(-1)).toEqual(['loupe']);
  });
});

describe('build gestures: two fingers (canon §3.12 second-finger grace)', () => {
  it('a second finger within the grace window turns PENDING into the camera: nothing committed', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.down({ id: 2, x: 200, y: 300, t: 80 });
    expect(m.state).toBe('camera');
    m.up(1, 100, 300, 200);
    m.up(2, 200, 300, 210);
    expect(sink.has('tap')).toBe(false);
    expect(sink.has('strokeStart')).toBe(false);
  });

  it('a second finger 100 ms into a stroke discards it (04 §6.2; 03 §13 CDP two-pointer test)', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.move(1, 120, 300, 40);
    m.down({ id: 2, x: 220, y: 300, t: 100 });
    expect(sink.names().filter((n) => n.startsWith('stroke'))).toEqual(['strokeStart', 'strokeMove', 'strokeDiscard']);
    expect(m.state).toBe('camera');
  });

  it('a late second finger freezes the stroke as an uncommitted ghost', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.move(1, 120, 300, 40);
    m.down({ id: 2, x: 220, y: 300, t: GESTURE.graceMs + 1 });
    expect(sink.has('strokeFreeze')).toBe(true);
    expect(sink.has('strokeDiscard')).toBe(false);
    expect(sink.has('strokeEnd')).toBe(false);
  });

  it('two fingers pan by the centroid and pinch-zoom by the spread', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.down({ id: 2, x: 200, y: 300, t: 50 });
    sink.calls = [];
    m.move(2, 300, 300, 100); // spread 100 → 200, centroid 150 → 200
    expect(sink.calls).toEqual([
      ['pan', 50, 0],
      ['zoom', 2, 200, 300],
    ]);
  });

  it('a twist past 30° snaps the yaw one step', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.down({ id: 2, x: 200, y: 300, t: 50 });
    // Rotate finger 2 about finger 1 by 20° (no snap), then to 35° (snap +1: screen y down is clockwise).
    const at = (deg: number): [number, number] => [100 + 100 * Math.cos((deg * Math.PI) / 180), 300 + 100 * Math.sin((deg * Math.PI) / 180)];
    m.move(2, ...at(20), 80);
    expect(sink.has('yawSnap')).toBe(false);
    m.move(2, ...at(35), 100);
    expect(sink.calls.filter((c) => c[0] === 'yawSnap')).toEqual([['yawSnap', 1]]);
    m.move(2, ...at(10), 120);
    m.move(2, ...at(-30), 140);
    expect(sink.calls.filter((c) => c[0] === 'yawSnap').at(-1)).toEqual(['yawSnap', -1]);
  });

  it('one finger up after a pinch: the other keeps panning until all lift (HOLD)', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.down({ id: 2, x: 200, y: 300, t: 50 });
    m.up(1, 100, 300, 200);
    expect(m.state).toBe('hold');
    sink.calls = [];
    m.move(2, 210, 310, 220);
    expect(sink.calls).toEqual([['pan', 10, 10]]);
    m.up(2, 210, 310, 240);
    expect(sink.calls.at(-1)).toEqual(['panEnd']);
    expect(m.state).toBe('idle');
  });

  it('a third pointer is ignored', () => {
    const { m } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.down({ id: 2, x: 200, y: 300, t: 50 });
    m.down({ id: 3, x: 250, y: 300, t: 60 });
    expect(m.owns(3)).toBe(false);
    expect(m.pointers).toBe(2);
  });
});

describe('build gestures: cancel', () => {
  it('pointercancel during a stroke discards it and returns to IDLE', () => {
    const { m, sink } = rig();
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.move(1, 130, 300, 40);
    m.cancel(1);
    expect(sink.calls.at(-1)).toEqual(['strokeDiscard']);
    expect(m.state).toBe('idle');
    expect(m.owns(1)).toBe(false);
  });

  it('reset during a pan releases the Pan latch', () => {
    const { m, sink } = rig({ tool: false });
    m.down({ id: 1, x: 100, y: 300, t: 0 });
    m.move(1, 130, 300, 40);
    m.reset();
    expect(sink.calls.at(-1)).toEqual(['panEnd']);
  });
});

describe('edge auto-pan (canon §3.12: 40-pt margin, 2 → 8 tiles/s)', () => {
  const area = { x0: 0, y0: 64, x1: 375, y1: 483 };
  it('ramps from 2 tiles/s at the margin to 8 at the edge', () => {
    expect(edgeSpeed(EDGE_PAN.marginPt)).toBe(0);
    expect(edgeSpeed(EDGE_PAN.marginPt - 1e-9)).toBeCloseTo(2, 5);
    expect(edgeSpeed(20)).toBeCloseTo(5, 5);
    expect(edgeSpeed(0)).toBe(8);
    expect(edgeSpeed(-30)).toBe(8);
  });
  it('points toward the edges the finger is near', () => {
    const v = { vx: 0, vy: 0 };
    expect(edgePanVelocity(187, 270, area, v)).toBe(false);
    expect(edgePanVelocity(10, 270, area, v)).toBe(true);
    expect(v.vx).toBeLessThan(0);
    expect(v.vy).toBe(0);
    edgePanVelocity(370, 480, area, v);
    expect(v.vx).toBeGreaterThan(0);
    expect(v.vy).toBeGreaterThan(0);
    edgePanVelocity(187, 70, area, v);
    expect(v.vy).toBeLessThan(0);
  });
});

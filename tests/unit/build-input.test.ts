// Build-mode input glue (03 §3.7 build keys; 04 §6.2): pointers into the gesture machine, keys into the session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppController } from '../../src/app/types';
import { createBuildInput } from '../../src/input/build';
import type { BuildSession } from '../../src/ui/build/session';
import { FakeEvent, installFakeDom, type FakeDom, type FakeElement } from './ui-dom.helpers';

function fakeSession(patch: Record<string, unknown> = {}) {
  const fns = ['cursor', 'tap', 'longPress', 'strokeStart', 'strokeMove', 'strokeEnd', 'strokeFreeze', 'strokeDiscard', 'pan', 'zoom', 'yawSnap', 'panEnd', 'loupe', 'edgePan', 'undo', 'redo', 'rotate', 'arm', 'confirm', 'toggleOverlay', 'toggleLMode', 'zoomIn', 'zoomOut', 'yawStep', 'nudgeView'];
  const s: Record<string, unknown> = { active: true, tool: 'belt', panLatch: false, area: { x0: 0, y0: 64, x1: 375, y1: 483 }, onEnd: null, back: vi.fn(() => false), ...patch };
  for (const f of fns) s[f] = vi.fn();
  return s as unknown as BuildSession & Record<string, ReturnType<typeof vi.fn>>;
}

const key = (code: string, mods: Partial<KeyboardEvent> = {}) => ({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent;
const ptr = (id: number, extra: Partial<PointerEvent> = {}) => ({ pointerId: id, pointerType: 'touch', button: 0, ...extra }) as PointerEvent;

describe('build input', () => {
  let clock = 0;
  beforeEach(() => {
    clock = 1000;
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('maps the 03 §3.7 build keys', () => {
    const s = fakeSession();
    const app = { exitBuild: vi.fn() } as unknown as AppController;
    const input = createBuildInput({ session: s, app, now: () => clock });
    expect(input.key(key('KeyZ', { ctrlKey: true }))).toBe(true);
    expect(s.undo).toHaveBeenCalledTimes(1);
    input.key(key('KeyZ', { metaKey: true, shiftKey: true }));
    input.key(key('KeyY', { ctrlKey: true }));
    expect(s.redo).toHaveBeenCalledTimes(2);
    input.key(key('KeyR'));
    expect(s.rotate).toHaveBeenCalled();
    input.key(key('Delete'));
    expect(s.arm).toHaveBeenCalledWith('bulldoze');
    input.key(key('Enter'));
    expect(s.confirm).toHaveBeenCalled();
    input.key(key('KeyO'));
    expect(s.toggleOverlay).toHaveBeenCalled();
    input.key(key('ArrowLeft'));
    expect(s.nudgeView).toHaveBeenCalledWith(-1, 0);
    input.key(key('BracketLeft'));
    expect(s.yawStep).toHaveBeenCalledWith(-1);
    input.key(key('Equal'));
    expect(s.zoomIn).toHaveBeenCalled();
    expect(input.key(key('KeyQ'))).toBe(false);
    // Esc: back out one level (inspect, ghost, tool), then leave build mode.
    input.key(key('Escape'));
    expect(app.exitBuild).toHaveBeenCalledTimes(1);
    (s.back as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    input.key(key('Escape'));
    expect(app.exitBuild).toHaveBeenCalledTimes(1);
    input.key(key('KeyB'));
    expect(app.exitBuild).toHaveBeenCalledTimes(2);
  });

  it('does nothing while the session is closed', () => {
    const s = fakeSession({ active: false });
    const input = createBuildInput({ session: s, app: {} as AppController, now: () => clock });
    expect(input.key(key('KeyZ', { ctrlKey: true }))).toBe(false);
    expect(s.undo).not.toHaveBeenCalled();
  });

  it('feeds pointers through the machine: a drag strokes the armed tool from the lifted point', () => {
    const s = fakeSession();
    const input = createBuildInput({ session: s, app: {} as AppController, now: () => clock });
    input.down(ptr(7), 100, 300);
    expect(input.owns(7)).toBe(true);
    expect(input.touching).toBe(true);
    expect(s.cursor).toHaveBeenCalledWith(100, 256);
    clock += 30;
    input.move(ptr(7), 130, 300);
    expect(s.strokeStart).toHaveBeenCalledWith(100, 256);
    expect(s.strokeMove).toHaveBeenLastCalledWith(130, 256);
    clock += 30;
    input.up(ptr(7), 130, 300);
    expect(s.strokeEnd).toHaveBeenCalled();
    expect(input.owns(7)).toBe(false);
    expect(input.touching).toBe(false);
  });

  it('mouse: a click taps without the lifted point, hover moves the cursor, right-drag pans', () => {
    const s = fakeSession({ tool: null });
    const input = createBuildInput({ session: s, app: {} as AppController, now: () => clock });
    input.move(ptr(1, { pointerType: 'mouse' }), 50, 60);
    expect(s.cursor).toHaveBeenCalledWith(50, 60);
    input.down(ptr(1, { pointerType: 'mouse' }), 50, 60);
    input.up(ptr(1, { pointerType: 'mouse' }), 50, 60);
    expect(s.tap).toHaveBeenCalledWith(50, 60);
    input.down(ptr(1, { pointerType: 'mouse', button: 2 }), 50, 60);
    input.move(ptr(1, { pointerType: 'mouse', button: 2 }), 70, 60);
    expect(s.pan).toHaveBeenCalledWith(20, 0);
  });

  it('pointercancel discards a stroke; the session ending drops the gesture', () => {
    const s = fakeSession();
    const input = createBuildInput({ session: s, app: {} as AppController, now: () => clock });
    input.down(ptr(3), 100, 300);
    input.move(ptr(3), 130, 300);
    input.cancel(3);
    expect(s.strokeDiscard).toHaveBeenCalledTimes(1);
    input.down(ptr(4), 100, 300);
    input.move(ptr(4), 130, 300);
    (s.onEnd as unknown as () => void)();
    expect(s.strokeDiscard).toHaveBeenCalledTimes(2);
    expect(input.owns(4)).toBe(false);
  });

  it('zooms with the wheel', () => {
    const s = fakeSession();
    const input = createBuildInput({ session: s, app: {} as AppController, now: () => clock });
    const e = { deltaY: -120, preventDefault: vi.fn() } as unknown as WheelEvent;
    input.wheel(e, 200, 300);
    expect(s.zoom).toHaveBeenCalledWith(1.1, 200, 300);
    expect(e.preventDefault).toHaveBeenCalled();
  });
});

/**
 * BUILD-3: a finger on the dock band, a button or a chip still counts. The canvas glue (src/input/index.ts) feeds
 * canvas pointers in canvas px; the build input watches the other touches on the window (capture phase).
 */
describe('build input: touches off the canvas (dock band, buttons) count as fingers', () => {
  let dom: FakeDom;
  let clock = 0;
  let canvas: FakeElement;
  let dock: FakeElement;
  let ok: FakeElement;
  beforeEach(() => {
    dom = installFakeDom();
    clock = 1000;
    canvas = dom.document.createElement('canvas');
    dock = dom.document.createElement('div');
    ok = dom.document.createElement('button');
    dock.appendChild(ok);
    dom.root.appendChild(canvas);
    dom.root.appendChild(dock);
  });
  afterEach(() => dom.restore());

  /** A pointer event on `el` in client px (the canvas sits at client (0, 20) here). */
  const fire = (el: FakeElement, type: string, id: number, x: number, y: number): FakeEvent => {
    const ev = new FakeEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0 });
    el.dispatchEvent(ev);
    return ev;
  };
  const canvasDown = (input: ReturnType<typeof createBuildInput>, id: number, x: number, y: number) =>
    input.down({ pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y + 20 } as PointerEvent, x, y);
  const canvasMove = (input: ReturnType<typeof createBuildInput>, id: number, x: number, y: number) =>
    input.move({ pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y + 20 } as PointerEvent, x, y);
  const canvasUp = (input: ReturnType<typeof createBuildInput>, id: number, x: number, y: number) =>
    input.up({ pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y + 20 } as PointerEvent, x, y);

  it('a pinch whose second finger lands on the dock band zooms and paints nothing', () => {
    const s = fakeSession({ tool: 'belt' });
    const input = createBuildInput({ session: s, app: {} as AppController, now: () => clock });
    canvasDown(input, 4, 230, 380);
    clock += 10;
    fire(dock, 'pointerdown', 5, 153, 489 + 20);
    expect(input.owns(5)).toBe(true);
    // Both spread.
    clock += 16;
    canvasMove(input, 4, 250, 360);
    fire(dock, 'pointermove', 5, 133, 509 + 20);
    clock += 16;
    canvasUp(input, 4, 250, 360);
    fire(dock, 'pointerup', 5, 133, 509 + 20);
    expect(s.strokeStart).not.toHaveBeenCalled();
    expect(s.strokeEnd).not.toHaveBeenCalled();
    expect(s.tap).not.toHaveBeenCalled();
    expect(s.zoom).toHaveBeenCalled();
    // The spread is measured in one frame: canvas px for both fingers (the dock finger is mapped by the canvas offset).
    const [scale, cx, cy] = (s.zoom as ReturnType<typeof vi.fn>).mock.calls[0] as number[];
    expect(scale).toBeGreaterThan(1);
    expect(cx).toBeCloseTo((250 + 153) / 2, 6);
    expect(cy).toBeCloseTo((360 + 489) / 2, 6);
    expect(input.touching).toBe(false);
  });

  it('a second finger on a button joins too, and that button ignores its click (no ✓ commit mid-pinch)', () => {
    const s = fakeSession({ tool: 'bin' });
    const input = createBuildInput({ session: s, app: {} as AppController, now: () => clock });
    const clicked = vi.fn();
    ok.addEventListener('click', clicked);
    canvasDown(input, 1, 200, 300);
    fire(ok, 'pointerdown', 2, 340, 530);
    fire(ok, 'pointerup', 2, 340, 530);
    canvasUp(input, 1, 200, 300);
    const click = fire(ok, 'click', 2, 340, 530);
    expect(clicked).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
    expect(s.tap).not.toHaveBeenCalled();
    // A later plain tap on the button is a press again.
    fire(ok, 'pointerdown', 3, 340, 530);
    fire(ok, 'pointerup', 3, 340, 530);
    fire(ok, 'click', 3, 340, 530);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('a dock finger just before the canvas finger (the pinch window) makes the gesture the camera', () => {
    const s = fakeSession({ tool: 'belt' });
    const input = createBuildInput({ session: s, app: {} as AppController, now: () => clock });
    fire(dock, 'pointerdown', 8, 150, 500);
    clock += 40;
    canvasDown(input, 9, 230, 380);
    expect(input.owns(8)).toBe(true);
    clock += 16;
    canvasMove(input, 9, 260, 380);
    expect(s.strokeStart).not.toHaveBeenCalled();
    expect(s.pan).toHaveBeenCalled();
  });

  it('a thumb resting on the tray long before does not stop a one-finger stroke', () => {
    const s = fakeSession({ tool: 'belt' });
    const input = createBuildInput({ session: s, app: {} as AppController, now: () => clock });
    fire(dock, 'pointerdown', 8, 150, 600);
    clock += 1000;
    canvasDown(input, 9, 230, 380);
    expect(input.owns(8)).toBe(false);
    clock += 16;
    canvasMove(input, 9, 260, 380);
    expect(s.strokeStart).toHaveBeenCalledWith(230, 380 - 44);
    canvasUp(input, 9, 260, 380);
    expect(s.strokeEnd).toHaveBeenCalled();
  });

  it('canvas pointers are left to the canvas glue; a lone button press keeps its click; dispose unhooks', () => {
    const s = fakeSession({ tool: 'belt' });
    const input = createBuildInput({ session: s, app: {} as AppController, now: () => clock });
    fire(canvas, 'pointerdown', 1, 100, 100);
    expect(input.owns(1)).toBe(false);
    const clicked = vi.fn();
    ok.addEventListener('click', clicked);
    fire(ok, 'pointerdown', 2, 340, 530);
    fire(ok, 'pointerup', 2, 340, 530);
    fire(ok, 'click', 2, 340, 530);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(dom.window.listenerCount('pointerdown')).toBe(1);
    input.dispose();
    expect(dom.window.listenerCount('pointerdown')).toBe(0);
  });
});

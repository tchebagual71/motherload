// Build-mode input glue (03 §3.7 build keys; 04 §6.2): pointers into the gesture machine, keys into the session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppController } from '../../src/app/types';
import { createBuildInput } from '../../src/input/build';
import type { BuildSession } from '../../src/ui/build/session';

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

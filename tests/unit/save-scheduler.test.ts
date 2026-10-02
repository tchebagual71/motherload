import { describe, expect, it, vi } from 'vitest';
import { BootTracker, failedBoots, shouldEnterSafeMode } from '../../src/save/bootTrack';
import { SaveScheduler, SOON_MS, type SaveSink } from '../../src/save/scheduler';
import type { WriteOutcome } from '../../src/save/store';
import { memoryKeyValue } from '../../src/platform/storage';
import { SAVE_ROUTINE_MS } from '../../src/shared/canon';

function sink() {
  const pending: ((o: WriteOutcome) => void)[] = [];
  const s = {
    writeCritical: vi.fn(async (): Promise<WriteOutcome> => ({ ok: true, seq: 1, copy: 'a' })),
    writeRoutine: vi.fn(() => new Promise<WriteOutcome>((res) => pending.push(res))),
  } satisfies SaveSink;
  const settle = async (o: WriteOutcome = { ok: true, seq: 2, copy: 'b' }) => {
    pending.shift()?.(o);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { s, settle, pending };
}

function scheduler(over: Partial<ConstructorParameters<typeof SaveScheduler>[0]> = {}) {
  const k = sink();
  let n = 0;
  const serialize = vi.fn(() => new Uint8Array([n++]));
  const onError = vi.fn();
  const sched = new SaveScheduler({ serialize, sink: k.s, onError, ...over }, 0);
  return { sched, serialize, onError, ...k };
}

describe('SaveScheduler (04 §4.12)', () => {
  it('a critical save serialises and writes synchronously', () => {
    const { sched, s, serialize } = scheduler();
    sched.markDirty();
    expect(sched.critical(10)).not.toBeNull();
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(s.writeCritical).toHaveBeenCalledTimes(1);
    expect(sched.isDirty).toBe(false);
  });

  it('"soon" saves fire within 1 s and coalesce', async () => {
    const { sched, s, settle } = scheduler();
    sched.requestSoon(0);
    sched.requestSoon(100);
    sched.tick(SOON_MS - 1);
    expect(s.writeRoutine).not.toHaveBeenCalled();
    sched.tick(SOON_MS);
    expect(s.writeRoutine).toHaveBeenCalledTimes(1);
    expect(SOON_MS).toBeLessThan(1_000);
    await settle();
  });

  it('keeps one compressed write in flight; requests meanwhile become one follow-up', async () => {
    const { sched, s, settle } = scheduler();
    sched.requestSoon(0);
    sched.tick(SOON_MS);
    sched.requestSoon(400);
    sched.requestSoon(450);
    sched.tick(2_000);
    expect(s.writeRoutine).toHaveBeenCalledTimes(1);
    await settle();
    sched.tick(2_001);
    expect(s.writeRoutine).toHaveBeenCalledTimes(2);
    await settle();
    sched.tick(5_000);
    expect(s.writeRoutine).toHaveBeenCalledTimes(2);
  });

  it('routine saves run every 30 s only while dirty', async () => {
    const { sched, s, settle } = scheduler();
    sched.tick(SAVE_ROUTINE_MS + 1);
    expect(s.writeRoutine).not.toHaveBeenCalled();
    sched.markDirty();
    sched.tick(SAVE_ROUTINE_MS - 1);
    expect(s.writeRoutine).not.toHaveBeenCalled();
    sched.tick(SAVE_ROUTINE_MS);
    expect(s.writeRoutine).toHaveBeenCalledTimes(1);
    await settle();
  });

  it('a failed write stays dirty and surfaces quota errors; stale is silent', async () => {
    const { sched, settle, onError } = scheduler();
    sched.requestSoon(0);
    sched.tick(SOON_MS);
    await settle({ ok: false, error: 'quota' });
    expect(onError).toHaveBeenCalledWith('quota', 'routine');
    expect(sched.isDirty).toBe(true);
    sched.requestSoon(1_000);
    sched.tick(1_000 + SOON_MS);
    await settle({ ok: false, error: 'stale' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a critical write the store could not take is retried: soon while it reconnects, else at the routine cadence', async () => {
    const { sched, s, settle, onError } = scheduler();
    s.writeCritical.mockResolvedValueOnce({ ok: false, error: 'closed' });
    sched.critical(1_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(sched.isDirty).toBe(true);
    expect(onError).toHaveBeenCalledWith('closed', 'critical');
    sched.tick(1_000 + SOON_MS);
    expect(s.writeRoutine).toHaveBeenCalledTimes(1);
    await settle();
    expect(sched.isDirty).toBe(false);

    s.writeCritical.mockResolvedValueOnce({ ok: false, error: 'failed' });
    sched.critical(5_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(sched.isDirty).toBe(true);
    sched.tick(5_000 + SOON_MS);
    expect(s.writeRoutine).toHaveBeenCalledTimes(1);
    sched.tick(5_000 + SAVE_ROUTINE_MS);
    expect(s.writeRoutine).toHaveBeenCalledTimes(2);
    await settle();
  });

  it('writes nothing while disabled (Safe Mode)', () => {
    const { sched, s } = scheduler();
    sched.setEnabled(false);
    expect(sched.critical(0)).toBeNull();
    sched.requestSoon(0);
    sched.tick(5_000);
    expect(s.writeCritical).not.toHaveBeenCalled();
    expect(s.writeRoutine).not.toHaveBeenCalled();
  });

  it('a throwing serialiser is reported, never thrown', () => {
    const { sched, onError } = scheduler({
      serialize: () => {
        throw new Error('bad state');
      },
    });
    expect(sched.critical(0)).toBeNull();
    expect(onError).toHaveBeenCalledWith('serialize', 'critical');
  });
});

describe('boot tracking and Safe Mode (04 §4.13)', () => {
  it('counts consecutive boots of one copy that died before their first frame', () => {
    expect(failedBoots(null, 1, 'a')).toBe(0);
    expect(failedBoots({ slot: 1, copy: 'a', phase: 'load', n: 0 }, 1, 'a')).toBe(1);
    expect(failedBoots({ slot: 1, copy: 'a', phase: 'firstTick', n: 1 }, 1, 'a')).toBe(2);
    expect(failedBoots({ slot: 1, copy: 'a', phase: 'firstFrame', n: 3 }, 1, 'a')).toBe(0);
    expect(failedBoots({ slot: 1, copy: 'b', phase: 'load', n: 1 }, 1, 'a')).toBe(0);
    expect(shouldEnterSafeMode({ slot: 1, copy: 'a', phase: 'load', n: 1 }, 1, 'a')).toBe(true);
  });

  it('enters Safe Mode on the third boot after two deaths, and a clean boot resets', () => {
    const kv = memoryKeyValue();
    const boot = () => new BootTracker(kv, 'hf-test.boot');
    expect(boot().begin(1, 'a').safeMode).toBe(false); // dies in 'load'
    expect(boot().begin(1, 'a')).toEqual({ fails: 1, safeMode: false }); // dies again
    expect(boot().begin(1, 'a')).toEqual({ fails: 2, safeMode: true });

    const ok = boot();
    ok.begin(1, 'b');
    ok.phase('firstTick');
    ok.phase('firstFrame');
    expect(boot().begin(1, 'b').fails).toBe(0);
  });

  it('clear() forgets the record after a stable run', () => {
    const kv = memoryKeyValue();
    const t = new BootTracker(kv, 'k');
    t.begin(1, 'a');
    expect(kv.get('k')).not.toBeNull();
    t.clear();
    expect(kv.get('k')).toBeNull();
  });

  it('retargeting to an older copy keeps that copy’s own count', () => {
    const kv = memoryKeyValue();
    const t = new BootTracker(kv, 'k');
    t.begin(1, 'b');
    expect(t.retarget('a')).toEqual({ fails: 0, safeMode: false });
    expect(t.current).toEqual({ slot: 1, copy: 'a', phase: 'load', n: 0 });
  });

  it('a fallback copy that keeps dying gets the Safe Mode verdict on its own count', () => {
    const kv = memoryKeyValue();
    const boot = () => new BootTracker(kv, 'k');
    // The newest copy b never verifies; every boot falls back to a and dies before its first frame.
    const verdicts = [1, 2, 3].map(() => {
      const t = boot();
      expect(t.begin(1, 'b').safeMode).toBe(false);
      return t.retarget('a');
    });
    expect(verdicts).toEqual([
      { fails: 0, safeMode: false },
      { fails: 1, safeMode: false },
      { fails: 2, safeMode: true },
    ]);
  });

  it('a boot left before its first frame (hidden, pagehide) is not a failure', () => {
    const kv = memoryKeyValue();
    const boot = () => new BootTracker(kv, 'k');
    const dies = boot();
    dies.begin(1, 'a'); // crashes in view
    for (let i = 0; i < 3; i++) {
      const t = boot();
      expect(t.begin(1, 'a').fails).toBe(1);
      t.setLeft(true); // reloaded / switched away before the first frame
      expect(t.current?.left).toBe(true);
    }
    const back = boot();
    back.begin(1, 'a');
    back.setLeft(true);
    back.setLeft(false); // visible again, then dies in view: counts
    expect(boot().begin(1, 'a')).toEqual({ fails: 2, safeMode: true });
  });

  it('hidden before the record exists still marks the boot; firstFrame clears the mark', () => {
    const kv = memoryKeyValue();
    const t = new BootTracker(kv, 'k');
    t.setLeft(true);
    t.begin(1, 'a');
    expect(t.current).toEqual({ slot: 1, copy: 'a', phase: 'load', n: 0, left: true });
    t.phase('firstFrame');
    expect(t.current).toEqual({ slot: 1, copy: 'a', phase: 'firstFrame', n: 0 });
    t.setLeft(true);
    expect(t.current?.left).toBeUndefined();
  });
});

describe('boot phases', () => {
  it('never move backwards (the first frame can render before the first tick)', () => {
    const kv = memoryKeyValue();
    const t = new BootTracker(kv, 'k');
    t.begin(1, 'a');
    t.phase('firstFrame');
    t.phase('firstTick');
    expect(t.current?.phase).toBe('firstFrame');
  });
});

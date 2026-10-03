// The audio engine against a recording fake AudioContext (audio.fakes.ts): iOS unlock and session order, the
// hidden/visible lifecycle (03 §11.1), event → source mapping, Kettle On scheduling and its depth mix (03 §11.2),
// radio blips, the voice cap (04 §8.1) and the decoded-audio budget.
import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, MAX_VOICES, MAX_VOICES_LOW, sfxRate, type AudioEngineOptions, type PodAudioState, type SessionType } from '../../src/audio/engine';
import { MUSIC_SAMPLE_RATE } from '../../src/audio/instruments';
import { dbToGain } from '../../src/audio/mix';
import { LOOKAHEAD_S } from '../../src/audio/music';
import { renderSfx } from '../../src/audio/sfx';
import type { GameEvent } from '../../src/shared/events';
import { FakeAudioContext, FakeClock, type FakeSource } from './audio.fakes';

const SR = 48_000;
const BASE: PodAudioState = { thrust: 0, digging: false, drillTier: 1, engineTier: 1, vy: 0, depth: 0, ducked: false, arming: -1 };

function harness(opts: Partial<AudioEngineOptions> = {}) {
  const ctx = new FakeAudioContext(SR);
  const clock = new FakeClock();
  const log: string[] = [];
  const engine = new AudioEngine({
    createContext: () => {
      log.push('context');
      return ctx as unknown as AudioContext;
    },
    setSession: (t: SessionType) => log.push(`session:${t}`),
    clock,
    now: () => ctx.currentTime * 1000,
    random: () => 0.5,
    ...opts,
  });
  /** `seconds` of 60-Hz frames with the 25-ms clock, on a 1/240-s grid. */
  const run = (seconds: number, pod: PodAudioState = BASE, each?: () => void): void => {
    const steps = Math.round(seconds * 240);
    for (let i = 0; i < steps; i++) {
      if (i % 4 === 0) {
        each?.();
        engine.update(pod, ctx.currentTime * 1000);
      }
      if (i % 6 === 0) clock.tick();
      ctx.advance(1 / 240);
    }
  };
  return { engine, ctx, clock, log, run };
}

const isMusic = (s: FakeSource): boolean => s.buffer?.sampleRate === MUSIC_SAMPLE_RATE && !s.loop;
const lengthOf = (id: Parameters<typeof renderSfx>[0]): number => renderSfx(id, sfxRate(SR)).length;

describe('unlock and lifecycle (03 §11.1)', () => {
  it('creates nothing before the first gesture', () => {
    const h = harness();
    h.run(0.5);
    h.engine.handleEvents([{ t: 'landed', v: 4 }], 1);
    expect(h.engine.state).toBe('none');
    expect(h.log).toEqual([]);
  });

  it('sets the audio session before creating the context, then primes output once', () => {
    const h = harness();
    h.engine.unlock();
    h.engine.unlock();
    expect(h.log).toEqual(['session:ambient', 'context']);
    expect(h.engine.state).toBe('running');
    expect(h.ctx.sources.filter((s) => s.buffer?.length === 1)).toHaveLength(1);
  });

  it("uses the 'playback' session for sound in silent mode, and switches live", () => {
    const h = harness({ respectSilent: false });
    h.engine.unlock();
    h.engine.setRespectSilent(true);
    expect(h.log).toEqual(['session:playback', 'context', 'session:ambient']);
  });

  it('suspends when hidden and resumes only on the next gesture', () => {
    const h = harness();
    const target = new EventTarget();
    h.engine.installUnlockListeners(target as unknown as Document);
    target.dispatchEvent(new Event('pointerup'));
    h.run(0.2);
    expect(h.clock.running).toBe(true);

    h.engine.suspend();
    expect(h.ctx.state).toBe('suspended');
    expect(h.clock.running).toBe(false);
    h.engine.resume();
    h.run(0.5);
    expect(h.ctx.state).toBe('suspended');
    expect(h.ctx.resumeCalls).toBe(1);

    target.dispatchEvent(new Event('touchend'));
    expect(h.ctx.state).toBe('running');
    h.run(0.1);
    expect(h.clock.running).toBe(true);
  });

  it("raises the app interrupt when iOS reports 'interrupted'", () => {
    const onInterrupted = vi.fn();
    const h = harness({ onInterrupted });
    h.engine.unlock();
    h.ctx.setState('interrupted');
    expect(onInterrupted).toHaveBeenCalledOnce();
    h.run(0.2);
    expect(h.clock.running).toBe(false);
  });

  it('sound off stops every source and schedules nothing new', () => {
    const h = harness();
    h.engine.unlock();
    h.run(1, { ...BASE, thrust: 1 });
    expect(h.ctx.sounding().length).toBeGreaterThan(0);
    h.engine.setEnabled(false);
    h.ctx.advance(0.1);
    expect(h.ctx.sounding()).toEqual([]);
    const n = h.ctx.sources.length;
    h.engine.handleEvents([{ t: 'sale', amount: 500, count: 3 }], 1);
    h.run(1, { ...BASE, thrust: 1 });
    expect(h.ctx.sources.length).toBe(n);
    expect(h.clock.running).toBe(false);
  });
});

describe('SFX routing', () => {
  it('plays the mapped buffer at the mapped pitch', () => {
    const h = harness();
    h.engine.unlock();
    const before = h.ctx.sources.length;
    h.engine.handleEvents([{ t: 'collect', item: { kind: 'mineral', tier: 6 } }], 1);
    const s = h.ctx.sources.slice(before);
    expect(s).toHaveLength(1);
    expect(s[0].buffer?.length).toBe(lengthOf('collect'));
    expect(s[0].playbackRate.value).toBeCloseTo(2, 9); // tier 6 = an octave up; random 0.5 = no jitter
  });

  it('repeats beeps on their gap and honours cooldowns', () => {
    const h = harness();
    h.engine.unlock();
    const before = h.ctx.sources.length;
    h.engine.handleEvents([{ t: 'fuel-warning', level: 2 }], 1);
    h.engine.handleEvents([{ t: 'collect', item: { kind: 'mineral', tier: 1 } }, { t: 'collect', item: { kind: 'mineral', tier: 1 } }], 1);
    const s = h.ctx.sources.slice(before);
    expect(s.map((x) => x.startedAt)).toEqual([0, 0.11, 0.22, 0]);
  });

  it('runs the engine hum with s_t and stops the loop once idle', () => {
    const h = harness();
    h.engine.unlock();
    h.run(0.5, { ...BASE, thrust: 1 });
    const hum = h.ctx.sources.find((s) => s.loop && s.buffer?.length === lengthOf('thrust'));
    expect(hum?.soundingAt(h.ctx.currentTime)).toBe(true);
    h.run(2.5, BASE);
    expect(hum?.stoppedAt).not.toBeNull();
  });

  it('ticks at each quarter of the arming ring, rising, once per quarter', () => {
    const h = harness();
    h.engine.unlock();
    const ticks = (): FakeSource[] => h.ctx.sources.filter((s) => s.buffer?.length === lengthOf('uiTap'));
    for (const p of [0, 0.1, 0.26, 0.3, 0.5, 0.76, 1, 1]) h.run(1 / 60, { ...BASE, arming: p });
    expect(ticks().map((s) => s.playbackRate.value)).toEqual([2 ** (-4 / 12), 2 ** (-2 / 12), 1, 2 ** (2 / 12)]);
    h.run(0.1, BASE);
    h.run(1 / 60, { ...BASE, arming: 0.3 });
    expect(ticks()).toHaveLength(5);
  });

  it('whistles only when falling faster than 5.88 tiles/s', () => {
    const h = harness();
    h.engine.unlock();
    const whistles = (): FakeSource[] => h.ctx.sources.filter((s) => s.loop && s.buffer?.length === lengthOf('whistle'));
    h.run(0.5, { ...BASE, vy: -5 });
    expect(whistles()).toHaveLength(0);
    h.run(0.5, { ...BASE, vy: -12 });
    expect(whistles()).toHaveLength(1);
  });

  it('never has more than 16 sources sounding (12 on low)', () => {
    for (const max of [MAX_VOICES, MAX_VOICES_LOW]) {
      const h = harness({ maxVoices: max });
      h.engine.unlock();
      let peak = 0;
      let k = 0;
      const storm = (): void => {
        const events: GameEvent[] = [
          { t: 'collect', item: { kind: 'mineral', tier: 1 + (k++ % 10) } },
          { t: 'damage', amount: 4, cause: 'landing' },
          { t: 'explosion', x: 1, r: 1, radius: 1 },
          { t: 'sale', amount: 99_999, count: 9 },
          { t: 'fuel-warning', level: 2 },
          { t: 'dug', x: 1, r: 1, code: 1 },
        ];
        h.engine.handleEvents(events, 1);
        if (k % 30 === 0) h.engine.handleEvents([{ t: 'radio', sender: 'Dot', beat: 'b', cards: ['Steady now, Pip. Mind the clay.'] }], 1);
        peak = Math.max(peak, h.ctx.sounding().length);
      };
      h.run(6, { ...BASE, thrust: 1, digging: true, vy: -14, depth: 30 }, storm);
      expect(peak).toBeGreaterThan(max / 2);
      expect(peak).toBeLessThanOrEqual(max);
    }
  });
});

describe('Kettle On (03 §11.2)', () => {
  it('starts once the context runs and schedules each note ≤ 100 ms ahead', () => {
    const h = harness();
    h.run(1);
    expect(h.ctx.sources.filter(isMusic)).toHaveLength(0);
    h.engine.unlock();
    h.run(4);
    const notes = h.ctx.sources.filter(isMusic);
    expect(notes.length).toBeGreaterThan(15);
    for (const n of notes) {
      const lead = n.startedAt! - n.createdAt;
      expect(lead).toBeGreaterThanOrEqual(0);
      expect(lead).toBeLessThanOrEqual(LOOKAHEAD_S + 1e-9);
    }
    expect(h.engine.debugInfo().musicPlaying).toBe(true);
  });

  it('muffles through rock and is gone by r64', () => {
    const h = harness();
    h.engine.unlock();
    h.run(1, { ...BASE, depth: 0 });
    expect(h.engine.debugInfo().musicCutoffHz).toBeCloseTo(16_000, 0);
    expect(h.engine.debugInfo().musicGain).toBeCloseTo(1, 3);
    h.run(1, { ...BASE, depth: 40 });
    expect(h.engine.debugInfo().musicCutoffHz).toBeCloseTo(700, 0);
    expect(h.engine.debugInfo().musicGain).toBeCloseTo(dbToGain(-12), 2);
    h.run(3, { ...BASE, depth: 70 });
    expect(h.engine.debugInfo().musicGain).toBe(0);
    expect(h.engine.debugInfo().musicPlaying).toBe(false);
    const n = h.ctx.sources.filter(isMusic).length;
    h.run(2, { ...BASE, depth: 70 });
    expect(h.ctx.sources.filter(isMusic).length).toBe(n);
    // Back on the Rim, the song starts again from bar 0.
    h.run(1, BASE);
    expect(h.engine.debugInfo()).toMatchObject({ musicPlaying: true, musicBar: 0 });
  });

  it('ducks −4 dB with a 4-kHz low-pass under a sheet or build mode', () => {
    const h = harness();
    h.engine.unlock();
    h.run(1, { ...BASE, ducked: true });
    expect(h.engine.debugInfo().musicGain).toBeCloseTo(dbToGain(-4), 3);
    expect(h.engine.debugInfo().musicCutoffHz).toBe(4_000);
  });

  it('the Music setting silences only the song', () => {
    const h = harness({ music: false });
    h.engine.unlock();
    h.run(3);
    expect(h.ctx.sources.filter(isMusic)).toHaveLength(0);
    h.engine.handleEvents([{ t: 'landed', v: 6 }], 1);
    expect(h.ctx.sources.some((s) => s.buffer?.length === lengthOf('land'))).toBe(true);
    h.engine.setMusic(true);
    h.run(2);
    expect(h.ctx.sources.filter(isMusic).length).toBeGreaterThan(0);
  });

  it('drops notes missed in a stall instead of bursting them', () => {
    const h = harness();
    h.engine.unlock();
    h.run(2);
    h.ctx.advance(1.5); // main thread blocked: no clock ticks
    const before = h.ctx.sources.filter(isMusic).length;
    h.clock.tick();
    const burst = h.ctx.sources.filter(isMusic).slice(before);
    expect(burst.length).toBeLessThanOrEqual(4);
    for (const n of burst) expect(n.startedAt!).toBeGreaterThanOrEqual(h.ctx.currentTime);
  });

  it('keeps the rendered set inside the low-tier decoded budget (8 MB)', () => {
    const h = harness();
    h.engine.unlock();
    h.run(3);
    const info = h.engine.debugInfo();
    expect(info.buffers).toBeGreaterThan(60);
    expect(info.decodedBytes).toBeLessThan(8 * 1024 * 1024);
  });
});

describe('radio voices (03 §11.5)', () => {
  it("speaks Dot's card one warm blip per letter and ducks the music −6 dB", () => {
    const h = harness();
    h.engine.unlock();
    h.run(1);
    const text = 'Hi Pip, dig on.';
    h.engine.handleEvents([{ t: 'radio', sender: 'Dot', beat: 'hello', cards: [text, 'second card'] }], 1);
    h.run(0.2);
    expect(h.engine.debugInfo().musicGain).toBeCloseTo(dbToGain(-6), 3);
    h.run(2);
    const blips = h.ctx.sources.filter((s) => s.buffer?.length === lengthOf('blipDot'));
    expect(blips).toHaveLength(text.replace(/[^A-Za-z]/g, '').length);
    expect(h.engine.debugInfo().speaking).toBe(false);
    h.run(0.5);
    expect(h.engine.debugInfo().musicGain).toBeCloseTo(1, 3);
  });

  it('gives Channel Zero a static burst per word and a tick per number', () => {
    const h = harness();
    h.engine.unlock();
    h.engine.handleEvents([{ t: 'radio', sender: 'Channel Zero', beat: 'cz', cards: ['Signal at 500 feet'] }], 1);
    h.run(3);
    expect(h.ctx.sources.filter((s) => s.buffer?.length === lengthOf('blipStatic'))).toHaveLength(3);
    expect(h.ctx.sources.filter((s) => s.buffer?.length === lengthOf('tickStatic'))).toHaveLength(1);
  });

  it('stopSpeech cuts the line and lifts the duck', () => {
    const h = harness();
    h.engine.unlock();
    h.engine.speak('Dot', 'A long, long transmission that the player dismisses early on.');
    h.run(0.3);
    h.engine.stopSpeech();
    const n = h.ctx.sources.length;
    h.run(0.6);
    expect(h.ctx.sources.filter((s) => s.buffer?.length === lengthOf('blipDot') && s.createdAt >= 0.3)).toHaveLength(0);
    expect(h.ctx.sources.length).toBeGreaterThanOrEqual(n);
    expect(h.engine.debugInfo().musicGain).toBeCloseTo(1, 3);
  });
});

// Web Audio engine (04 §8.1; 03 §11.1, §11.6). One lazily created AudioContext, unlocked on the first
// pointerup / touchend / keydown (iOS); the silent switch is respected by default through
// navigator.audioSession.type = 'ambient' ('playback' when the player opts into sound in silent mode).
// Graph: voices → sfx bus → master → compressor (−18 dB, 3:1) → destination. SFX are ZzFX presets rendered to
// AudioBuffers progressively after unlock (one per frame) or on first use.
import type { GameEvent } from '../shared/events';
import { cueForEvent, PRIORITY, SFX, SFX_IDS, type SfxContext, type SfxCue, type SfxId } from './sfx';
import { buildSamples } from './synth';
import { Cooldowns, VoicePool, type VoiceSlot } from './voices';

export const MASTER_GAIN = 0.8; // 03 §11.6 defaults: Master 80, SFX 80
export const SFX_GAIN = 0.8;
export const MAX_VOICES = 16;
export const MAX_VOICES_LOW = 12;
const DIG_TICK_MS = 110;
const THRUST_GAIN = 0.55;
const THRUST_SMOOTH_S = 0.06;
/** Small random detune on pod sounds so repeats don't machine-gun (cents-level). */
const POD_JITTER = 0.03;

export interface PodAudioState {
  thrust: number;
  digging: boolean;
  drillTier: number;
}

export interface AudioEngineOptions {
  maxVoices?: number;
  enabled?: boolean;
  respectSilent?: boolean;
  /** iOS AudioContext 'interrupted' (a call, Siri): the app raises `interrupt` (canon §4.5). */
  onInterrupted?(): void;
}

type SessionType = 'ambient' | 'playback';

function setAudioSession(type: SessionType): void {
  try {
    const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (s) s.type = type;
  } catch {
    // Not supported (non-Safari): the silent switch does not apply there.
  }
}

function createContext(): AudioContext | null {
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}

interface Voice extends VoiceSlot {
  src: AudioBufferSourceNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private thrustGain: GainNode | null = null;
  private thrustSrc: AudioBufferSourceNode | null = null;
  private thrustLevel = 0;
  private readonly buffers = new Map<SfxId, AudioBuffer>();
  private renderCursor = 0;
  private readonly pool: VoicePool<Voice>;
  private readonly cooldowns = new Cooldowns<SfxId>();
  private enabled: boolean;
  private respectSilent: boolean;
  private primed = false;
  private lastDigTick = 0;
  private readonly sfxCtx: SfxContext = { drillTier: 1 };

  constructor(private readonly opts: AudioEngineOptions = {}) {
    this.pool = new VoicePool<Voice>(opts.maxVoices ?? MAX_VOICES);
    this.enabled = opts.enabled ?? true;
    this.respectSilent = opts.respectSilent ?? true;
  }

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /** AudioContext state, or 'none' before the first unlock gesture. */
  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  /**
   * Must run inside a user gesture. Creates the context on first call (after setting the audio session),
   * resumes it, and plays a 1-sample silent buffer, which is what actually unlocks output on iOS.
   */
  unlock(): void {
    try {
      if (!this.ctx) {
        setAudioSession(this.respectSilent ? 'ambient' : 'playback');
        this.ctx = createContext();
        if (!this.ctx) return;
        this.buildGraph(this.ctx);
      }
      const ctx = this.ctx;
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
      if (!this.primed) {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start(0);
        this.primed = true;
      }
    } catch {
      // Audio is never allowed to break input handling.
    }
  }

  /** Document-level unlock listeners (first pointerup/touchend/keydown, and again after an interruption). */
  installUnlockListeners(target: Document = document): () => void {
    const onGesture = (): void => {
      if (!this.unlocked) this.unlock();
    };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    for (const t of ['pointerup', 'touchend', 'keydown'] as const) target.addEventListener(t, onGesture, opts);
    return () => {
      for (const t of ['pointerup', 'touchend', 'keydown'] as const) target.removeEventListener(t, onGesture, opts);
    };
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? MASTER_GAIN : 0, this.ctx.currentTime, 0.02);
    if (!on) this.pool.stopAll();
  }

  setRespectSilent(on: boolean): void {
    this.respectSilent = on;
    if (this.ctx) setAudioSession(on ? 'ambient' : 'playback');
  }

  /** Page hidden: stop output (03 §11.1). */
  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  /** Page visible again: best effort (iOS may still need the resuming tap, which calls unlock()). */
  resume(): void {
    if (this.ctx && this.ctx.state !== 'running' && this.primed) void this.ctx.resume().catch(() => undefined);
  }

  handleEvents(events: readonly GameEvent[], drillTier: number): void {
    if (!this.canPlay()) return;
    this.sfxCtx.drillTier = drillTier;
    for (const e of events) {
      const c = cueForEvent(e, this.sfxCtx);
      if (c) this.playCue(c);
    }
  }

  playCue(c: SfxCue): void {
    if (!this.canPlay() || !this.cooldowns.take(c.id, SFX[c.id].cooldownMs, performance.now())) return;
    for (let k = 0; k <= c.repeat; k++) this.start(c.id, c.pitch, c.gain, (k * c.gapMs) / 1000);
  }

  play(id: SfxId, pitch = 1, gain = 1): void {
    this.playCue({ id, pitch, gain, repeat: 0, gapMs: 0 });
  }

  /** Once per frame: continuous sounds (thrust bed, dig ticks) and progressive buffer rendering. */
  update(pod: PodAudioState, nowMs: number): void {
    if (!this.ctx) return;
    this.renderNext();
    if (!this.canPlay()) return;
    this.updateThrust(pod.thrust);
    if (pod.digging && nowMs - this.lastDigTick >= DIG_TICK_MS) {
      this.lastDigTick = nowMs;
      this.start('digTick', 2 ** ((2 * (pod.drillTier - 1)) / 12), 0.6, 0);
    }
  }

  dispose(): void {
    this.pool.stopAll();
    try {
      this.thrustSrc?.stop();
    } catch {
      // Already stopped.
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  // ---------------------------------------------------------------- internals

  private canPlay(): boolean {
    return this.enabled && this.ctx !== null && this.ctx.state === 'running';
  }

  private buildGraph(ctx: AudioContext): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? MASTER_GAIN : 0;
    this.master.connect(comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = SFX_GAIN;
    this.sfxBus.connect(this.master);
    ctx.onstatechange = () => {
      // 'interrupted' is WebKit-only and missing from the DOM typings.
      if ((ctx.state as string) === 'interrupted') this.opts.onInterrupted?.();
    };
  }

  private buffer(id: SfxId): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    let buf = this.buffers.get(id);
    if (!buf) {
      const samples = buildSamples(SFX[id].params, ctx.sampleRate);
      buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buf.getChannelData(0).set(samples);
      this.buffers.set(id, buf);
    }
    return buf;
  }

  /** Render one not-yet-cached buffer per frame so no single frame pays for the whole set. */
  private renderNext(): void {
    while (this.renderCursor < SFX_IDS.length && this.buffers.has(SFX_IDS[this.renderCursor])) this.renderCursor++;
    if (this.renderCursor < SFX_IDS.length) this.buffer(SFX_IDS[this.renderCursor++]);
  }

  private start(id: SfxId, pitch: number, gain: number, delaySec: number): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    const def = SFX[id];
    if (!ctx || !bus || def.loop) return;
    const now = performance.now();
    if (!this.pool.admit(def.priority, now)) return;
    const buf = this.buffer(id);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const jitter = def.priority === PRIORITY.pod ? 1 + (Math.random() * 2 - 1) * POD_JITTER : 1;
    src.playbackRate.value = pitch * jitter;
    let out: AudioNode = src;
    if (gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      out = g;
    }
    out.connect(bus);
    src.start(ctx.currentTime + delaySec);
    const voice: Voice = {
      src,
      priority: def.priority,
      startedAt: now,
      endsAt: now + (delaySec + buf.duration / src.playbackRate.value) * 1000,
      stop: () => {
        try {
          src.stop();
        } catch {
          // Not started or already ended.
        }
      },
    };
    this.pool.add(voice);
    src.onended = () => {
      this.pool.release(voice);
      out.disconnect();
    };
  }

  private updateThrust(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    if (!this.thrustSrc) {
      if (level <= 0) return;
      const buf = this.buffer('thrust');
      if (!buf) return;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      this.thrustGain = ctx.createGain();
      this.thrustGain.gain.value = 0;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(filter).connect(this.thrustGain).connect(this.sfxBus);
      src.start();
      this.thrustSrc = src;
    }
    const target = Math.max(0, Math.min(1, level)) * THRUST_GAIN;
    if (Math.abs(target - this.thrustLevel) < 0.01) return;
    this.thrustLevel = target;
    this.thrustGain?.gain.setTargetAtTime(target, ctx.currentTime, THRUST_SMOOTH_S);
  }
}

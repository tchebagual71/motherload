// Web Audio glue shared by SFX, music, blips and ambience: one-shot sources admitted through the voice pool
// (04 §8.1), looped sources that start on demand and stop when idle, and the rendered-buffer bank.
import { VoicePool, type VoiceSlot } from './voices';

export interface Voice extends VoiceSlot {
  src: AudioBufferSourceNode;
  /** Per-voice gain (velocity); stolen voices with one fade out instead of clicking. */
  gain: GainNode | null;
}

/** A stolen note fades over this time constant before its source stops. */
const STEAL_FADE_S = 0.012;

/** Rendered buffers by key, with the decoded-bytes total for the 03 §11.1 budget (≤ 8 MB low, 16 MB mid). */
export class Bank<K> {
  private readonly map = new Map<K, AudioBuffer>();
  bytes = 0;

  constructor(private readonly ctx: BaseAudioContext) {}

  get size(): number {
    return this.map.size;
  }

  peek(key: K): AudioBuffer | undefined {
    return this.map.get(key);
  }

  put(key: K, sampleRate: number, samples: Float32Array): AudioBuffer {
    const buf = this.ctx.createBuffer(1, samples.length, sampleRate);
    buf.getChannelData(0).set(samples);
    this.map.set(key, buf);
    this.bytes += samples.length * 4;
    return buf;
  }
}

/** Starts one-shot buffers through the shared voice pool. */
export class SourcePlayer {
  constructor(
    private readonly ctx: BaseAudioContext,
    readonly pool: VoicePool<Voice>,
    private readonly now: () => number,
  ) {}

  /**
   * Plays `buf` into `dest` at AudioContext time `when` (clamped to now), at playback `rate` and `gain`. Returns the
   * voice, or null when the pool refused it (everything playing outranks it).
   */
  play(buf: AudioBuffer, dest: AudioNode, when: number, rate: number, gain: number, priority: number, withGain: boolean): Voice | null {
    const ctx = this.ctx;
    const nowMs = this.now();
    if (!this.pool.admit(priority, nowMs)) return null;
    const at = Math.max(when, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    let g: GainNode | null = null;
    if (withGain || gain !== 1) {
      g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      g.connect(dest);
    } else {
      src.connect(dest);
    }
    src.start(at);
    const voice: Voice = {
      src,
      gain: g,
      priority,
      startedAt: nowMs + (at - ctx.currentTime) * 1000,
      endsAt: nowMs + (at - ctx.currentTime + buf.duration / rate) * 1000,
      stop: () => stopVoice(ctx, src, g),
    };
    this.pool.add(voice);
    src.onended = () => {
      this.pool.release(voice);
      src.disconnect();
      g?.disconnect();
    };
    return voice;
  }
}

function stopVoice(ctx: BaseAudioContext, src: AudioBufferSourceNode, g: GainNode | null): void {
  try {
    if (g) {
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(0, t, STEAL_FADE_S);
      src.stop(t + STEAL_FADE_S * 5);
    } else {
      src.stop();
    }
  } catch {
    // Not started or already ended.
  }
}

/** Idle time before a silent loop's source is stopped (CPU: a silent source still runs). */
const LOOP_IDLE_S = 1.5;
const LOOP_SILENT = 0.0005;

/**
 * A looped source (engine hum, fall whistle, ambience bed) behind its own gain. `set` starts the source when the
 * level rises, smooths level and rate changes, and stops the source after LOOP_IDLE_S of silence.
 */
export class LoopVoice {
  readonly gain: GainNode;
  private src: AudioBufferSourceNode | null = null;
  private level = 0;
  private rate = 1;
  private silentSince = Number.POSITIVE_INFINITY;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly buffer: () => AudioBuffer | null,
    private readonly smoothS: number,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(dest);
  }

  get active(): boolean {
    return this.src !== null;
  }

  get target(): number {
    return this.level;
  }

  set(level: number, rate: number, t: number): void {
    if (level > LOOP_SILENT && !this.src && !this.begin(rate)) return;
    if (!this.src) return;
    if (Math.abs(level - this.level) >= 0.005 || (level <= LOOP_SILENT && this.level > LOOP_SILENT)) {
      this.level = level;
      this.gain.gain.setTargetAtTime(level, t, this.smoothS);
    }
    if (Math.abs(rate - this.rate) >= 0.003) {
      this.rate = rate;
      this.src.playbackRate.setTargetAtTime(rate, t, this.smoothS);
    }
    if (this.level > LOOP_SILENT) this.silentSince = Number.POSITIVE_INFINITY;
    else if (this.silentSince === Number.POSITIVE_INFINITY) this.silentSince = t;
    else if (t - this.silentSince >= LOOP_IDLE_S) this.stop();
  }

  stop(): void {
    if (!this.src) return;
    try {
      this.src.stop();
    } catch {
      // Already stopped.
    }
    this.src.disconnect();
    this.src = null;
    this.level = 0;
    this.gain.gain.cancelScheduledValues(0);
    this.gain.gain.value = 0;
    this.silentSince = Number.POSITIVE_INFINITY;
  }

  private begin(rate: number): boolean {
    const buf = this.buffer();
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(this.gain);
    src.start();
    this.src = src;
    this.rate = rate;
    return true;
  }
}

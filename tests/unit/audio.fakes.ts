// A recording fake of the Web Audio surface the engine uses, so engine behaviour (unlock, lifecycle, scheduling,
// voice limits, mix targets) is tested in Node without an AudioContext. Time only moves through advance().
import type { AudioClock } from '../../src/audio/engine';

export class FakeParam {
  value: number;
  /** Last setTargetAtTime target (or the plain value). */
  target: number;
  events: { kind: string; v: number; t: number }[] = [];

  constructor(v: number) {
    this.value = v;
    this.target = v;
  }

  setTargetAtTime(v: number, t: number): this {
    this.target = v;
    this.events.push({ kind: 'target', v, t });
    return this;
  }

  setValueAtTime(v: number, t: number): this {
    this.value = v;
    this.target = v;
    this.events.push({ kind: 'value', v, t });
    return this;
  }

  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  disconnected = false;

  constructor(readonly ctx: FakeAudioContext) {}

  connect<T extends FakeNode>(n: T): T {
    this.outputs.push(n);
    return n;
  }

  disconnect(): void {
    this.disconnected = true;
    this.outputs.length = 0;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly ratio = new FakeParam(12);
  readonly knee = new FakeParam(30);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
}

export class FakeBuffer {
  readonly duration: number;
  private readonly data: Float32Array;

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  ended = false;
  /** Clock time the source was created (to check the scheduling look-ahead). */
  readonly createdAt: number;

  constructor(ctx: FakeAudioContext) {
    super(ctx);
    this.createdAt = ctx.currentTime;
  }

  start(when = 0): void {
    if (this.startedAt !== null) throw new Error('start() twice');
    this.startedAt = Math.max(when, this.ctx.currentTime);
  }

  stop(when = 0): void {
    if (this.startedAt === null) throw new Error('stop() before start()');
    this.stoppedAt = Math.max(when, this.ctx.currentTime);
  }

  /** When the source stops making sound (natural end, stop time, or never for a loop). */
  get endsAt(): number {
    const natural = this.loop || !this.buffer ? Infinity : this.startedAt! + this.buffer.duration / this.playbackRate.value;
    return Math.min(natural, this.stoppedAt ?? Infinity);
  }

  /** Sounding at time t. */
  soundingAt(t: number): boolean {
    return this.startedAt !== null && !this.ended && this.startedAt <= t && t < this.endsAt;
  }
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate: number;
  state: string = 'suspended';
  onstatechange: (() => void) | null = null;
  readonly destination = new FakeNode(this);
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closed = false;

  constructor(sampleRate = 48_000) {
    this.sampleRate = sampleRate;
  }

  createGain(): FakeGain {
    const g = new FakeGain(this);
    this.gains.push(g);
    return g;
  }

  createBiquadFilter(): FakeFilter {
    const f = new FakeFilter(this);
    this.filters.push(f);
    return f;
  }

  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }

  createBuffer(ch: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(ch, length, sampleRate);
  }

  createBufferSource(): FakeSource {
    const s = new FakeSource(this);
    this.sources.push(s);
    return s;
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    this.setState('running');
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls++;
    this.setState('suspended');
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    this.setState('closed');
    return Promise.resolve();
  }

  setState(s: string): void {
    this.state = s;
    this.onstatechange?.();
  }

  /** Moves the clock and fires onended for one-shots that finished. */
  advance(dt: number): void {
    this.currentTime += dt;
    for (const s of this.sources) {
      if (!s.ended && s.startedAt !== null && s.endsAt <= this.currentTime) {
        s.ended = true;
        s.onended?.();
      }
    }
  }

  /** Sources (excluding the 1-sample unlock primer) sounding right now. */
  sounding(): FakeSource[] {
    return this.sources.filter((s) => (s.buffer?.length ?? 0) > 1 && s.soundingAt(this.currentTime));
  }
}

/** A hand-driven AudioClock. */
export class FakeClock implements AudioClock {
  fns: (() => void)[] = [];

  every(_ms: number, fn: () => void): () => void {
    this.fns.push(fn);
    return () => {
      this.fns = this.fns.filter((f) => f !== fn);
    };
  }

  tick(): void {
    for (const f of [...this.fns]) f();
  }

  get running(): boolean {
    return this.fns.length > 0;
  }
}

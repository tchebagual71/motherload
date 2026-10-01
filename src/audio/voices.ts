// Voice allocation (04 §8.1): a fixed number of simultaneous one-shots; when full, the lowest-priority voice is
// stolen first, then the oldest; a newcomer below every playing voice is dropped. Pure bookkeeping — the
// engine attaches the actual AudioBufferSourceNode via `stop`.

export interface VoiceSlot {
  priority: number;
  startedAt: number;
  endsAt: number;
  stop(): void;
}

export class VoicePool<V extends VoiceSlot = VoiceSlot> {
  private readonly voices: V[] = [];

  constructor(readonly max: number) {}

  get size(): number {
    return this.voices.length;
  }

  /** Drop voices that finished by `now`. */
  prune(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i].endsAt <= now) this.voices.splice(i, 1);
  }

  /** Make room for a voice of `priority`. Returns false when it should not play. */
  admit(priority: number, now: number): boolean {
    this.prune(now);
    if (this.voices.length < this.max) return true;
    const victim = this.victim();
    if (!victim || victim.priority > priority) return false;
    this.release(victim);
    victim.stop();
    return true;
  }

  add(v: V): void {
    this.voices.push(v);
  }

  release(v: V): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  stopAll(): void {
    for (const v of this.voices.splice(0)) v.stop();
  }

  /** Lowest priority, then oldest. */
  private victim(): V | null {
    let best: V | null = null;
    for (const v of this.voices) {
      if (!best || v.priority < best.priority || (v.priority === best.priority && v.startedAt < best.startedAt)) best = v;
    }
    return best;
  }
}

/** Per-sound minimum spacing (04 §8.1 cooldowns). */
export class Cooldowns<K extends string = string> {
  private readonly last = new Map<K, number>();

  /** True (and records `now`) when `key` may play again. */
  take(key: K, cooldownMs: number, now: number): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < cooldownMs) return false;
    this.last.set(key, now);
    return true;
  }
}

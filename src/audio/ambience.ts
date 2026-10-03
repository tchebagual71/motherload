// Ambience (03 §11.3; MVP B0–B4, 04 §8.2): three looped beds crossfaded by depth (mix.ts) and sparse one-shots — a
// pebble trickle near the surface, drips in the damp bands, creaks in the clay. Beds run only while audible.
import { renderBed, BEDS, type BedId } from './beds';
import type { AmbienceMix } from './mix';
import { Bank, LoopVoice, type SourcePlayer } from './play';
import { bandIndex, PRIORITY } from './sfx';
import { buildSamples, type ZzfxParams } from './synth';

/** Bed levels under the ambience bus: thin beds (03 §11.3), wind loudest in the open. */
const BED_GAIN: Readonly<Record<BedId, number>> = { wind: 0.35, earth: 0.3, deep: 0.35 };
const BED_SMOOTH_S = 0.6;
const BED_IDS: readonly BedId[] = ['wind', 'earth', 'deep'];

type ShotId = 'pebbles' | 'drip' | 'creak';

const SHOTS: Readonly<Record<ShotId, ZzfxParams>> = {
  pebbles: [0.4, 0, 900, 0, 0.01, 0.05, 4, 1, 0, 0, 0, 0, 0.045, 2, 0, 0, 0.03, 0.6, 0.01, 0.5, -1800],
  drip: [0.35, 0, 1100, 0, 0.005, 0.07, 0, 1, 40, 0, 0, 0, 0, 0, 0, 0, 0.12, 0.6, 0.01, 0, 0],
  creak: [0.3, 0, 140, 0.08, 0.25, 0.2, 2, 1, 0.4, 0, 0, 0, 0.025, 0.2, 0, 0, 0, 0.5, 0, 0.6, -900],
};
const SHOT_IDS = Object.keys(SHOTS) as ShotId[];

/** Which one-shots each band B0–B7 hears (03 §11.3: B0–B1 pebbles and drips, B2 creaks, B3 ticks…). */
const BAND_SHOTS: readonly (readonly ShotId[])[] = [['pebbles'], ['pebbles', 'drip'], ['drip', 'creak'], ['drip'], [], [], [], []];
const SHOT_MIN_MS = 5_000;
const SHOT_SPREAD_MS = 9_000;
const SHOT_GAIN = 0.6;

export class AmbiencePlayer {
  readonly bank: Bank<BedId>;
  private readonly shotBank: Bank<ShotId>;
  private readonly beds: Record<BedId, LoopVoice>;
  private readonly windFilter: BiquadFilterNode;
  private readonly bus: GainNode;
  private duckTarget = 1;
  private nextShotAt = Number.NEGATIVE_INFINITY;
  private windCutoff = -1;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly player: SourcePlayer,
    private readonly random: () => number,
  ) {
    this.bank = new Bank<BedId>(ctx);
    this.shotBank = new Bank<ShotId>(ctx);
    this.bus = ctx.createGain();
    this.bus.connect(dest);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 5_000;
    this.windFilter.connect(this.bus);
    const bed = (id: BedId, out: AudioNode): LoopVoice => new LoopVoice(ctx, out, () => this.bedBuffer(id), BED_SMOOTH_S);
    this.beds = { wind: bed('wind', this.windFilter), earth: bed('earth', this.bus), deep: bed('deep', this.bus) };
  }

  /** Render jobs: the beds, then the one-shots. */
  renderJobs(): (() => void)[] {
    return [...BED_IDS.map((id) => () => void this.bedBuffer(id)), ...SHOT_IDS.map((id) => () => void this.shotBuffer(id))];
  }

  levels(): Record<BedId, number> {
    return { wind: this.beds.wind.target, earth: this.beds.earth.target, deep: this.beds.deep.target };
  }

  setMix(mix: AmbienceMix, duck: number, t: number): void {
    this.beds.wind.set(mix.wind * BED_GAIN.wind, 1, t);
    this.beds.earth.set(mix.earth * BED_GAIN.earth, 1, t);
    this.beds.deep.set(mix.deep * BED_GAIN.deep, 1, t);
    if (Math.abs(mix.windCutoffHz - this.windCutoff) > this.windCutoff * 0.01) {
      this.windCutoff = mix.windCutoffHz;
      this.windFilter.frequency.setTargetAtTime(mix.windCutoffHz, t, BED_SMOOTH_S);
    }
    if (Math.abs(duck - this.duckTarget) > 0.005) {
      this.duckTarget = duck;
      this.bus.gain.setTargetAtTime(duck, t, 0.15);
    }
  }

  /** Sparse one-shots for the band at `depth`, at random 5–14 s intervals. */
  update(nowMs: number, depth: number, t: number): void {
    if (nowMs < this.nextShotAt) return;
    const first = this.nextShotAt === Number.NEGATIVE_INFINITY;
    this.nextShotAt = nowMs + SHOT_MIN_MS + this.random() * SHOT_SPREAD_MS;
    const choices = BAND_SHOTS[bandIndex(Math.floor(depth))];
    if (first || depth < 1 || choices.length === 0) return;
    const id = choices[Math.floor(this.random() * choices.length)];
    const rate = 0.85 + this.random() * 0.3;
    this.player.play(this.shotBuffer(id), this.bus, t, rate, SHOT_GAIN * (0.6 + 0.4 * this.random()), PRIORITY.ambience, false);
  }

  stop(): void {
    for (const id of BED_IDS) this.beds[id].stop();
  }

  private bedBuffer(id: BedId): AudioBuffer {
    return this.bank.peek(id) ?? this.bank.put(id, BEDS[id].sampleRate, renderBed(id));
  }

  private shotBuffer(id: ShotId): AudioBuffer {
    const sr = this.ctx.sampleRate;
    return this.shotBank.peek(id) ?? this.shotBank.put(id, sr, buildSamples(SHOTS[id], sr));
  }

  get bytes(): number {
    return this.bank.bytes + this.shotBank.bytes;
  }
}

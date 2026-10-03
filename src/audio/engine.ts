// Web Audio engine (04 §8; 03 §11.1, §11.6). One lazily created AudioContext, unlocked on the first pointerup /
// touchend / keydown (iOS); the silent switch is respected by default through navigator.audioSession.type =
// 'ambient' ('playback' when the player opts into sound in silent mode), set before the context exists.
// Graph: SFX (drill band filter) · voice blips (300–3,400 Hz band) · music (depth low-pass) · ambience beds → master →
// compressor (−18 dB, 3:1) → limiter → destination. Buffers are rendered progressively after unlock, one per frame.
// A 25-ms clock schedules music and blips ≤ 100 ms ahead on the AudioContext clock (04 §8.1).
import { FALL_CAP_V, HARD_LANDING_V } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import { AmbiencePlayer } from './ambience';
import { RadioVoice, type Blip, type Sender } from './blips';
import { ambienceMix, dbToGain, DUCK, Ducks, kettleMix, type AmbienceMix, type MusicMix } from './mix';
import { LOOKAHEAD_S, MusicPlayer } from './music';
import { Bank, LoopVoice, SourcePlayer, type Voice } from './play';
import { cueForEvent, drillBand, PRIORITY, renderSfx, semitones, SFX, SFX_IDS, type SfxBus, type SfxContext, type SfxCue, type SfxId } from './sfx';
import { Cooldowns, VoicePool } from './voices';

// 03 §11.6 defaults: Master 80, Music 60, SFX 80, Ambience 70, Voice 70.
export const MASTER_GAIN = 0.8;
export const MUSIC_GAIN = 0.6;
export const SFX_GAIN = 0.8;
export const AMBIENCE_GAIN = 0.7;
export const VOICE_GAIN = 0.7;
/**
 * Make-up gain into the compressor, toward the 03 §11.6 ≈ −16 LUFS mix (measured at the limiter in Chromium: Kettle
 * On over the Rim wind ≈ −18.5 dBFS RMS, peaks ≈ −4 dBFS). SFX get a further +3 dB so tells sit over the music.
 */
const OUTPUT_TRIM = 2;
const SFX_TRIM = 1.4;
/** Every source playing at once, loops included (the CPU budget on a low-tier phone). */
export const MAX_VOICES = 16;
export const MAX_VOICES_LOW = 12;
/** Loops that hold a source while audible: engine hum, fall whistle and the three ambience beds. */
export const LOOP_VOICES = 5;
/** The song's own share of the pool; its oldest note is cut beyond this. */
export const MUSIC_NOTES = 6;
export const MUSIC_NOTES_LOW = 4;
export const CLOCK_MS = 25;
/** SFX render rate cap: tells live in 400 Hz–4 kHz (03 §11.1), and 32 kHz keeps the set ≈ 1.7 MB decoded. */
export const SFX_MAX_RATE = 32_000;
const DIG_TICK_MS = 110;
const THRUST_GAIN = 0.55;
const THRUST_SMOOTH_S = 0.06;
const WHISTLE_GAIN = 0.3;
/** Small random detune on pod sounds so repeats don't machine-gun (cents-level). */
const POD_JITTER = 0.03;
/** Blips start this long after the radio event, so the first one is never late. */
const SPEECH_DELAY_S = 0.05;
const RADIO_TAIL_MS = 300;
/** Arming ticks per ring (a tick at each quarter; the last, at full, is the "armed" one). */
const ARM_TICKS = 4;

export interface PodAudioState {
  thrust: number;
  digging: boolean;
  drillTier: number;
  /** Engine tier: the hum rises a little per tier (03 §11.4 ★6 "timbre by tier"). */
  engineTier: number;
  /** Vertical speed, tiles/s (negative = falling): the fall whistle above 5.88 tiles/s (★7). */
  vy: number;
  /** Rows below the Rim surface, 0 on the Rim and in the sky: Kettle On's low-pass and the ambience beds. */
  depth: number;
  /** A sheet is open or build mode is on: music ducks −4 dB with a 4-kHz low-pass (03 §11.2). */
  ducked: boolean;
  /** Quick-slot arming progress 0..1, or −1 when nothing is arming (★20 arming tick). */
  arming: number;
}

export type SessionType = 'ambient' | 'playback';

/** A repeating timer (setInterval by default; tests drive it by hand). */
export interface AudioClock {
  every(ms: number, fn: () => void): () => void;
}

export interface AudioEngineOptions {
  maxVoices?: number;
  enabled?: boolean;
  music?: boolean;
  respectSilent?: boolean;
  /** Reduced motion: radio voices speak one blip per word (03 §11.5). */
  reducedMotion?: boolean;
  /** iOS AudioContext 'interrupted' (a call, Siri): the app raises `interrupt` (canon §4.5). */
  onInterrupted?(): void;
  /** Injected for tests; default: window.AudioContext (or webkitAudioContext). */
  createContext?(): AudioContext | null;
  /** Injected for tests; default: navigator.audioSession.type when the API exists (Safari 17+). */
  setSession?(type: SessionType): void;
  clock?: AudioClock;
  /** Milliseconds, monotonic (default performance.now). */
  now?(): number;
  random?(): number;
  /** Music variation seed. */
  seed?: number;
}

export interface AudioDebugInfo {
  state: string;
  voices: number;
  musicPlaying: boolean;
  musicBar: number;
  musicGain: number;
  musicCutoffHz: number;
  notesPlayed: number;
  ambience: { wind: number; earth: number; deep: number };
  speaking: boolean;
  buffers: number;
  decodedBytes: number;
  clock: boolean;
}

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

const intervalClock: AudioClock = {
  every(ms, fn) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

export function sfxRate(contextRate: number): number {
  return Math.min(contextRate, SFX_MAX_RATE);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

interface Graph {
  /** The limiter, last node before the destination (a tap point for level checks). */
  out: AudioNode;
  master: GainNode;
  sfx: GainNode;
  drill: BiquadFilterNode;
  voice: GainNode;
  music: GainNode;
  ambience: GainNode;
}

/** Everything that exists once the context does. */
interface Live {
  ctx: AudioContext;
  graph: Graph;
  sfxBank: Bank<SfxId>;
  player: SourcePlayer;
  music: MusicPlayer;
  ambience: AmbiencePlayer;
  thrust: LoopVoice;
  whistle: LoopVoice;
  jobs: (() => void)[];
}

export class AudioEngine {
  private live: Live | null = null;
  private readonly pool: VoicePool<Voice>;
  private readonly cooldowns = new Cooldowns<SfxId>();
  private readonly radio = new RadioVoice();
  private readonly ducks = new Ducks();
  private readonly musicMix: MusicMix = { cutoffHz: 16_000, gain: 1 };
  private readonly ambMix: AmbienceMix = { wind: 1, earth: 0, deep: 0, windCutoffHz: 5_000 };
  private readonly sfxCtx: SfxContext = { drillTier: 1 };
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly clock: AudioClock;
  private enabled: boolean;
  private musicOn: boolean;
  private respectSilent: boolean;
  private reducedMotion: boolean;
  private hidden = false;
  private primed = false;
  private lastDigTick = 0;
  private drillRow = -1;
  private armTick = -1;
  private jobCursor = 0;
  private stopClock: (() => void) | null = null;

  constructor(private readonly opts: AudioEngineOptions = {}) {
    const max = opts.maxVoices ?? MAX_VOICES;
    this.pool = new VoicePool<Voice>(Math.max(1, max - LOOP_VOICES));
    this.enabled = opts.enabled ?? true;
    this.musicOn = opts.music ?? true;
    this.respectSilent = opts.respectSilent ?? true;
    this.reducedMotion = opts.reducedMotion ?? false;
    this.now = opts.now ?? (() => performance.now());
    this.random = opts.random ?? Math.random;
    this.clock = opts.clock ?? intervalClock;
  }

  get unlocked(): boolean {
    return this.live?.ctx.state === 'running';
  }

  /** AudioContext state, or 'none' before the first unlock gesture. */
  get state(): string {
    return this.live?.ctx.state ?? 'none';
  }

  /**
   * Must run inside a user gesture. Creates the context on first call (after setting the audio session),
   * resumes it, and plays a 1-sample silent buffer, which is what actually unlocks output on iOS.
   */
  unlock(): void {
    if (this.hidden) return;
    try {
      if (!this.live) {
        this.session(this.respectSilent ? 'ambient' : 'playback');
        const ctx = (this.opts.createContext ?? createContext)();
        if (!ctx) return;
        this.live = this.build(ctx);
      }
      const ctx = this.live.ctx;
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

  /** Document-level unlock listeners (first pointerup/touchend/keydown, and the resuming tap after hide). */
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
    const live = this.live;
    if (!live) return;
    live.graph.master.gain.setTargetAtTime(on ? MASTER_GAIN : 0, live.ctx.currentTime, 0.02);
    if (!on) this.silence(live);
  }

  /** The Music setting (Kettle On); ambience and SFX are unaffected. */
  setMusic(on: boolean): void {
    this.musicOn = on;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  setRespectSilent(on: boolean): void {
    this.respectSilent = on;
    if (this.live) this.session(on ? 'ambient' : 'playback');
  }

  /** Page hidden: stop output and the clock (03 §11.1). */
  suspend(): void {
    this.hidden = true;
    this.halt();
    const ctx = this.live?.ctx;
    if (ctx?.state === 'running') void ctx.suspend().catch(() => undefined);
  }

  /**
   * Page visible again. Output resumes on the next gesture (the "Tap to resume" card the visibility interrupt
   * raises), never by itself: 03 §11.1 "resume() on the resuming tap".
   */
  resume(): void {
    this.hidden = false;
  }

  handleEvents(events: readonly GameEvent[], drillTier: number): void {
    if (!this.canPlay()) return;
    this.sfxCtx.drillTier = drillTier;
    for (const e of events) {
      if (e.t === 'radio') {
        if (e.cards.length > 0) this.speak(e.sender, e.cards[0]);
        continue;
      }
      if (e.t === 'dig-start' || e.t === 'dug') this.setDrillRow(e.r);
      const c = cueForEvent(e, this.sfxCtx);
      if (c) this.playCue(c);
    }
  }

  /** Speak one radio card as blips (the UI calls this for each further card; a new card cuts the old one). */
  speak(sender: Sender, text: string): void {
    const live = this.live;
    if (!live || !this.canPlay()) return;
    const len = this.radio.speak(sender, text, live.ctx.currentTime + SPEECH_DELAY_S, this.reducedMotion);
    this.ducks.hit('radio', this.now(), len * 1000 + RADIO_TAIL_MS);
  }

  /** The card was dismissed: stop its blips and lift the radio duck. */
  stopSpeech(): void {
    this.radio.stop();
    this.ducks.clearRadio();
  }

  playCue(c: SfxCue): void {
    const live = this.live;
    const def = SFX[c.id];
    if (!live || !this.canPlay() || !this.cooldowns.take(c.id, def.cooldownMs, this.now())) return;
    const t = live.ctx.currentTime;
    for (let k = 0; k <= c.repeat; k++) this.start(live, c.id, c.pitch, c.gain, t + (k * c.gapMs) / 1000);
    if (def.duck) this.ducks.hit(def.duck, this.now(), def.duck === 'alarm' ? DUCK.alarmMs : DUCK.sellMs);
  }

  play(id: SfxId, pitch = 1, gain = 1): void {
    this.playCue({ id, pitch, gain, repeat: 0, gapMs: 0 });
  }

  /** Once per frame: progressive rendering, continuous pod sounds, depth mix and ambience one-shots. */
  update(pod: PodAudioState, nowMs: number): void {
    const live = this.live;
    if (!live) return;
    this.renderNext(live);
    if (!this.canPlay()) {
      this.halt();
      return;
    }
    this.ensureClock();
    const t = live.ctx.currentTime;
    this.updatePodLoops(live, pod, t);
    if (pod.digging && nowMs - this.lastDigTick >= DIG_TICK_MS) {
      this.lastDigTick = nowMs;
      this.start(live, 'digTick', semitones(2 * (pod.drillTier - 1)) * drillBand(Math.floor(pod.depth)).pitch, 0.6, t);
    }
    this.updateArming(live, pod.arming, t);
    this.updateMix(live, pod, nowMs, t);
    live.ambience.update(nowMs, pod.depth, t);
  }

  debugInfo(): AudioDebugInfo {
    const live = this.live;
    return {
      state: this.state,
      voices: this.pool.size,
      musicPlaying: live?.music.isPlaying ?? false,
      musicBar: live?.music.bar ?? 0,
      musicGain: live?.music.gain ?? 0,
      musicCutoffHz: live?.music.cutoff ?? 0,
      notesPlayed: live?.music.notesPlayed ?? 0,
      ambience: live?.ambience.levels() ?? { wind: 0, earth: 0, deep: 0 },
      speaking: this.radio.speaking,
      buffers: live ? live.sfxBank.size + live.music.bank.size + live.ambience.bank.size : 0,
      decodedBytes: live ? live.sfxBank.bytes + live.music.bank.bytes + live.ambience.bytes : 0,
      clock: this.stopClock !== null,
    };
  }

  dispose(): void {
    const live = this.live;
    this.halt();
    if (!live) return;
    this.silence(live);
    void live.ctx.close().catch(() => undefined);
    this.live = null;
  }

  // ---------------------------------------------------------------- internals

  private canPlay(): boolean {
    return this.enabled && !this.hidden && this.live !== null && this.live.ctx.state === 'running';
  }

  private session(type: SessionType): void {
    (this.opts.setSession ?? setAudioSession)(type);
  }

  private build(ctx: AudioContext): Live {
    const graph = this.buildGraph(ctx);
    const sfxBank = new Bank<SfxId>(ctx);
    const player = new SourcePlayer(ctx, this.pool, this.now);
    const low = (this.opts.maxVoices ?? MAX_VOICES) < MAX_VOICES;
    const music = new MusicPlayer(ctx, graph.music, player, this.opts.seed ?? 0x6b657474, low ? MUSIC_NOTES_LOW : MUSIC_NOTES);
    const ambience = new AmbiencePlayer(ctx, graph.ambience, player, this.random);
    const loopBuf = (id: SfxId) => () => this.sfxBuffer(sfxBank, ctx, id);
    const thrust = new LoopVoice(ctx, graph.sfx, loopBuf('thrust'), THRUST_SMOOTH_S);
    const whistle = new LoopVoice(ctx, graph.sfx, loopBuf('whistle'), 0.1);
    const sfxJobs = SFX_IDS.map((id) => () => void this.sfxBuffer(sfxBank, ctx, id));
    const amb = ambience.renderJobs();
    // UI and pod sounds first, the Rim wind and the song next, the deeper beds last.
    const jobs = [...sfxJobs, amb[0], ...music.renderJobs(), ...amb.slice(1)];
    ctx.onstatechange = () => {
      // 'interrupted' is WebKit-only and missing from the DOM typings.
      if ((ctx.state as string) === 'interrupted') this.opts.onInterrupted?.();
    };
    return { ctx, graph, sfxBank, player, music, ambience, thrust, whistle, jobs };
  }

  private buildGraph(ctx: AudioContext): Graph {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    // Brick-wall-ish limiter after the glue compressor (04 §8.2 MVP "compressor, limiter").
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    comp.connect(limiter).connect(ctx.destination);
    const trim = this.gain(ctx, OUTPUT_TRIM, comp);
    const master = this.gain(ctx, this.enabled ? MASTER_GAIN : 0, trim);
    const sfx = this.gain(ctx, SFX_GAIN * SFX_TRIM, master);
    const drill = ctx.createBiquadFilter();
    drill.type = 'lowpass';
    drill.frequency.value = drillBand(0).lowpassHz;
    drill.connect(sfx);
    // 03 §11.5: blips band-passed 300–3,400 Hz.
    const voiceHp = ctx.createBiquadFilter();
    voiceHp.type = 'highpass';
    voiceHp.frequency.value = 300;
    const voiceLp = ctx.createBiquadFilter();
    voiceLp.type = 'lowpass';
    voiceLp.frequency.value = 3_400;
    voiceHp.connect(voiceLp).connect(master);
    const voice = this.gain(ctx, VOICE_GAIN, voiceHp);
    const music = this.gain(ctx, MUSIC_GAIN, master);
    const ambience = this.gain(ctx, AMBIENCE_GAIN, master);
    return { out: limiter, master, sfx, drill, voice, music, ambience };
  }

  private gain(ctx: AudioContext, value: number, dest: AudioNode): GainNode {
    const g = ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  }

  private bus(g: Graph, bus: SfxBus | undefined): AudioNode {
    return bus === 'drill' ? g.drill : bus === 'voice' ? g.voice : g.sfx;
  }

  private sfxBuffer(bank: Bank<SfxId>, ctx: BaseAudioContext, id: SfxId): AudioBuffer {
    const sr = sfxRate(ctx.sampleRate);
    return bank.peek(id) ?? bank.put(id, sr, renderSfx(id, sr));
  }

  /** One not-yet-rendered buffer per frame, so no single frame pays for the whole set. */
  private renderNext(live: Live): void {
    if (this.jobCursor < live.jobs.length) live.jobs[this.jobCursor++]();
  }

  private start(live: Live, id: SfxId, pitch: number, gain: number, when: number): void {
    const def = SFX[id];
    if (def.loop) return;
    const jitter = def.priority === PRIORITY.pod ? 1 + (this.random() * 2 - 1) * POD_JITTER : 1;
    const buf = this.sfxBuffer(live.sfxBank, live.ctx, id);
    live.player.play(buf, this.bus(live.graph, def.bus), when, pitch * jitter, gain, def.priority, false);
  }

  private readonly playBlip = (b: Blip, when: number): void => {
    const live = this.live;
    if (live) this.start(live, b.sound, b.pitch, b.gain, when);
  };

  private readonly onClock = (): void => {
    const live = this.live;
    if (!live || !this.canPlay()) return;
    const t = live.ctx.currentTime;
    live.music.pump(t);
    this.radio.pump(t + LOOKAHEAD_S, this.playBlip);
  };

  private ensureClock(): void {
    if (!this.stopClock) this.stopClock = this.clock.every(CLOCK_MS, this.onClock);
  }

  private halt(): void {
    this.stopClock?.();
    this.stopClock = null;
  }

  /** Stop every source (sound off): nothing keeps running silently. */
  private silence(live: Live): void {
    this.halt();
    this.pool.stopAll();
    live.music.stop();
    live.ambience.stop();
    live.thrust.stop();
    live.whistle.stop();
    this.radio.stop();
  }

  private setDrillRow(row: number): void {
    const live = this.live;
    if (!live || row === this.drillRow) return;
    const before = this.drillRow < 0 ? null : drillBand(this.drillRow);
    this.drillRow = row;
    const band = drillBand(row);
    if (band !== before) live.graph.drill.frequency.setTargetAtTime(band.lowpassHz, live.ctx.currentTime, 0.05);
  }

  private updatePodLoops(live: Live, pod: PodAudioState, t: number): void {
    const s = clamp01(pod.thrust);
    const tierRate = 1 + 0.04 * (pod.engineTier - 1);
    live.thrust.set(s * THRUST_GAIN, tierRate * (0.9 + 0.2 * s), t);
    const fall = clamp01((-pod.vy - HARD_LANDING_V) / (FALL_CAP_V - HARD_LANDING_V));
    live.whistle.set(fall > 0 ? WHISTLE_GAIN * fall ** 0.7 : 0, 0.8 + 0.6 * fall, t);
  }

  /** A rising tick at each quarter of the arming ring (03 §11.4 ★20 "arming tick"). */
  private updateArming(live: Live, progress: number, t: number): void {
    if (progress < 0) {
      this.armTick = -1;
      return;
    }
    const q = Math.floor(progress * ARM_TICKS + 1e-6);
    if (q <= this.armTick) return;
    this.armTick = q;
    if (q > 0) this.start(live, 'uiTap', semitones(2 * q - 6), q === ARM_TICKS ? 1 : 0.7, t);
  }

  private updateMix(live: Live, pod: PodAudioState, nowMs: number, t: number): void {
    this.ducks.held = pod.ducked;
    kettleMix(pod.depth, this.musicMix);
    const musicGain = this.musicOn ? this.musicMix.gain * dbToGain(this.ducks.musicDb(nowMs)) : 0;
    live.music.setMix(musicGain, Math.min(this.musicMix.cutoffHz, this.ducks.musicCutoffHz()), t);
    ambienceMix(pod.depth, this.ambMix);
    live.ambience.setMix(this.ambMix, dbToGain(this.ducks.ambienceDb(nowMs)), t);
  }
}

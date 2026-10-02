// StoryDirector (01 §7.4, §8; canon §3.9, §2.12): turns the World's events and pod snapshot into radio beats,
// milestones, Co-op Plans rungs and map pings. Each beat and milestone fires once; everything it decides is
// written to World.story.flags through the ledger, so a save carries it. Hosted by World, which calls
// onEvents after every step (and before every drain) with the events not yet seen. M0 has no story (01 §2.8).
// PURE MODULE.
import { MINE_W, MVP_SEAL_ROW, SURVEY_PING_ROW, type Line } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import { scopeAtLeast } from '../shared/scope';
import { StoryLedger, obFlag, pingFlag } from './ledger';
import { FEATHERFALL_ROWS, HEAVY_HAULER_LOAD, milestone, type MilestoneId } from './milestones';
import { rungFlag } from './plans';
import { IRIDIUM_PING_ROW, TALL_LIFT_ROWS, recorderLog, renderBeat, toLinks, type BeatId } from './script';
import type { Emit, StoryContext, StorySnapshot } from './types';

type Flags = Record<string, boolean>;

/** Incentive row → its beat and milestone (canon §3.8). */
const INCENTIVE_BEATS: Readonly<Record<number, readonly [BeatId, MilestoneId]>> = {
  40: ['S2', 'fiveHundredClub'],
  80: ['S3', 'grand'],
  280: ['S4', 'bigIncentive'],
};

/** Factory build kinds the goal chip tracks (02 §2.6 onboarding builds), matched loosely on the ghost kind. */
const BUILD_FACTS: readonly [RegExp, string][] = [
  [/drill/i, 'drill'],
  [/lift/i, 'lift'],
  [/belt/i, 'belt'],
  [/smelter/i, 'smelter'],
  [/assembler/i, 'assembler'],
];

/** Plated polls the Stockpile this often (steps): a part count may walk every Bin. */
const PLATED_POLL_STEPS = 30;
/** Hardrock cells remembered for Pop Goes the Shale. */
const HARDROCK_MEMORY = 4;

export class StoryDirector {
  private readonly active: boolean;
  private ledger: StoryLedger | null = null;
  private ledgerFlags: Flags | null = null;
  /** Highest row of the current airborne stretch, or −1 while grounded (Featherfall). Session-only. */
  private apexRow = -1;
  /** Hardrock cells the drill was refused on (x + r·MINE_W), newest last. Session-only. */
  private readonly hardrock = new Int32Array(HARDROCK_MEMORY).fill(-1);
  private hardrockNext = 0;

  constructor(private readonly ctx: StoryContext) {
    this.active = scopeAtLeast(ctx.scope, 'mvp');
  }

  /** A brand-new claim (never a restored one): the game-start card (canon §2.12 exception) and rung U0. */
  start(flags: Flags, emit: Emit): void {
    if (!this.active) return;
    const L = this.ledgerFor(flags);
    L.set(rungFlag('U0'));
    this.fire(L, 'S0', emit);
  }

  /** Events emitted since the last call (`events[from…]`) plus the post-step snapshot. */
  onEvents(events: readonly GameEvent[], snap: StorySnapshot, flags: Flags, emit: Emit, from = 0): void {
    if (!this.active) return;
    const L = this.ledgerFor(flags);
    const n = events.length; // the director's own emits land after n and are not re-read
    for (let i = from; i < n; i++) this.onEvent(events[i], events, from, n, snap, L, emit);
    this.onStep(snap, L, emit);
  }

  /** Recorders just sold at the Assay: one Deepreach log each, in order of sale (01 §7.5). */
  recordersSold(count: number, flags: Flags, emit: Emit): void {
    if (!this.active) return;
    const L = this.ledgerFor(flags);
    for (let k = 0; k < count; k++) {
      const id = recorderLog(L.logsHeard() + 1);
      if (!id) return;
      this.fire(L, id, emit);
    }
  }

  /** A lift was completed (factory hook): the first one taller than 100 rows wakes the count (S8). */
  liftBuilt(rows: number, flags: Flags, emit: Emit): void {
    if (!this.active || rows <= TALL_LIFT_ROWS) return;
    this.fire(this.ledgerFor(flags), 'S8', emit, Math.round(rows));
  }

  // ------------------------------------------------------------------ internals

  private ledgerFor(flags: Flags): StoryLedger {
    if (flags !== this.ledgerFlags || !this.ledger) {
      this.ledger = new StoryLedger(flags);
      this.ledgerFlags = flags;
    }
    return this.ledger;
  }

  private fire(L: StoryLedger, id: BeatId, emit: Emit, value = 0): void {
    if (!L.recordBeat(id, value)) return;
    let zero = false;
    for (const part of renderBeat(id, value)) {
      emit({ t: 'radio', beat: id, sender: part.sender, cards: part.cards.slice() });
      if (part.sender === 'Channel Zero') zero = true;
    }
    if (zero) this.earn(L, 'wrongNumber', emit);
  }

  private earn(L: StoryLedger, id: MilestoneId, emit: Emit): void {
    if (L.recordMilestone(id)) emit({ t: 'milestone', id, title: milestone(id).title });
  }

  private ping(L: StoryLedger, lodeId: number, emit: Emit): void {
    if (lodeId >= 0 && L.set(pingFlag(lodeId))) emit({ t: 'lode-pinged', lodeId });
  }

  private onEvent(e: GameEvent, batch: readonly GameEvent[], from: number, n: number, snap: StorySnapshot, L: StoryLedger, emit: Emit): void {
    switch (e.t) {
      case 'incentive': {
        const pair = INCENTIVE_BEATS[e.row];
        if (!pair) return;
        this.fire(L, pair[0], emit);
        this.earn(L, pair[1], emit);
        return;
      }
      case 'lode-discovered':
        L.set(rungFlag('U2'));
        if (e.lodeId === this.ctx.scriptedLodeId) {
          this.fire(L, 'S5', emit);
          this.earn(L, 'oldPing', emit);
        }
        return;
      case 'dig-refused':
        this.onRefusal(e, snap, L, emit);
        return;
      case 'explosion':
        if (this.blastedHardrock(e, batch, from, n)) this.earn(L, 'popGoesTheShale', emit);
        return;
      case 'landed':
        if (this.featherLanding(snap, batch, from, n)) this.earn(L, 'featherfall', emit);
        this.apexRow = -1;
        return;
      case 'teleport':
      case 'respawned':
        this.apexRow = -1;
        return;
      case 'damage':
        // The second Magma hit leaves nothing pending; surviving it is Hot Feet (canon §3.3).
        if (e.cause === 'magma' && snap.magmaPending === 0 && snap.alive) this.earn(L, 'hotFeet', emit);
        return;
      case 'trip-end':
        if (this.ctx.loadFrac() >= HEAVY_HAULER_LOAD) this.earn(L, 'heavyHauler', emit);
        return;
      case 'sale':
      case 'export-sale':
        this.earn(L, 'payday', emit);
        return;
      case 'coop-credit':
        this.earn(L, 'toppedOff', emit);
        return;
      case 'purchase':
        if (e.kind === 'fuel') this.earn(L, 'toppedOff', emit);
        else if (e.kind === 'upgrade') this.onUpgrade(e.line, e.tier, L, emit);
        return;
      case 'first-lift-delivery':
        this.fire(L, 'S6', emit);
        this.earn(L, 'handsOff', emit);
        return;
      case 'first-ingot':
        L.set(rungFlag('U3'));
        L.set(obFlag('ingot'));
        return;
      case 'unlock':
        L.set(rungFlag(e.rung));
        return;
      case 'starter-kit':
        L.set(obFlag('kit'));
        return;
      case 'ghost-complete':
        for (const [re, fact] of BUILD_FACTS) if (re.test(e.kind)) L.set(obFlag(fact));
        return;
      default:
        return;
    }
  }

  private onUpgrade(line: Line | undefined, tier: number | undefined, L: StoryLedger, emit: Emit): void {
    if (tier === undefined || tier < 2) return;
    this.earn(L, 'basketCase', emit);
    if (line && this.ctx.billHasPart(line, tier, 'hullPlate')) this.earn(L, 'plated', emit);
  }

  /** Hardrock's first tell is the first refusal (canon §2.12 #4); the MVP Seal answers a push into r320. */
  private onRefusal(e: Extract<GameEvent, { t: 'dig-refused' }>, snap: StorySnapshot, L: StoryLedger, emit: Emit): void {
    if (e.reason === 'hardrock') {
      this.hardrock[this.hardrockNext] = e.x + e.r * MINE_W;
      this.hardrockNext = (this.hardrockNext + 1) % HARDROCK_MEMORY;
      this.earn(L, 'clink', emit);
      this.fire(L, 'S7', emit, toLinks(snap.depthFt));
    } else if ((e.reason === 'floor' || e.reason === 'seal') && e.r >= MVP_SEAL_ROW) {
      this.sealReached(L, emit);
    }
  }

  private sealReached(L: StoryLedger, emit: Emit): void {
    if (this.ctx.scope === 'mvp') this.fire(L, 'S11', emit);
  }

  /** A Pop Charge or Mega Pop whose square covered a Hardrock cell the drill was refused on. */
  private blastedHardrock(e: Extract<GameEvent, { t: 'explosion' }>, batch: readonly GameEvent[], from: number, n: number): boolean {
    let charge = false;
    for (let i = from; i < n; i++) {
      const b = batch[i];
      if (b.t === 'consumable-used' && (b.id === 'pop' || b.id === 'megaPop')) charge = true;
    }
    if (!charge) return false;
    for (let k = 0; k < HARDROCK_MEMORY; k++) {
      const cell = this.hardrock[k];
      if (cell < 0) continue;
      const x = cell % MINE_W;
      const r = (cell - x) / MINE_W;
      if (Math.abs(x - e.x) <= e.radius && Math.abs(r - e.r) <= e.radius) {
        this.hardrock.fill(-1);
        return true;
      }
    }
    return false;
  }

  /** A landing after ≥ 30 rows of fall with no landing damage in the same step (01 §8 Featherfall). */
  private featherLanding(snap: StorySnapshot, batch: readonly GameEvent[], from: number, n: number): boolean {
    if (this.apexRow < 0 || snap.row - this.apexRow < FEATHERFALL_ROWS || !snap.alive) return false;
    for (let i = from; i < n; i++) {
      const b = batch[i];
      if (b.t === 'damage' && b.cause === 'landing') return false;
    }
    return true;
  }

  /** Per-step checks after the events: depth beats, the airborne apex, the Stockpile poll. */
  private onStep(snap: StorySnapshot, L: StoryLedger, emit: Emit): void {
    if (!snap.grounded) this.apexRow = this.apexRow < 0 ? snap.row : Math.min(this.apexRow, snap.row);
    if (snap.row >= SURVEY_PING_ROW && !L.hasBeat('S1')) {
      L.set(rungFlag('U1'));
      this.fire(L, 'S1', emit);
      this.ping(L, this.ctx.scriptedLodeId, emit);
    }
    if (snap.row >= IRIDIUM_PING_ROW && !L.hasBeat('S9')) {
      this.fire(L, 'S9', emit);
      this.ping(L, this.ctx.iridiumLodeId, emit);
    }
    // Standing on the temporary Seal without pushing into it also counts as reaching it.
    if (snap.row >= MVP_SEAL_ROW - 1 && snap.grounded && !L.hasBeat('S11')) this.sealReached(L, emit);
    if (snap.stepNo % PLATED_POLL_STEPS === 0 && !L.hasMilestone('plated') && this.ctx.partCount('hullPlate') > 0) this.earn(L, 'plated', emit);
  }
}

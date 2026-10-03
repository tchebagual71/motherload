// Economy bot factory brain (04 §11.2: "at the scripted lode it builds drill → lift → Headframe → Smelter → Bin →
// Export"; 01 §2.5–2.6 beats 5–7). Underground jobs go through ghosts the pod completes by proximity (02 §2.6);
// Yard work goes through the crane commands a player's build mode reaches, following a plan made up front
// (./layout.ts) so no later belt is boxed in.
//
// Plan, in order of need:
//   onboarding  find the scripted lode, claim the Starter Kit, drill + lift up Dot's shaft, belt Headframe → Smelter;
//   wire        the survey Bin makes way for an Assembler on Wire; Wire → overflow Router → Wire Bin, surplus → Export;
//   workshop    Yard Expansion I; Assay-Stockpiled specimens → intake Bin → lossy Smelter → sorting Routers →
//               iron / cobalt / gold Bins → Hull Plate, Gear → Motor and Circuit Assemblers → parts Bin.
// The intake Bin must be the lowest-id Bin: the Stockpile (Assay toggle, refunds) fills Bins lowest id first.
import { DIR, type EntityView, type FactoryApi, type Res } from '../../src/factory/api';
import { RIM_BUILDINGS, STEP_HZ, type Line } from '../../src/shared/canon';
import { partsFor, type PartId } from '../../src/economy';
import { planYard, type Key, type PlanMachine, type YardPlan } from './layout';
import type { Bot, Co } from './bot';
import type { Cell } from './nav';
import { UPGRADE_ORDER } from './profiles';

const W = 48;

export interface UndergroundJob {
  name: string;
  /** Cells to excavate (top rows first). */
  dig: Cell[];
  /** Where to stand (open, on a floor) while ghosts build. */
  stand: Cell | null;
  /** Build mode: place the ghosts; returns the number of commands (build time). */
  place?: () => number;
  /** The ghosts the pod must wait for are done. */
  built?: () => boolean;
  /** Extra moves after the wait (e.g. climb the lift shaft so the rail builds). */
  after?: () => Co;
  /** The job cannot be done from here (no route): back off for a while. */
  onFail?: () => void;
}

export class YardBrain {
  /** Entity ids of the bot's Yard pieces. */
  readonly ids: Partial<Record<Key, number>> = {};
  /** Stage reached: 0 onboarding, 1 wire chain built, 2 workshop (Hull Plate), 3 full workshop. */
  stage = 0;
  private hx = -1;
  /** Workshop side: +1 east of the survey set, −1 west. */
  private side: 1 | -1 = 1;
  private failures = 0;
  private lastJobFail = 0;
  readonly notes: string[] = [];

  constructor(
    readonly bot: Bot,
    readonly enabled: boolean,
  ) {}

  private get f(): FactoryApi {
    return this.bot.w.factory!;
  }

  private note(s: string): void {
    this.notes.push(`${this.bot.clock()} ${s}`);
    this.bot.log(`${this.bot.clock()} yard: ${s}`);
  }

  // ---------------------------------------------------------------- underground jobs

  /** The next underground job this trip should do first, or null. */
  job(): UndergroundJob | null {
    if (!this.enabled || !this.bot.w.factory) return null;
    const w = this.bot.w;
    const f = this.f;
    const lode = w.terrain.lodes[w.meta.scriptedLodeId];
    if (!lode) return null;
    if (this.bot.m.steps - this.lastJobFail < 120 * STEP_HZ) return null;
    // J1 (beat 5): after Dot's ping, go and find the lode beside her shaft (Tin Ear: an adjacent cell).
    if (!lode.discovered && f.isUnlocked('U1')) {
      const c = w.meta.surveyColumn;
      return this.track({ name: 'find the scripted lode', dig: [], stand: { x: c, r: lode.top - 1 } });
    }
    // J2 (beat 6): drill + lift on the scripted lode from the Starter Kit.
    const hasDrill = f.entities().some((e) => e.kind === 'autoDrill' && e.y + e.h === lode.top);
    const footBuilt = f.entities().some((e) => e.kind === 'lift' && e.x === w.meta.surveyColumn);
    const kits = [...(hasDrill ? [] : ['autoDrill']), ...(footBuilt ? [] : ['liftFoot', 'liftRail'])];
    if (lode.discovered && kits.length > 0 && this.kitsAboard(kits)) return this.track(this.onboardingJob());
    return null;
  }

  private track(job: UndergroundJob): UndergroundJob {
    job.onFail = () => {
      this.lastJobFail = this.bot.m.steps;
      this.note(`job '${job.name}' failed; retry later`);
    };
    return job;
  }

  private kitsAboard(ids: readonly string[]): boolean {
    const cargo = this.bot.pod.cargo;
    return ids.every((id) => cargo.some((c) => c.kind === 'kit' && c.id === id));
  }

  private onboardingJob(): UndergroundJob {
    const f = this.f;
    const plan = f.surveyPlan();
    const d = plan.drill;
    const lift = plan.lift;
    const dig: Cell[] = [
      { x: d.x, r: d.y },
      { x: d.x + 1, r: d.y },
      { x: d.x, r: d.y + 1 },
      { x: d.x + 1, r: d.y + 1 },
    ];
    const bot = this.bot;
    return {
      name: 'drill + lift on the scripted lode',
      dig,
      stand: { x: lift.x, r: lift.foot },
      place: () => {
        let n = 0;
        const g = f.ghosts();
        if (!g.some((k) => k.kind === 'autoDrill') && !f.entities().some((e) => e.kind === 'autoDrill' && e.x === d.x && e.y === d.y)) {
          const r = f.placeGhost({ kind: 'autoDrill', x: d.x, y: d.y });
          if (!r.ok) this.note(`drill ghost refused: ${r.code}`);
          n++;
        }
        if (!g.some((k) => k.kind === 'lift') && !f.entities().some((e) => e.kind === 'lift' && e.x === lift.x)) {
          const r = f.placeGhost({ kind: 'lift', ...lift });
          if (!r.ok) this.note(`lift ghost refused: ${r.code}`);
          n++;
        }
        return n;
      },
      built: () => !f.ghosts().some((k) => k.kind === 'autoDrill' || (k.kind === 'lift' && k.part === 'foot')),
      after: function* () {
        // Up Dot's shaft at a gentle climb, so the Lift Rail job (rows near the top) completes on the way.
        yield* bot.climbColumn(lift.x, 3.5);
      },
    };
  }

  // ---------------------------------------------------------------- Rim services

  /** Onboarding Kits still to carry down: the Starter Kit's, re-bought if a salvage lost them (01 §6.1). */
  private onboardingKits(): string[] {
    if (!this.enabled || !this.bot.w.factory) return [];
    const w = this.bot.w;
    const f = this.f;
    const lode = w.terrain.lodes[w.meta.scriptedLodeId];
    if (!lode?.discovered || w.starterKitReady()) return [];
    const drill = f.entities().some((e) => e.kind === 'autoDrill');
    const lift = f.entities().some((e) => e.kind === 'lift' && e.x === w.meta.surveyColumn);
    const rails = f.ghosts().filter((g) => g.kind === 'lift' && g.part === 'rail').length;
    const need: string[] = [];
    if (!drill) need.push('autoDrill');
    if (!lift) need.push('liftFoot', 'liftRail');
    else if (rails > 0) need.push('liftRail');
    const cargo = this.bot.pod.cargo;
    return need.filter((id) => !cargo.some((c) => c.kind === 'kit' && c.id === id));
  }

  wantsShed(): boolean {
    if (!this.enabled || !this.bot.w.factory) return false;
    if (this.bot.w.starterKitReady()) return this.freeSlots() >= 5;
    const need = this.onboardingKits();
    return need.length > 0 && this.freeSlots() >= need.length && this.bot.w.wallet.cash >= this.kitCost(need) + this.bot.reserveCash();
  }

  private kitCost(ids: readonly string[]): number {
    const shop = this.bot.w.kitShop();
    return ids.reduce((s, id) => s + (shop.find((k) => k.id === id)?.price ?? 0), 0);
  }

  shedWork(): void {
    const w = this.bot.w;
    if (w.starterKitReady()) {
      const r = w.claimStarterKit();
      if (r.ok) this.note('Starter Kit claimed');
      return;
    }
    for (const id of this.onboardingKits()) {
      const r = w.buyKit(id, 1, 'cargo');
      if (r.ok) this.note(`bought a ${id} Kit`);
    }
  }

  private freeSlots(): number {
    const s = this.bot.w.stats();
    return s.baySlots - s.slotsUsed;
  }

  /** Specimens the lossy path wants Stockpiled (by mineral tier) instead of sold. */
  stockpileWant(): Record<number, number> {
    const want: Record<number, number> = { 1: 0, 3: 0, 4: 0 };
    if (this.stage < 2) return want;
    const need = this.ingotNeed();
    const f = this.f;
    const queued = (tier: number): number => f.stockpileCount(`spec${tier}`) * 2;
    want[1] = Math.max(0, Math.ceil((need.iron - f.stockpileCount('ironIngot') - queued(1)) / 2));
    want[3] = Math.max(0, Math.ceil((need.cobalt - f.stockpileCount('cobaltIngot') - queued(3)) / 2));
    want[4] = this.stage >= 3 ? Math.max(0, Math.ceil((need.gold - f.stockpileCount('goldIngot') - queued(4)) / 2)) : 0;
    return want;
  }

  wantsStockpile(): boolean {
    const want = this.stockpileWant();
    return this.bot.pod.cargo.some((c) => c.kind === 'mineral' && (want[c.tier] ?? 0) > 0);
  }

  /** At the Assay: put wanted specimens in the Stockpile (canon §4.9 toggle), the rest is sold. */
  stockpileAtAssay(): void {
    const want = this.stockpileWant();
    for (const tier of [1, 3, 4]) {
      const n = Math.min(want[tier], this.bot.pod.cargo.filter((c) => c.kind === 'mineral' && c.tier === tier).length);
      if (n <= 0) continue;
      const r = this.bot.w.stockpileCargo({ kind: 'mineral', tier }, n);
      if (r.ok) this.bot.m.stockpiled[tier] += r.amount ?? 0;
    }
  }

  /** Cash set aside for the next Yard project (so upgrades don't starve it). */
  cashWanted(): number {
    if (!this.enabled || !this.bot.w.factory) return 0;
    const f = this.f;
    if (this.stage === 0 && f.isUnlocked('U3')) return 1_700;
    if (this.stage === 1 && this.partsDemand().hullPlate > 0) return f.yardRows < 16 ? 2_500 + 2_600 : 2_600;
    if (this.stage === 2 && this.partsDemand().motor + this.partsDemand().circuit > 0) return 3_400;
    return 0;
  }

  // ---------------------------------------------------------------- demand

  /** Parts the next few upgrades in the order want, minus what the Stockpile holds. */
  partsDemand(): Record<PartId, number> {
    const f = this.f;
    const want = { wire: 0, hullPlate: 0, motor: 0, coolantCoil: 0, circuit: 0 } as Record<PartId, number>;
    let k = 0;
    for (const [line, tier] of UPGRADE_ORDER) {
      if (this.bot.pod.tiers[line as Line] >= tier) continue;
      for (const r of partsFor(this.bot.w.scope, line, tier)) want[r.part] = (want[r.part] ?? 0) + r.n;
      if (++k >= 4) break;
    }
    const out = {} as Record<PartId, number>;
    for (const p of Object.keys(want) as PartId[]) out[p] = Math.max(0, want[p] - f.stockpileCount(p));
    return out;
  }

  /** Ingots the part demand implies (Hull Plates include the ones Motors take). */
  private ingotNeed(): { iron: number; cobalt: number; gold: number } {
    const d = this.partsDemand();
    const hp = d.hullPlate + (this.stage >= 3 ? d.motor : 0);
    const gears = this.stage >= 3 ? Math.max(0, 2 * d.motor - this.f.stockpileCount('gear')) : 0;
    return {
      iron: 2 * hp + Math.ceil(gears / 2) + 4,
      cobalt: hp + 2,
      gold: this.stage >= 3 ? d.circuit + 1 : 0,
    };
  }

  // ---------------------------------------------------------------- Yard work (build mode on the Rim)

  *rimWork(): Co {
    if (!this.enabled || !this.bot.w.factory || !this.bot.w.onRim()) return;
    const f = this.f;
    const w = this.bot.w;
    const hf = f.entities().find((e) => e.kind === 'headframe' && e.plane === 'yard');
    if (!hf) return;
    this.hx = hf.x;
    // Beat 6: the lift is up: belt the Headframe into the Smelter ($5). The ingots wait in its output buffer.
    const liftUp = f.entities().some((e) => e.kind === 'lift' && e.y === 0);
    if (liftUp && !f.beltWords('yard')[3 * W + this.hx]) {
      yield* this.bot.buildPause(1);
      this.must(f.paintBelts([{ x: this.hx, y: 3 }], 1, DIR.S), 'Headframe → Smelter');
    }
    const spare = (): number => w.wallet.cash - this.bot.reserveCash();
    if (this.stage === 0 && f.isUnlocked('U3') && spare() >= 1_700) yield* this.buildWire();
    if (this.stage === 1 && this.partsDemand().hullPlate > 0) {
      if (f.yardRows < 16 && spare() >= 2_500 + 2_600) {
        const r = w.expandYard();
        if (r.ok) this.note('Yard Expansion I');
      }
      if (f.yardRows >= 16 && spare() >= 2_600) yield* this.buildWorkshop();
    }
    if (this.stage === 2 && spare() >= 3_400) {
      const d = this.partsDemand();
      if (d.motor + d.circuit > 0) yield* this.buildAssembly();
    }
    if (this.stage >= 2) this.control();
  }

  private must(r: Res<object>, what: string): boolean {
    if (!r.ok) {
      this.failures++;
      this.note(`${what} refused: ${JSON.stringify(r)}`);
      return false;
    }
    return true;
  }

  private ent(key: Key): EntityView | null {
    const id = this.ids[key];
    return id ? this.f.entity(id) : null;
  }

  private plan: YardPlan | null = null;

  /** Place one planned machine (with its recipe). */
  private placePlanned(m: PlanMachine): boolean {
    const f = this.f;
    const r = f.place(m.kind, 1, m.x, m.y, m.dir);
    if (!this.must(r, `place ${m.key}`) || !r.ok) return false;
    this.ids[m.key] = r.id;
    if (m.recipe) this.setRecipe(m.key);
    return true;
  }

  /** Recipes A5 and A6 unlock on possession (02 §0.2 F1): retried each visit until they take. */
  private setRecipe(key: Key): void {
    const m = this.plan?.machines.get(key);
    const e = this.ent(key);
    if (!m?.recipe || !e || e.recipe === m.recipe) return;
    const r = this.f.setRecipe(e.id, m.recipe);
    if (r.ok) this.pendingRecipes.delete(key);
    else this.pendingRecipes.add(key);
  }
  private readonly pendingRecipes = new Set<Key>();

  /** Paint the planned belts of `stage` and set Router modes (the first route out of a Router is its primary). */
  private paintStage(stage: number): boolean {
    const f = this.f;
    const plan = this.plan!;
    for (const r of plan.routes) {
      if (r.stage !== stage) continue;
      if (!this.must(f.paintBelts(r.path, 1, r.end), `belt ${r.from} → ${r.to}`)) return false;
    }
    const primary = (from: Key): number | undefined => plan.routes.find((r) => r.from === from)?.first;
    const mode = (key: Key, m: 'overflow' | 'filter' | 'even', filter?: string): void => {
      const e = this.ent(key);
      const p = primary(key);
      if (e && p !== undefined) this.must(f.setRouterMode(e.id, m, { primary: p as 0 | 1 | 2 | 3, filter }), `${key} mode`);
    };
    if (stage === 1) mode('RW', 'overflow');
    if (stage === 2) {
      mode('R1', 'filter', 'ironIngot');
      mode('R2', 'filter', 'cobaltIngot');
    }
    return true;
  }

  /**
   * Stage 1, Wire (01 §2.6 "Build an Assembler: Wire"): the survey Bin (empty: the Smelter's ingots wait in its
   * buffer) gives way to an Assembler on A2 fed straight from the Smelter; Wire → overflow Router → Wire Bin, the
   * surplus to an Export Terminal. The intake Bin goes down first so it is the lowest-id Bin.
   */
  private *buildWire(): Co {
    const f = this.f;
    const hx = this.hx;
    this.side = hx <= 23 ? 1 : -1;
    this.plan = planYard(f, hx, this.side, this.bot.rng);
    if (!this.plan) return this.giveUp('no workshop layout fits');
    const m = this.plan.machines;
    const bin = f.entities().find((e) => e.kind === 'bin' && e.rusted);
    if (bin) {
      yield* this.bot.buildPause(1);
      if (!this.must(f.deconstruct(bin.id), 'remove the survey Bin')) return this.giveUp('survey Bin');
    }
    yield* this.bot.buildPause(8);
    for (const key of ['A2', 'BI', 'RW', 'BW', 'EX'] as const) if (!this.placePlanned(m.get(key)!)) return this.giveUp(key);
    const a2 = m.get('A2')!;
    this.must(f.paintBelts([{ x: hx, y: 6 }], 1, DIR.S), 'Smelter → Wire Assembler');
    const portX = this.side > 0 ? hx + 2 : hx - 1;
    this.must(f.paintBelts([{ x: portX, y: 7 }], 1, a2.dir), 'Wire Assembler → Router');
    if (!this.paintStage(1)) return this.giveUp('wire belts');
    this.stage = 1;
    this.note('Wire chain and Export built');
  }

  /** Stage 2, the lossy path for Hull Plates (01 §2.6 beat 6): intake → Smelter → sorters → ingot Bins → A3. */
  private *buildWorkshop(): Co {
    const f = this.f;
    if (!this.plan) return this.giveUp('no plan');
    yield* this.bot.buildPause(12);
    for (const k of ['SL', 'R1', 'R2', 'BFe', 'BCo', 'BAu', 'A3', 'BP'] as const) if (!this.placePlanned(this.plan.machines.get(k)!)) return this.giveUp(k);
    if (!this.paintStage(2)) return this.giveUp('workshop belts');
    this.must(f.setUnloadFilter(this.ids.BFe!, 'ironIngot'), 'iron unload');
    this.must(f.setUnloadFilter(this.ids.BCo!, 'cobaltIngot'), 'cobalt unload');
    this.stage = 2;
    this.note(`workshop built (${f.entities().filter((e) => e.plane === 'yard').length} Yard buildings)`);
  }

  /**
   * Stage 3: Gear → Motor and Circuit Assemblers fed from the ingot Bins, Wire and Hull Plates. (No Coolant Coil:
   * the Radiator only answers Magma, which this bot routes around.)
   */
  private *buildAssembly(): Co {
    if (!this.plan) return this.giveUp('no plan');
    yield* this.bot.buildPause(10);
    for (const k of ['A1', 'A6', 'A5'] as const) if (!this.placePlanned(this.plan.machines.get(k)!)) return this.giveUp(k);
    if (!this.paintStage(3)) return this.giveUp('assembly belts');
    this.stage = 3;
    this.note(`assembly built (${this.f.entities().filter((e) => e.plane === 'yard').length} Yard buildings)`);
  }

  private giveUp(what: string): void {
    this.note(`gave up on the workshop at ${what}`);
    this.stage = 9;
  }

  /**
   * Production control at each Rim visit (a player's taps on unload filters): the intake Bin unloads the specimen
   * the part demand needs most; Gear, Motor and the Wire feeds run only while their parts are wanted.
   */
  private control(): void {
    const f = this.f;
    for (const k of [...this.pendingRecipes]) this.setRecipe(k);
    const bi = this.ent('BI');
    if (bi) {
      const need = this.ingotNeed();
      const have = { 1: f.stockpileCount('spec1'), 3: f.stockpileCount('spec3'), 4: f.stockpileCount('spec4') };
      const gap = (ingot: string, n: number): number => n - f.stockpileCount(ingot);
      const order: [number, number][] = [
        [1, gap('ironIngot', need.iron)],
        [3, gap('cobaltIngot', need.cobalt)],
        [4, gap('goldIngot', need.gold)],
      ];
      order.sort((a, b) => b[1] - a[1]);
      const pick = order.find(([t]) => have[t as 1 | 3 | 4] > 0);
      const want = pick ? `spec${pick[0]}` : null;
      const cur = f.inspect(bi.id)?.filter ?? null;
      if (want !== cur) f.setUnloadFilter(bi.id, want);
    }
    if (this.stage >= 3) {
      const d = this.partsDemand();
      const set = (key: Key, itemId: string, on: boolean): void => {
        const e = this.ent(key);
        if (!e) return;
        const cur = f.inspect(e.id)?.filter ?? null;
        const want = on ? itemId : null;
        if (cur !== want) f.setUnloadFilter(e.id, want);
      };
      set('BP', 'hullPlate', d.motor > 0 && f.stockpileCount('hullPlate') > d.hullPlate);
      set('BW', 'wire', d.motor + d.circuit > 0 && f.stockpileCount('wire') > d.wire + 4);
      set('BAu', 'goldIngot', d.circuit > 0);
    }
  }

  /**
   * Once a minute: ingots out of the lode Smelter (the survey Smelter, fed only by the lift) and out of the lossy
   * Smelter (Stockpiled specimens), from the belts' items-per-minute over the last 60 s.
   */
  sampleFlows(): void {
    const f = this.bot.w.factory;
    if (!f || this.hx < 0) return;
    const m = this.bot.m;
    m.lodeIngots += f.beltFlowAt('yard', this.hx, 6);
    const sl = this.plan?.routes.find((r) => r.from === 'SL');
    if (sl && this.ids.SL) m.specimenIngots += f.beltFlowAt('yard', sl.path[0].x, sl.path[0].y);
  }

  /** ASCII Yard map for debugging (rows 1..yardRows). */
  dump(): string {
    const f = this.f;
    const build = f.yardBuildings();
    const belts = f.beltWords('yard');
    const lines: string[] = [];
    const ch: Record<string, string> = { bin: 'B', smelter: 'S', assembler: 'A', export: 'X', headframe: 'H', router: 'R' };
    const arrows = ['>', 'v', '<', '^'];
    for (let y = 1; y <= f.yardRows; y++) {
      let s = `${String(y).padStart(2)} `;
      for (let x = 0; x < W; x++) {
        const b = build[y * W + x];
        const wd = belts[y * W + x];
        if (b) s += ch[f.entity(b)?.kind ?? ''] ?? '?';
        else if (wd & 0x8000) s += arrows[(wd >> 10) & 3];
        else s += y <= 3 && RIM_BUILDINGS.some((k) => x >= k.x0 && x <= k.x1) ? '#' : '.';
      }
      lines.push(s);
    }
    return lines.join('\n');
  }
}

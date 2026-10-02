// Fake WorldApi + AppController for the UI dev harness (ui-harness.html) — lets the UI and input be
// exercised without the real simulation. Not used by the game. Economy numbers follow canon §2.6–2.7, §3.8
// closely enough to look right; physics is a toy.
import { signal } from '@preact/signals';
import type { AppController, AppState, DeathInfo, GoalChip, Overlay, RadioMessage, Settings, SheetId, Toast, TripSummary } from '../app/types';
import type { PodIntent, PodState } from '../pod/types';
import {
  BAY,
  CONSUMABLE_CAP,
  CONSUMABLES,
  DEFAULT_QUICK_SLOTS,
  DRILL,
  ENGINE,
  EXPORT_PREFIX,
  FUEL_PRICE_PER_L,
  HULL,
  JERRYCAN_LITERS,
  LINES,
  MINERALS,
  PATCH_KIT_HP,
  POD_H,
  RADIATOR,
  RELICS,
  REPAIR_PRICE_PER_HP,
  SCANNER,
  START_CASH,
  START_FUEL,
  START_HULL,
  START_X,
  STEP,
  TANK,
  TIER_PRICE,
  type ConsumableId,
  type Line,
} from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { CargoItem, Look, RimBuildingId, Scope } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';
import type { CargoGroup, PodStats, Quote, Result, ShopItem, StoryState, UpgradeCard, Wallet, WorldApi } from '../world/api';

export type FakePreset = 'start' | 'rich' | 'broke' | 'heavy' | 'lowfuel' | 'deep' | 'debt';

/** Highest tier per line this scope sells (canon §5.5 ledger). */
function scopeMaxTier(scope: Scope, line: Line): number {
  if (scope === 'v1') return 7;
  if (scope === 'mvp') return line === 'scanner' ? 3 : 5;
  return line === 'drill' || line === 'engine' || line === 'tank' || line === 'bay' ? 3 : 1;
}

function tierExists(line: Line, tier: number): boolean {
  if (tier < 1 || tier > 7) return false;
  const table = { drill: DRILL, hull: HULL, engine: ENGINE, tank: TANK, radiator: RADIATOR, bay: BAY, scanner: SCANNER }[line];
  return table[tier - 1] != null;
}

function tierName(line: Line, tier: number): string {
  const table = { drill: DRILL, hull: HULL, engine: ENGINE, tank: TANK, radiator: RADIATOR, bay: BAY, scanner: SCANNER }[line];
  return table[tier - 1]?.name ?? '—';
}

function tierStat(line: Line, tier: number): string {
  const i = tier - 1;
  switch (line) {
    case 'drill':
      return `${(DRILL[i].steps / 60).toFixed(2)} s/tile`;
    case 'hull':
      return `${HULL[i].hp} HP`;
    case 'engine':
      return `lifts ${ENGINE[i].cap} mu`;
    case 'tank':
      return `${TANK[i].liters} L`;
    case 'radiator':
      return `heat ×${RADIATOR[i]?.r ?? 1}`;
    case 'bay':
      return `${BAY[i]?.slots ?? 0} slots`;
    case 'scanner':
      return `lodes r${SCANNER[i]?.lodeRadius ?? 1}`;
  }
}

function itemMass(item: CargoItem): number {
  if (item.kind === 'mineral') return MINERALS[item.tier - 1].mass;
  return 1;
}
function itemValue(item: CargoItem): number {
  if (item.kind === 'mineral') return MINERALS[item.tier - 1].value;
  if (item.kind === 'relic') return RELICS[item.id].value;
  return 0;
}
function itemLabel(item: CargoItem): string {
  if (item.kind === 'mineral') return MINERALS[item.tier - 1].name;
  if (item.kind === 'relic') return RELICS[item.id].name;
  return item.id;
}
function itemKey(item: CargoItem): string {
  return item.kind === 'mineral' ? `m${item.tier}` : item.kind === 'relic' ? `r${item.id}` : `k${item.id}`;
}

function freshPod(): PodState {
  const tiers = Object.fromEntries(LINES.map((l) => [l, 1])) as Record<Line, number>;
  const consumables = Object.fromEntries(CONSUMABLES.map((c) => [c.id, 0])) as Record<ConsumableId, number>;
  return {
    x: START_X + 0.5,
    y: POD_H / 2,
    vx: 0,
    vy: 0,
    prevX: START_X + 0.5,
    prevY: POD_H / 2,
    grounded: true,
    facing: 1,
    fuel: START_FUEL,
    hull: START_HULL,
    tiers,
    cargo: [],
    consumables,
    quickSlots: [...DEFAULT_QUICK_SLOTS],
    dig: null,
    engageSteps: 0,
    engageDir: null,
    sector: 'none',
    cooldown: 0,
    magmaPending: 0,
    thrust: 0,
    digging: false,
    fuelWarn: -1,
    hullWarned: false,
    airSteps: 0,
    destroyed: false,
    row: -1,
  };
}

const ok = (message?: string, amount?: number): Result => ({ ok: true, message, amount });
const fail = (reason: string): Result => ({ ok: false, reason });

export class FakeWorld implements WorldApi {
  readonly seed = 7;
  /** The harness never reads terrain; a real grid would pull sim code into the UI bundle. */
  readonly terrain = null as unknown as TerrainGrid;
  pod: PodState = freshPod();
  wallet: Wallet = { cash: START_CASH, debt: 0, lifetimeEarned: 0 };
  story: StoryState = {
    deepestRow: 0,
    trips: 0,
    tripDeepestRow: 0,
    underground: false,
    incentivesPaid: [],
    flags: {},
    coopCreditReadyStep: 0,
    destructions: 0,
  };
  stepNo = 0;
  private events: GameEvent[] = [];

  constructor(readonly scope: Scope) {}

  reset(): void {
    this.pod = freshPod();
    this.wallet = { cash: START_CASH, debt: 0, lifetimeEarned: 0 };
    this.story = { ...this.story, deepestRow: 0, trips: 0, tripDeepestRow: 0, underground: false, incentivesPaid: [], destructions: 0 };
    this.stepNo = 0;
  }

  applyPreset(p: FakePreset): void {
    const pod = this.pod;
    const ore = (tier: number, n: number) => {
      for (let i = 0; i < n; i++) pod.cargo.push({ kind: 'mineral', tier });
    };
    switch (p) {
      case 'start':
        return;
      case 'rich':
        this.wallet.cash = 1_234_567;
        this.wallet.lifetimeEarned = 2_000_000;
        LINES.forEach((l) => (pod.tiers[l] = Math.min(2, scopeMaxTier(this.scope, l))));
        pod.fuel = this.stats().maxFuel * 0.6;
        pod.hull = this.stats().maxHull * 0.7;
        ore(1, 3);
        ore(2, 2);
        ore(4, 1);
        pod.cargo.push({ kind: 'relic', id: 0 });
        CONSUMABLES.forEach((c, i) => (pod.consumables[c.id] = (i * 3) % 10));
        this.story.trips = 5;
        return;
      case 'broke':
        this.wallet.cash = 3;
        pod.fuel = 1.4;
        this.story.trips = 2;
        return;
      case 'heavy':
        // The 03 §13 HUD overflow case: $99.9M, 7,300ft, 120 cargo, 150 L, TOO HEAVY.
        pod.tiers.bay = 6;
        pod.tiers.tank = 7;
        ore(6, 120);
        this.wallet.cash = 99_900_000;
        pod.fuel = 150;
        this.debugTeleport(584);
        return;
      case 'lowfuel':
        pod.fuel = 0.45;
        this.debugTeleport(40);
        ore(2, 4);
        return;
      case 'deep':
        this.debugTeleport(465);
        this.wallet.cash = 45_678;
        return;
      case 'debt':
        this.wallet.cash = 0;
        this.wallet.debt = 300;
        ore(3, 4);
        return;
    }
  }

  stats(): PodStats {
    const t = this.pod.tiers;
    const cargoMass = this.pod.cargo.reduce((s, c) => s + itemMass(c), 0);
    return {
      maxFuel: TANK[t.tank - 1].liters,
      maxHull: HULL[t.hull - 1].hp,
      engineHp: ENGINE[t.engine - 1].hp,
      hoverCap: ENGINE[t.engine - 1].cap,
      vUp: ENGINE[t.engine - 1].vUp,
      digSteps: DRILL[t.drill - 1].steps,
      radiator: RADIATOR[t.radiator - 1]?.r ?? 1,
      baySlots: BAY[t.bay - 1]?.slots ?? 7,
      cargoMass,
      scannerLodeRadius: SCANNER[t.scanner - 1]?.lodeRadius ?? 1,
    };
  }

  /** Toy physics: stick drives, thrust lifts, gravity pulls; the "mine" is open air down to row 600. */
  step(intent: PodIntent, podRunning: boolean): void {
    this.stepNo++;
    if (!podRunning || this.pod.destroyed) return;
    const p = this.pod;
    p.prevX = p.x;
    p.prevY = p.y;
    const st = intent.thrust ? 1 : Math.max(0, Math.min(1, (intent.sy - 0.35) / 0.65));
    p.vx = p.vx * 0.9 + intent.sx * 0.45;
    p.vy += (st * 22 - 11.5) * STEP;
    if (intent.sy < -0.5 && p.grounded) p.vy = -2;
    p.x = Math.max(0.5, Math.min(47.5, p.x + p.vx * STEP));
    p.y += p.vy * STEP;
    const floor = POD_H / 2;
    p.grounded = p.y <= floor && p.vy <= 0 && p.row < 0;
    if (p.y < -600) p.y = -600;
    if (p.y <= floor && p.row < 0 && p.vy <= 0) {
      p.y = floor;
      p.vy = 0;
      p.grounded = true;
    }
    p.row = Math.floor(-p.y);
    p.thrust = st;
    const burn = 0.00084 * this.stats().engineHp * Math.max(st, Math.abs(intent.sx)) * STEP;
    p.fuel = Math.max(0, p.fuel - burn);
    if (intent.fireSlot >= 0) this.useSlot(intent.fireSlot);
    this.story.deepestRow = Math.max(this.story.deepestRow, p.row);
  }

  private useSlot(slot: number): void {
    const id = this.pod.quickSlots[slot];
    if (!id || this.pod.consumables[id] <= 0) return;
    this.pod.consumables[id]--;
    const s = this.stats();
    if (id === 'jerrycan') this.pod.fuel = Math.min(s.maxFuel, this.pod.fuel + JERRYCAN_LITERS);
    if (id === 'patchKit') this.pod.hull = Math.min(s.maxHull, this.pod.hull + PATCH_KIT_HP);
    this.events.push({ t: 'consumable-used', id });
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
  padUnderPod(): RimBuildingId | null {
    return null;
  }
  sheetClosed(_id: RimBuildingId): void {}

  fuelQuote(liters: number | 'fill'): Quote {
    const room = Math.max(0, this.stats().maxFuel - this.pod.fuel);
    const want = Math.min(liters === 'fill' ? room : liters, room);
    const afford = this.wallet.cash / FUEL_PRICE_PER_L;
    const amount = Math.min(want, afford);
    return { amount: amount < 0.05 ? 0 : amount, cost: Math.ceil(amount * FUEL_PRICE_PER_L), limitedByCash: afford < want };
  }
  buyFuel(liters: number | 'fill'): Result {
    const q = this.fuelQuote(liters);
    if (q.amount <= 0) return fail(this.wallet.cash < 1 ? 'Not enough cash' : 'Tank is full');
    this.pod.fuel += q.amount;
    this.wallet.cash -= q.cost;
    return ok(undefined, q.amount);
  }

  cargoGroups(): CargoGroup[] {
    const map = new Map<string, CargoGroup>();
    for (const item of this.pod.cargo) {
      const k = itemKey(item);
      const g = map.get(k);
      if (g) {
        g.count++;
        g.totalValue += itemValue(item);
        g.mass += itemMass(item);
      } else map.set(k, { item, label: itemLabel(item), count: 1, unitValue: itemValue(item), totalValue: itemValue(item), mass: itemMass(item) });
    }
    return [...map.values()].sort((a, b) => b.totalValue - a.totalValue);
  }
  cargoValue(): number {
    return this.pod.cargo.reduce((s, c) => s + itemValue(c), 0);
  }
  sellAll(): Result {
    const total = this.cargoValue();
    if (this.pod.cargo.length === 0) return fail('Nothing to sell');
    const paid = Math.min(this.wallet.debt, total);
    this.wallet.debt -= paid;
    this.wallet.cash += total - paid;
    this.wallet.lifetimeEarned += total;
    this.pod.cargo = [];
    return ok(`Sold for $${total}`, total);
  }

  repairQuote(): Quote {
    const hp = Math.max(0, this.stats().maxHull - this.pod.hull);
    const afford = Math.floor(this.wallet.cash / REPAIR_PRICE_PER_HP);
    const amount = Math.min(Math.ceil(hp - 1e-6), afford);
    return { amount, cost: amount * REPAIR_PRICE_PER_HP, limitedByCash: afford < Math.ceil(hp - 1e-6) };
  }
  repairAll(): Result {
    const q = this.repairQuote();
    if (q.amount <= 0) return fail('Not enough cash');
    this.pod.hull = Math.min(this.stats().maxHull, this.pod.hull + q.amount);
    this.wallet.cash -= q.cost;
    return ok(undefined, q.amount);
  }

  garageCards(): UpgradeCard[] {
    return LINES.map((line) => {
      const installed = this.pod.tiers[line];
      let next = installed + 1;
      while (next <= 7 && !tierExists(line, next)) next++;
      const exists = next <= 7;
      const inScope = exists && next <= scopeMaxTier(this.scope, line);
      const tier = exists ? next : installed;
      const price = exists ? TIER_PRICE[tier - 1] : 0;
      const affordable = this.wallet.cash >= price;
      let blocker: string | null = null;
      if (!exists) blocker = 'Fully upgraded';
      else if (!affordable) blocker = `Need $${(price - this.wallet.cash).toLocaleString('en-US')} more`;
      return {
        line,
        tier,
        name: tierName(line, tier),
        price,
        installedTier: installed,
        installedName: tierName(line, installed),
        stat: tierStat(line, tier),
        installedStat: tierStat(line, installed),
        available: !exists || inScope,
        affordable,
        parts: [],
        blocker,
      };
    });
  }
  buyUpgrade(line: Line, tier: number): Result {
    const card = this.garageCards().find((c) => c.line === line);
    if (!card || card.tier !== tier || !card.available || card.blocker) return fail(card?.blocker ?? 'Not available');
    this.wallet.cash -= card.price;
    this.pod.tiers[line] = tier;
    if (line === 'hull') this.pod.hull = this.stats().maxHull; // a hull tier repairs free (canon §2.4)
    return ok(`${card.name} installed`);
  }

  shedItems(): ShopItem[] {
    const available = this.scope !== 'm0';
    const effect: Record<ConsumableId, string> = {
      jerrycan: `+${JERRYCAN_LITERS} L fuel`,
      patchKit: `+${PATCH_KIT_HP} HP`,
      pop: 'Clears 3×3 around Pip',
      megaPop: 'Clears 5×5 around Pip',
      hopBeacon: 'Hops you up 6–14 rows… somewhere on the Rim',
      homingBeacon: 'Safe ride to the Pump House',
    };
    return CONSUMABLES.map((c) => ({
      id: c.id,
      name: c.name,
      price: c.price,
      owned: this.pod.consumables[c.id],
      cap: CONSUMABLE_CAP,
      available,
      effect: effect[c.id],
    }));
  }
  buyConsumable(id: ConsumableId, n: number): Result {
    const item = this.shedItems().find((i) => i.id === id);
    if (!item || !item.available) return fail('Not sold here yet');
    const count = Math.min(n, item.cap - item.owned);
    if (count <= 0) return fail(`You carry the most you can (${item.cap})`);
    if (this.wallet.cash < item.price * count) return fail(`Need $${item.price * count - this.wallet.cash} more`);
    this.wallet.cash -= item.price * count;
    this.pod.consumables[id] += count;
    return ok();
  }
  setQuickSlot(slot: number, id: ConsumableId): void {
    this.pod.quickSlots[slot] = id;
  }

  respawn(): { fee: number; debt: number; lost: CargoItem[] } {
    const lost = this.pod.cargo;
    const fee = 25;
    const paid = Math.min(fee, this.wallet.cash);
    this.wallet.cash -= paid;
    this.wallet.debt += fee - paid;
    this.pod = { ...freshPod(), tiers: this.pod.tiers, consumables: this.pod.consumables, quickSlots: this.pod.quickSlots };
    this.pod.fuel = this.stats().maxFuel;
    this.pod.hull = this.stats().maxHull;
    return { fee, debt: fee - paid, lost };
  }

  serialize(): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ cash: this.wallet.cash, tiers: this.pod.tiers, trips: this.story.trips }));
  }

  debugTeleport(row: number): void {
    this.pod.y = -(row + 0.5);
    this.pod.prevY = this.pod.y;
    this.pod.vy = 0;
    this.pod.row = row;
    this.pod.grounded = false;
  }
  debugGiveCash(amount: number): void {
    this.wallet.cash += amount;
  }
  debugSetTier(line: Line, tier: number): void {
    if (tierExists(line, tier)) this.pod.tiers[line] = tier;
  }
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface FakeAppOptions {
  scope: Scope;
  look: Look;
  settings?: Partial<Settings>;
  overlay?: Overlay;
  sheet?: SheetId;
  styleTest?: boolean;
  canInstall?: boolean;
  standalone?: boolean;
}

export interface FakeApp extends AppController {
  readonly world: FakeWorld;
  /** Called by the harness loop each frame with elapsed ms. */
  tick(dtMs: number): void;
}

const TOAST_MS = 2600;

export function createFakeApp(opts: FakeAppOptions): FakeApp {
  const world = new FakeWorld(opts.scope);
  const defaults: Settings = {
    controlSize: window.innerHeight <= 667 ? 'S' : 'M',
    leftHanded: false,
    thrustButton: false,
    reducedMotion: false,
    brightMines: false,
    sound: true,
    respectSilent: true,
    quality: 'auto',
    showPerf: false,
    textScale: 1,
    oneHanded: false,
    thrustMode: 'hold',
    returnTick: 'training',
    landingAssist: false,
    steadyDrill: false,
  };
  const state: AppState = {
    overlay: signal<Overlay>(opts.overlay ?? null),
    countdownMs: signal(0),
    sheet: signal<SheetId>(opts.sheet ?? null),
    look: signal<Look>(opts.look),
    hudTick: signal(0),
    toasts: signal<Toast[]>([]),
    death: signal<DeathInfo | null>(null),
    settings: signal<Settings>({ ...defaults, ...opts.settings }),
    arming: signal<{ slot: number; progress: number } | null>(null),
    canInstall: signal(opts.canInstall ?? false),
    standalone: signal(opts.standalone ?? true),
    styleTest: signal(opts.styleTest ?? true),
    perf: signal<{ fps: number; frameMs: number; drawCalls: number; tris: number } | null>(null),
    mode: signal<'play' | 'build'>('play'),
    radio: signal<RadioMessage[]>([]),
    goal: signal<GoalChip | null>(null),
    tripSummary: signal<TripSummary | null>(null),
    updateReady: signal(false),
  };
  let toastId = 0;
  let hudAcc = 0;

  const app: FakeApp = {
    state,
    world,
    enterBuild() {
      state.mode.value = 'build';
    },
    exitBuild() {
      state.mode.value = 'play';
    },
    async applyUpdate() {
      state.updateReady.value = false;
    },
    async perfReport() {
      return 'HFPR:fake';
    },
    dismissRadio(id) {
      state.radio.value = state.radio.value.filter((m) => m.id !== id);
    },
    openSheet(id) {
      state.sheet.value = id;
    },
    closeSheet() {
      state.sheet.value = null;
    },
    resume() {
      if (state.overlay.peek() !== 'interrupt') return;
      const airborne = !world.pod.grounded || Math.abs(world.pod.vy) > 3;
      if (airborne) {
        state.countdownMs.value = 1500;
        state.overlay.value = 'countdown';
      } else state.overlay.value = null;
    },
    start() {
      state.overlay.value = null;
    },
    newGame() {
      world.reset();
      state.overlay.value = null;
      app.toast('New claim staked', 'good');
    },
    setLook(look) {
      state.look.value = look;
    },
    updateSettings(patch) {
      state.settings.value = { ...state.settings.peek(), ...patch };
    },
    toast(text, tone = 'info') {
      const now = performance.now();
      const live = state.toasts.peek().filter((t) => t.until > now);
      state.toasts.value = [...live, { id: ++toastId, text, tone, until: now + TOAST_MS }];
    },
    async exportSave() {
      return EXPORT_PREFIX + base64url(world.serialize());
    },
    async importSave(code) {
      try {
        const body = code.slice(EXPORT_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
        const data = JSON.parse(atob(body)) as { cash?: unknown };
        if (typeof data.cash !== 'number') return fail('That code is not a HoleFactory save');
        world.wallet.cash = data.cash;
        return ok('Save imported');
      } catch {
        return fail('That code is damaged');
      }
    },
    afterAction(r) {
      if (!r.ok) app.toast(r.reason, 'warn');
      else if (r.message) app.toast(r.message, 'good');
    },
    unlockAudio() {},
    tick(dtMs) {
      if (state.overlay.peek() === 'countdown') {
        const left = state.countdownMs.peek() - dtMs;
        state.countdownMs.value = Math.max(0, left);
        if (left <= 0) state.overlay.value = null;
      }
      hudAcc += dtMs;
      if (hudAcc >= 100) {
        hudAcc = 0;
        state.hudTick.value++;
      }
    },
  };
  return app;
}

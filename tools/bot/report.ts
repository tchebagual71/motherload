// Economy bot report (04 §11.2 outputs): per-run summary and the cross-run tables for docs/design/bot-report.md.
// PRI(phase) = median over the two profiles of pod income per minute (canon §4.3.1); with more seeds, the median of
// those per-seed values.
import { STEP_HZ } from '../../src/shared/canon';
import type { Bot } from './bot';
import { DEPTH_MARKS, PHASES, clock } from './metrics';

export interface PhaseSummary {
  id: string;
  minutes: number;
  /** Pod $/min (Assay + incentives). */
  pri: number;
  /** Factory $ ÷ (pod $ + factory $). */
  share: number;
  /** Factory $/min (Export + 90% book of parts the Garage used). */
  factoryRate: number;
  trips: number;
  /** Trips with ≥ 1 fuel or hull warning ÷ trips (P1: ≥ 0.2 for the slow-median profile). */
  warnedRate: number;
  fuelWarnings: number;
  hullWarnings: number;
  deaths: number;
}

export interface BotSummary {
  seed: number;
  profile: string;
  minutes: number;
  phases: PhaseSummary[];
  /** Steps at which the deepest row first reached each mark (null = not reached). */
  depth: Record<number, number | null>;
  firstLiftDelivery: number | null;
  starterKitReady: number | null;
  starterKitClaimed: number | null;
  firstIngot: number | null;
  upgrades: { step: number; line: string; tier: number }[];
  tilesPerMineral: number;
  trips: number;
  deaths: number;
  stuck: number;
  longestTripGap: number;
  longestStall: number;
  lodeShareAtT4: number | null;
  lodeShare: number;
  yardStage: number;
  cash: number;
  tiers: Record<string, number>;
  deepest: number;
}

export function summarize(bot: Bot, seed: number): BotSummary {
  const m = bot.m;
  const phases: PhaseSummary[] = [];
  PHASES.forEach((p, i) => {
    const s = m.phases[i];
    if (s.steps === 0) return;
    const min = s.steps / STEP_HZ / 60;
    phases.push({
      id: p.id,
      minutes: min,
      pri: m.pri(i),
      share: m.share(i),
      factoryRate: s.factoryIncome / min,
      trips: s.trips,
      warnedRate: s.trips > 0 ? s.tripsWarned / s.trips : 0,
      fuelWarnings: s.fuelWarnings,
      hullWarnings: s.hullWarnings,
      deaths: s.deaths,
    });
  });
  return {
    seed,
    profile: bot.profile.name,
    minutes: m.steps / STEP_HZ / 60,
    phases,
    depth: { ...m.depthStep },
    firstLiftDelivery: m.firstLiftDelivery,
    starterKitReady: m.starterKitReady,
    starterKitClaimed: m.starterKitClaimed,
    firstIngot: m.firstIngot,
    upgrades: m.upgrades.map((u) => ({ ...u })),
    tilesPerMineral: m.tilesPerMineral(),
    trips: m.trips.length,
    deaths: m.deaths,
    stuck: m.stuck,
    longestTripGap: bot.longestTripGap,
    longestStall: Math.max(bot.longestStall, bot.sinceProgress()),
    lodeShareAtT4: m.lodeShareAtT4,
    lodeShare: m.lodeShare(),
    yardStage: bot.yard.stage,
    cash: bot.w.wallet.cash,
    tiers: { ...bot.pod.tiers },
    deepest: bot.w.story.deepestRow,
  };
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
const fmt = (n: number, d = 0): string => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const pct = (n: number | null): string => (n === null || !Number.isFinite(n) ? '—' : `${Math.round(n * 100)}%`);

/** Markdown tables: per-run phases, cross-profile PRI, P1, depth marks and onboarding times. */
export function reportTables(runs: readonly BotSummary[]): string {
  const out: string[] = [];
  const profiles = [...new Set(runs.map((r) => r.profile))];
  const seeds = [...new Set(runs.map((r) => r.seed))];

  out.push('### PRI by phase (pod $/min; median of the two profiles, then of the seeds)\n');
  out.push('| Phase | ' + profiles.map((p) => `${p} (median of seeds)`).join(' | ') + ' | PRI (canon §4.3.1) | Provisional |');
  out.push('|---|' + profiles.map(() => '---:').join('|') + '|---:|---:|');
  const PROVISIONAL: Record<string, number> = { A: 250, B: 1_400, C: 4_000, D: 30_000, E1: 125_000, E2: 500_000 };
  for (const ph of PHASES) {
    const per = profiles.map((p) => median(runs.filter((r) => r.profile === p).flatMap((r) => r.phases.filter((x) => x.id === ph.id && x.minutes >= 3).map((x) => x.pri))));
    if (per.every((v) => !Number.isFinite(v))) continue;
    const bySeed = seeds.map((s) => median(profiles.flatMap((p) => runs.filter((r) => r.seed === s && r.profile === p).flatMap((r) => r.phases.filter((x) => x.id === ph.id && x.minutes >= 3).map((x) => x.pri)))));
    out.push(`| ${ph.id} | ${per.map((v) => fmt(v)).join(' | ')} | ${fmt(median(bySeed.filter(Number.isFinite)))} | ${fmt(PROVISIONAL[ph.id])} |`);
  }

  out.push('\n### Factory share and P1 (fuel/hull warnings per trip) by phase\n');
  out.push('| Phase | ' + profiles.map((p) => `${p} share`).join(' | ') + ' | ' + profiles.map((p) => `${p} warned trips`).join(' | ') + ' | P1 (slow-median ≥ 1 per 5 trips) |');
  out.push('|---|' + profiles.map(() => '---:').join('|') + '|' + profiles.map(() => '---:').join('|') + '|---|');
  for (const ph of PHASES) {
    const rows = profiles.map((p) => runs.filter((r) => r.profile === p).flatMap((r) => r.phases.filter((x) => x.id === ph.id)));
    if (rows.every((x) => x.length === 0)) continue;
    const share = rows.map((xs) => pct(median(xs.map((x) => x.share))));
    const warned = rows.map((xs) => {
      const trips = xs.reduce((s, x) => s + x.trips, 0);
      const w = xs.reduce((s, x) => s + Math.round(x.warnedRate * x.trips), 0);
      return trips > 0 ? `${w}/${trips} (${(w / trips).toFixed(2)})` : '—';
    });
    const slow = runs.filter((r) => r.profile === 'slow-median').flatMap((r) => r.phases.filter((x) => x.id === ph.id));
    const st = slow.reduce((s, x) => s + x.trips, 0);
    const sw = slow.reduce((s, x) => s + Math.round(x.warnedRate * x.trips), 0);
    const p1 = st === 0 ? '—' : sw / st >= 0.2 ? 'pass' : 'FAIL';
    out.push(`| ${ph.id} | ${share.join(' | ')} | ${warned.join(' | ')} | ${p1} |`);
  }

  out.push('\n### Per run\n');
  out.push('| Seed | Profile | Played | r40 | r80 | r129 | r200 | r319 (Seal) | Starter Kit → claimed | FirstLiftDelivery | ≤ 35:00 | First t3 | Lode-parts share at last t4 | Dug tiles / mineral | Trips | Deaths | Longest trip | Longest stall | Tiers D H E T R C S |');
  out.push('|---:|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const r of runs) {
    const t3 = r.upgrades.find((u) => u.tier === 3);
    const fld = r.firstLiftDelivery;
    const tiers = ['drill', 'hull', 'engine', 'tank', 'radiator', 'bay', 'scanner'].map((l) => r.tiers[l]).join(' ');
    out.push(
      `| ${r.seed} | ${r.profile} | ${clock(Math.round(r.minutes * 60 * STEP_HZ))} | ${DEPTH_MARKS.map((d) => clock(r.depth[d])).join(' | ')} | ${clock(r.starterKitReady)} → ${clock(r.starterKitClaimed)} | ${clock(fld)} | ${fld !== null && fld <= 35 * 60 * STEP_HZ ? 'yes' : 'NO'} | ${clock(t3?.step ?? null)} | ${pct(r.lodeShareAtT4)} | ${r.tilesPerMineral.toFixed(2)} | ${r.trips} | ${r.deaths} | ${clock(r.longestTripGap)} | ${clock(r.longestStall)} | ${tiers} |`,
    );
  }

  out.push('\n### Phase detail per run (minutes in phase, pod $/min, factory $/min, trips, warned trips, deaths)\n');
  out.push('| Seed | Profile | ' + PHASES.slice(0, 4).map((p) => p.id).join(' | ') + ' |');
  out.push('|---:|---|' + PHASES.slice(0, 4).map(() => '---').join('|') + '|');
  for (const r of runs) {
    const cells = PHASES.slice(0, 4).map((p) => {
      const x = r.phases.find((q) => q.id === p.id);
      return x ? `${fmt(x.minutes)} min · $${fmt(x.pri)} · f $${fmt(x.factoryRate)} · ${x.trips} trips · ${Math.round(x.warnedRate * x.trips)} warned · ${x.deaths} deaths` : '—';
    });
    out.push(`| ${r.seed} | ${r.profile} | ${cells.join(' | ')} |`);
  }
  return out.join('\n');
}

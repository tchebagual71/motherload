// Minimal economy bot (04 §11.2; canon §4.3.1, §4.4, §5.2). The default run is a fast smoke over the real World:
// a fixed seed, both profiles, a few game-minutes, asserting no soft-lock and steady progress. HF_BOT=1 runs the
// long table (both profiles × seeds × hours) that docs/design/bot-report.md records:
//   HF_BOT=1 npx vitest run tests/unit/bot.test.ts
// Optional: HF_BOT_SEEDS=7,1,2 HF_BOT_MINUTES=240 HF_BOT_OUT=/path/summary.json
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STEP_HZ } from '../../src/shared/canon';
import { Bot } from '../../tools/bot/bot';
import { clock } from '../../tools/bot/metrics';
import { PROFICIENT, PROFILES, SLOW_MEDIAN, type BotProfile } from '../../tools/bot/profiles';
import { reportTables, summarize, type BotSummary } from '../../tools/bot/report';

const MIN = 60 * STEP_HZ;
const LONG = !!process.env.HF_BOT;

function finitePod(bot: Bot): boolean {
  const p = bot.pod;
  return [p.x, p.y, p.vx, p.vy, p.fuel, p.hull].every(Number.isFinite);
}

/** Play `minutes` in 1-minute chunks, checking the pod stays finite and nothing soft-locks; `each` may stop it. */
function play(bot: Bot, minutes: number, each?: (minute: number) => boolean | void): void {
  for (let k = 1; k <= minutes; k++) {
    bot.run(MIN);
    expect(finitePod(bot), `pod state finite at ${k} min`).toBe(true);
    expect(bot.sinceProgress(), `no progress for > 10 game-minutes at ${k} min (soft-lock)`).toBeLessThan(10 * MIN);
    if (each?.(k) === true) return;
  }
}

function smoke(profile: BotProfile, minutes: number): { bot: Bot; earned: number[] } {
  const bot = new Bot({ seed: 7, profile });
  const earned: number[] = [];
  play(bot, minutes, (k) => {
    if (k % 5 === 0) earned.push(bot.w.wallet.lifetimeEarned);
  });
  return { bot, earned };
}

describe('economy bot smoke (seed 7, real World, no rendering)', () => {
  it('proficient: trips, sales, the onboarding factory and FirstLiftDelivery ≤ 35:00, no soft-lock', () => {
    const { bot, earned } = smoke(PROFICIENT, 20);
    const m = bot.m;
    // Monotonic progress: income in every 5-minute window, a growing depth record, many trips.
    for (let i = 1; i < earned.length; i++) expect(earned[i], `earnings window ${i}`).toBeGreaterThan(earned[i - 1]);
    expect(m.trips.length).toBeGreaterThanOrEqual(6);
    expect(bot.w.story.deepestRow).toBeGreaterThanOrEqual(40);
    expect(m.depthStep[40]).not.toBeNull();
    // The scripted lode, the Starter Kit and the drill + lift chain (canon §5.2 beats 5–6).
    expect(m.starterKitReady).not.toBeNull();
    expect(m.starterKitClaimed).not.toBeNull();
    expect(m.firstLiftDelivery, 'FirstLiftDelivery').not.toBeNull();
    expect(m.firstLiftDelivery!).toBeLessThanOrEqual(35 * MIN);
    expect(m.firstIngot).not.toBeNull();
    expect(bot.yard.stage).toBeGreaterThanOrEqual(1);
    expect(m.upgrades.length).toBeGreaterThanOrEqual(3);
    expect(m.deaths).toBeLessThanOrEqual(1);
    expect(bot.w.factory!.debug.conservationOk()).toBe(true);
    expect(m.tilesPerMineral()).toBeLessThan(4);
  });

  it('slow-median: slower and less efficient, still trips and sells without a soft-lock', () => {
    const { bot, earned } = smoke(SLOW_MEDIAN, 15);
    const m = bot.m;
    for (let i = 1; i < earned.length; i++) expect(earned[i]).toBeGreaterThan(earned[i - 1]);
    expect(m.trips.length).toBeGreaterThanOrEqual(3);
    expect(m.upgrades.length).toBeGreaterThanOrEqual(1);
    expect(m.deaths).toBeLessThanOrEqual(1);
    expect(bot.w.factory!.debug.conservationOk()).toBe(true);
  });

  it('is deterministic: the same seed and profile give the same World', () => {
    const a = new Bot({ seed: 3, profile: PROFICIENT });
    const b = new Bot({ seed: 3, profile: PROFICIENT });
    a.run(4 * MIN);
    b.run(4 * MIN);
    expect(a.w.serialize()).toEqual(b.w.serialize());
    expect(a.m.trips.length).toBe(b.m.trips.length);
  });
});

describe.skipIf(!LONG)('economy bot long run (HF_BOT=1)', () => {
  it('plays both profiles over several seeds and prints the report tables', () => {
    const seeds = (process.env.HF_BOT_SEEDS ?? '7,1,2').split(',').map(Number);
    const minutes = Number(process.env.HF_BOT_MINUTES ?? 240);
    const runs: BotSummary[] = [];
    for (const seed of seeds) {
      for (const profile of PROFILES) {
        const t0 = performance.now();
        const bot = new Bot({ seed, profile });
        // Stop once the MVP is played out: the r320 Seal reached and half an hour past it.
        play(bot, minutes, () => bot.m.depthStep[319] !== null && bot.m.steps > bot.m.depthStep[319]! + 30 * MIN);
        runs.push(summarize(bot, seed));
        console.log(`seed ${seed} ${profile.name}: ${minutes} game-min in ${((performance.now() - t0) / 1000).toFixed(1)} s; deepest ${bot.w.story.deepestRow}, FLD ${clock(bot.m.firstLiftDelivery)}`);
      }
    }
    const tables = reportTables(runs);
    console.log(`\n${tables}\n`);
    if (process.env.HF_BOT_OUT) writeFileSync(process.env.HF_BOT_OUT, JSON.stringify(runs, null, 2));
    for (const r of runs) {
      expect(r.firstLiftDelivery).not.toBeNull();
      expect(r.longestStall).toBeLessThan(10 * MIN);
    }
  }, 3_600_000);
});

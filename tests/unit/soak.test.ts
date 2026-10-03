// Trip soak (MVP-18; 04 §11.2 "2 game-hours with the factory running"): the proficient bot plays the real World
// with its factory, and every step the soak checks what must never break:
//   - the factory conservation invariant (02 §10.7) after every factory tick, and the Stockpile ledger (the Bins
//     add up to every Stockpile count) every game-minute;
//   - no NaN or Infinity in the pod's state, and a finite, non-negative wallet;
//   - every 10 game-minutes the save round-trips byte for byte, and the reloaded World, fed the same stick intents
//     for the next 10 s of mining, ends byte-identical to the straight run;
//   - no soft-lock: progress (a dig, a find, a sale, a trip end) at least every 10 game-minutes.
// Default: 2 game-hours. HF_SOAK_HOURS=n for longer (or shorter) runs.
import { describe, expect, it } from 'vitest';
import { STEP_HZ } from '../../src/shared/canon';
import { World } from '../../src/world/world';
import { Bot } from '../../tools/bot/bot';
import { clock } from '../../tools/bot/metrics';
import { PROFICIENT } from '../../tools/bot/profiles';

const MIN = 60 * STEP_HZ;
const HOURS = Number(process.env.HF_SOAK_HOURS ?? 2);
/** Steps a reloaded copy follows the straight run for. */
const MIRROR_STEPS = 10 * STEP_HZ;

function finite(...xs: number[]): boolean {
  return xs.every(Number.isFinite);
}

describe(`trip soak: ${HOURS} game-hours of bot play with the factory (seed 11)`, () => {
  it('keeps conservation, finite pod state, faithful saves and progress throughout', () => {
    const bot = new Bot({ seed: 11, profile: PROFICIENT });
    const w = bot.w;
    const f = w.factory!;
    const total = HOURS * 60 * MIN;
    let factoryTicks = 0;
    let roundTrips = 0;
    let mirrored = 0;
    let ledgerChecks = 0;
    let mirror: { w2: World; left: number; at: number } | null = null;
    let nextSave = 10 * MIN;
    bot.onAct = (act) => {
      if (!mirror) return;
      mirror.w2.step(act.intent, act.running);
      mirror.w2.drainEvents();
    };
    for (let i = 1; i <= total; i++) {
      bot.tick();
      const p = w.pod;
      if (!finite(p.x, p.y, p.vx, p.vy, p.prevX, p.prevY, p.fuel, p.hull)) throw new Error(`pod state not finite at ${clock(i)}: ${JSON.stringify(p)}`);
      if (!finite(w.wallet.cash, w.wallet.debt) || w.wallet.cash < 0) throw new Error(`wallet broken at ${clock(i)}: ${JSON.stringify(w.wallet)}`);
      // The World ticked the factory in this step iff the step it ran had stepNo % 3 === 2 (canon §3.5).
      if ((w.stepNo - 1) % 3 === 2) {
        factoryTicks++;
        if (!f.debug.conservationOk()) throw new Error(`factory conservation broken at ${clock(i)} (tick ${f.tickNo})`);
      }
      if (i % MIN === 0) {
        expect(bot.sinceProgress(), `soft-lock: no progress for 10 game-minutes at ${clock(i)}`).toBeLessThan(10 * MIN);
        ledgerChecks++;
        const sums = new Map<string, number>();
        for (const e of f.entities()) if (e.kind === 'bin') for (const s of f.inspect(e.id)!.contents) sums.set(s.item, (sums.get(s.item) ?? 0) + s.n);
        for (const s of f.stockpileItems()) expect(sums.get(s.item) ?? 0, `Stockpile ledger for ${s.item} at ${clock(i)}`).toBe(s.n);
        for (const [item, n] of sums) expect(f.stockpileCount(item), `Bins hold ${item}`).toBe(n);
      }
      // Every 10 game-minutes, at the next stretch of pure stick play underground: save, reload, follow.
      if (!mirror && i >= nextSave && bot.activity === 'mine' && p.y < -2 && !p.destroyed) {
        const bytes = w.serialize();
        const w2 = World.deserialize(bytes, 'mvp');
        expect(w2.serialize(), `save round trip at ${clock(i)}`).toEqual(bytes);
        roundTrips++;
        mirror = { w2, left: MIRROR_STEPS, at: i };
        nextSave = i + 10 * MIN;
      }
      if (mirror) {
        if (bot.activity !== 'mine' && bot.activity !== 'home') {
          // The bot is about to trade or build (WorldApi calls the mirror cannot see): try again shortly.
          mirror = null;
          nextSave = i + MIN;
        } else if (--mirror.left === 0) {
          expect(mirror.w2.serialize(), `reloaded World diverged from the straight run (saved at ${clock(mirror.at)})`).toEqual(w.serialize());
          mirrored++;
          mirror = null;
        }
      }
    }
    const m = bot.m;
    console.log(
      `soak ${HOURS} h: ${m.trips.length} trips, deepest r${w.story.deepestRow}, ${m.deaths} deaths, ${factoryTicks} factory ticks checked, ` +
        `${roundTrips} save round trips, ${mirrored} reload-vs-straight matches, ${ledgerChecks} ledger checks, Yard stage ${bot.yard.stage}, ` +
        `${f.entities().length} entities, ${f.debug.itemsHeld()} items held, longest stall ${clock(bot.longestStall)}`,
    );
    expect(roundTrips).toBeGreaterThanOrEqual(HOURS * 6 - 1);
    expect(mirrored).toBeGreaterThanOrEqual(HOURS * 6 - 2);
    expect(m.trips.length).toBeGreaterThan(HOURS * 10);
    expect(bot.yard.stage, 'the factory reached its workshop').toBeGreaterThanOrEqual(2);
  }, 600_000);
});

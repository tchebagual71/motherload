// Radio-card lint (canon §2.12 #5, 04 §11 "radio-card lint"): every card ≤ 90 characters with worst-case live
// values, ≤ 4 cards a beat, no beat at an original transmission depth (§2.12 #1), and no name from canon §2.11
// anywhere in src/story.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TILE_FT } from '../../src/shared/canon';
import { MILESTONES } from '../../src/story/milestones';
import { MVP_RUNGS } from '../../src/story/plans';
import { RELICS } from '../../src/shared/canon';
import { BEATS, BEAT_IDS, DEPTH_BEATS, RECORDER_LOGS, chainsAndLinks, relicCaption, renderBeat, type BeatId } from '../../src/story/script';

const MAX_CHARS = 90;
const MAX_CARDS = 4;
/** Canon §2.12 #1: the original game's transmission depths (ft). */
const ORIGINAL_DEPTHS_FT = [0, 500, 1_000, 1_750, 2_100, 2_500, 3_100, 3_500, 4_100, 4_500, 5_800, 6_200, 7_000];
/** "~5,800" is approximate: keep a margin around it. */
const APPROX_MARGIN_FT = 50;

/** Canon §2.11: names that never ship (case-insensitive). */
const NEVER_SHIP: readonly RegExp[] = [
  /ironium/i,
  /bronzium/i,
  /silverium/i,
  /goldium/i,
  /einsteinium/i,
  /amazonite/i,
  /natas/i,
  /satan/i,
  /propellent vendor/i,
  /mineral processor/i,
  /autobuy/i,
  /emendation station/i,
  /reserve fuel tank/i,
  /nanobot/i,
  /quantum teleporter/i,
  /matter transmitter/i,
  /core teleporter/i,
  /silvide/i,
  /energy-shielded/i,
  /\bjag\b/i,
  /leviathan/i,
  /liquid compression/i,
  /stock fan/i,
  /dual fans/i,
  /(single|dual|tri)[- ]turbine/i,
  /\bpuron\b/i,
  /freon array/i,
  /pod #\s*3422/i,
  /pod #\s*10043/i,
  /the motherload/i,
  /66,666/,
  /fuel cell/i,
  /nano-welder/i,
  /(discount|priority) (teleporter|transporter)/i,
  /\b(diamond|ruby|emerald|silver|gold|titanium|platinum)\s+(drill|hull)\b/i,
];

/** Sample live values: both ends of the range and a few that stress the formatting (e.g. 99 links → 100). */
function samples(id: BeatId): number[] {
  const v = BEATS[id].value;
  if (!v) return [0];
  const mid = Math.floor((v.lo + v.hi) / 2);
  return [v.lo, v.hi, mid, v.hi - (v.hi % 100) - 1, 199, 9_999].filter((n) => n >= v.lo && n <= v.hi);
}

function allCards(): { id: BeatId; value: number; card: string }[] {
  const out: { id: BeatId; value: number; card: string }[] = [];
  for (const id of BEAT_IDS) for (const value of samples(id)) for (const p of renderBeat(id, value)) for (const card of p.cards) out.push({ id, value, card });
  return out;
}

function storySources(dir = 'src/story'): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...storySources(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe('radio cards (canon §2.12 #5)', () => {
  it('every card is at most 90 characters, with worst-case live values', () => {
    const long = allCards().filter((c) => [...c.card].length > MAX_CHARS);
    expect(long).toEqual([]);
  });

  it('no beat has more than 4 cards', () => {
    for (const id of BEAT_IDS) {
      for (const value of samples(id)) {
        const n = renderBeat(id, value).reduce((s, p) => s + p.cards.length, 0);
        expect(n, id).toBeGreaterThan(0);
        expect(n, id).toBeLessThanOrEqual(MAX_CARDS);
      }
    }
  });

  it('cards are plain, non-empty, single-line text without template leftovers', () => {
    for (const { id, card } of allCards()) {
      expect(card.trim(), id).toBe(card);
      expect(card, id).not.toMatch(/[{}\n]|undefined|NaN/);
    }
  });

  it('S7 rolls 99 links over into the next chain', () => {
    expect(chainsAndLinks(2_499)).toBe('24 chains, 99 links');
    expect(chainsAndLinks(2_500)).toBe('25 chains, 0 links');
    expect(renderBeat('S7', 2_499)[0].cards[0]).toBe('…24 chains, 99 links. 25 chains, 0 links. Mark.');
  });
});

describe('story originality (canon §2.11, §2.12)', () => {
  it('no depth beat other than an incentive fires at an original transmission depth', () => {
    for (const b of DEPTH_BEATS) {
      if (b.incentive) continue;
      const top = b.row * TILE_FT;
      const bottom = top + TILE_FT;
      for (const d of ORIGINAL_DEPTHS_FT) {
        const margin = d === 5_800 ? APPROX_MARGIN_FT : 0;
        expect(d + margin < top || d - margin >= bottom, `${b.id} at r${b.row} spans ${d} ft`).toBe(true);
      }
    }
  });

  it('incentive beats carry only the incentive; the game-start card only the refuel', () => {
    for (const id of ['S2', 'S3', 'S4'] as const) {
      const parts = renderBeat(id);
      expect(parts).toHaveLength(1);
      expect(parts[0].cards).toHaveLength(1);
      expect(parts[0].cards[0]).toMatch(/incentive/i);
      expect(parts[0].cards[0]).toMatch(/\$\d/);
    }
    const s0 = renderBeat('S0');
    expect(s0).toHaveLength(1);
    expect(s0[0].cards).toHaveLength(1);
    expect(s0[0].cards[0]).toMatch(/Pump House/);
  });

  it('no name that never ships appears anywhere in src/story', () => {
    const hits: string[] = [];
    for (const f of storySources()) {
      const text = readFileSync(f, 'utf8');
      for (const re of NEVER_SHIP) if (re.test(text)) hits.push(`${f}: ${re}`);
    }
    expect(hits).toEqual([]);
  });

  it('the rendered script, milestones and plans are clean too', () => {
    const texts = [
      ...allCards().map((c) => c.card),
      ...MILESTONES.flatMap((m) => [m.title, m.how]),
      ...MVP_RUNGS.flatMap((r) => [r.name, r.trigger, r.unlocks]),
      ...BEAT_IDS.map((id) => BEATS[id].title),
      ...RELICS.map((r) => relicCaption(r.id)),
    ];
    for (const t of texts) for (const re of NEVER_SHIP) expect(re.test(t), `${t} ~ ${re}`).toBe(false);
  });
});

describe('MVP story content (01 §7.4, §7.5, §8)', () => {
  it('has S0–S9 and S11, and Deepreach logs 1–6 of two cards each', () => {
    for (const id of ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S11'] as const) expect(BEATS[id]).toBeDefined();
    expect(RECORDER_LOGS).toBe(6);
    for (let n = 1; n <= RECORDER_LOGS; n++) {
      const parts = renderBeat(`L${n}` as BeatId);
      expect(parts).toHaveLength(1);
      expect(parts[0].sender).toBe('Deepreach log');
      expect(parts[0].cards).toHaveLength(2);
    }
  });

  it('Channel Zero speaks first in S7 and S8, counting in chains, links or buckets', () => {
    for (const id of ['S7', 'S8'] as const) {
      const [zero, dot] = renderBeat(id, BEATS[id].value!.lo + 1);
      expect(zero.sender).toBe('Channel Zero');
      expect(zero.cards[0]).toMatch(/^….*\d.*Mark\.$/);
      expect(dot.sender).toBe('Dot');
    }
  });

  it('has the 15 MVP milestones, each with a unique id and title', () => {
    expect(MILESTONES).toHaveLength(15);
    expect(new Set(MILESTONES.map((m) => m.id)).size).toBe(15);
    expect(new Set(MILESTONES.map((m) => m.title)).size).toBe(15);
  });

  it('captions every relic in at most 90 characters', () => {
    for (const r of RELICS) {
      const c = relicCaption(r.id);
      expect(c.length, r.name).toBeGreaterThan(0);
      expect([...c].length, r.name).toBeLessThanOrEqual(MAX_CHARS);
    }
  });

  it('lists the MVP Co-op Plans rungs U0–U3', () => {
    expect(MVP_RUNGS.map((r) => r.id)).toEqual(['U0', 'U1', 'U2', 'U3']);
  });
});

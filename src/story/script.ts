// Every MVP radio line (01 §7.4 beat schedule, §7.5 Deepreach logs). Original HoleFactory text; canon §2.12:
// ≤ 90 characters a card, ≤ 4 cards a beat (CI lint: tests/unit/story-lint.test.ts), no beat at an original
// transmission depth except the incentives (which carry only the incentive) and the game-start card (which
// carries only the refuel instruction). Tutorial guidance lives in goal chips (goals.ts), not here. PURE MODULE.
import { INCENTIVES, MVP_SEAL_ROW, RELICS, SCRIPTED_LODE_TOP, SURVEY_PING_ROW, TILE_FT } from '../shared/canon';
import type { BeatPart, Sender } from './types';

export type BeatId = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S11' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export interface BeatDef {
  id: BeatId;
  /** Short heading for Dot's office log. */
  title: string;
  /** Live value range {lo, hi} when the cards carry one (S7: depth in links; S8: lift height in rows). */
  value?: { lo: number; hi: number };
  parts(value: number): BeatPart[];
}

/** One chain = 66 ft = 100 links (01 §7.4 {C}/{L}). */
export const FEET_PER_LINK = 0.66;
/** First reach of r180: Gran's note marks the Poor Iridium lode (canon §3.2 map pings). */
export const IRIDIUM_PING_ROW = 180;
/** A lift taller than this many rows wakes the count (S8). */
export const TALL_LIFT_ROWS = 100;
export const RECORDER_LOGS = 6;
/** Relic id of the Lost Pod Recorder (canon §2.3): each one sold plays the next Deepreach log. */
export const RECORDER_RELIC = RELICS.findIndex((r) => r.name === 'Lost Pod Recorder');

/** "12,345" without locale data (pure code must not depend on the host's Intl). */
export function grouped(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Depth in whole links for a depth in feet. */
export function toLinks(depthFt: number): number {
  return Math.max(0, Math.round(depthFt / FEET_PER_LINK));
}

/** "24 chains, 81 links" for a depth in links. */
export function chainsAndLinks(links: number): string {
  return `${Math.floor(links / 100)} chains, ${links % 100} links`;
}

const dot = (...cards: string[]): BeatPart => ({ sender: 'Dot', cards });
const zero = (...cards: string[]): BeatPart => ({ sender: 'Channel Zero', cards });
const log = (...cards: string[]): BeatPart => ({ sender: 'Deepreach log', cards });
const fixed =
  (...parts: BeatPart[]) =>
  (): BeatPart[] =>
    parts;

const LODE_FT = grouped(SCRIPTED_LODE_TOP * TILE_FT);
const [INC_500, INC_1000, INC_3500] = INCENTIVES.map((i) => `$${grouped(i.cash)}`);
/** MVP pods die well above r584; v1 extends both live values to the real Seal (lint covers the worst case). */
const DEEPEST_FT = 584 * TILE_FT;

const DEFS: readonly BeatDef[] = [
  {
    id: 'S0',
    title: 'First shift',
    parts: fixed(dot("Pip's tank is nearly dry, Seven. Roll left to the Pump House and fill her up.")),
  },
  {
    id: 'S1',
    title: 'Survey ping',
    parts: fixed(
      dot(
        `Ping! Pip just woke my old survey beacon. Copper lode, ${LODE_FT} feet down.`,
        "It's on your map. My old survey shaft runs straight down beside it.",
        'Long drop, that shaft. Hold up on the stick to hover down slow.',
      ),
    ),
  },
  {
    id: 'S2',
    title: '500 ft incentive',
    parts: fixed(dot(`Five hundred feet! Co-op depth incentive: ${INC_500}, paid to your account.`)),
  },
  {
    id: 'S3',
    title: '1,000 ft incentive',
    parts: fixed(dot(`One thousand feet! Co-op depth incentive: ${INC_1000}, paid to your account.`)),
  },
  {
    id: 'S4',
    title: '3,500 ft incentive',
    parts: fixed(dot(`Thirty-five hundred feet! The big one: a ${INC_3500} depth incentive, paid.`)),
  },
  {
    id: 'S5',
    title: "Dot's lode",
    parts: fixed(
      dot(
        "That's my lode! Too big for Pip to chew, but an Auto-Drill will work it all day.",
        'Your Starter Kit is at the Supply Shed, on the house: drill, lift, rail, belts.',
        'Dig down to it at the chevrons. The lift hangs in my shaft, up to the old Headframe.',
      ),
    ),
  },
  {
    id: 'S6',
    title: 'First delivery',
    parts: fixed(
      dot(
        "Ore's coming up on its own! I'm just going to stand here and watch the buckets.",
        'Smelt that copper and the Assembler makes Wire. The Garage wants Wire.',
      ),
    ),
  },
  {
    id: 'S7',
    title: 'Channel Zero',
    value: { lo: 0, hi: toLinks(DEEPEST_FT) },
    parts: (links) => [
      zero(`…${chainsAndLinks(links)}. ${chainsAndLinks(links + 1)}. Mark.`),
      dot(
        "That's Channel Zero, a dead band. Nobody's used it in forty years.",
        'And that clink is Hardrock. No drill bites it. Go around, or pop it with a charge.',
      ),
    ],
  },
  {
    id: 'S8',
    title: 'The count',
    value: { lo: TALL_LIFT_ROWS + 1, hi: 583 },
    parts: (n) => [
      zero(`…${n} buckets. ${n} links. Mark.`),
      dot(
        `${n}. That's the bucket count on your new lift, Seven. Exactly. I counted twice.`,
        "Somebody down there keeps books on us. I'd like to know who.",
      ),
    ],
  },
  {
    id: 'S9',
    title: "Gran's note",
    parts: fixed(
      dot(
        "Found one of Gran's old survey notes: an iridium lode, thin but real. Marked.",
        'Iridium Ingots only come from lode ore. Pressure Vessels need them. So does the Keg.',
      ),
    ),
  },
  {
    id: 'S11',
    title: 'The Seal',
    parts: fixed(dot("Co-op drilling rights end here — for now. I'm working on it. Keep digging up top.")),
  },
  {
    id: 'L1',
    title: 'Deepreach log 1',
    parts: fixed(log("Deepreach One, day forty. Shale's soft, crew's cheerful.", 'Somebody keeps scratching tally marks on the tunnel walls. Funny.')),
  },
  {
    id: 'L2',
    title: 'Deepreach log 2',
    parts: fixed(log('Deepreach Three. Survey stakes at nineteen hundred feet. Brass heads.', 'Not ours. Older than the colony. Older than anything I know.')),
  },
  {
    id: 'L3',
    title: 'Deepreach log 3',
    parts: fixed(log('Deepreach Two. The radio counts on a dead band now. Chains and links.', 'It counted our crew this morning. It got the number right.')),
  },
  {
    id: 'L4',
    title: 'Deepreach log 4',
    parts: fixed(log('Deepreach Six. Every lift bucket we hang, the count goes up by one.', 'We stopped hanging buckets. The count kept going.')),
  },
  {
    id: 'L5',
    title: 'Deepreach log 5',
    parts: fixed(log("Deepreach Five. Head office calls the deep claims 'contested'.", 'Contested by whom? Nobody will say. We pull the crews up at shift end.')),
  },
  {
    id: 'L6',
    title: 'Deepreach log 6',
    parts: fixed(
      log("Deepreach Seven. If you find this: there's a gap in the floor by the east wall.", "Whatever's under it filed first. It wants its paperwork back."),
    ),
  },
];

export const BEATS: Readonly<Record<BeatId, BeatDef>> = Object.fromEntries(DEFS.map((d) => [d.id, d])) as Record<BeatId, BeatDef>;
export const BEAT_IDS: readonly BeatId[] = DEFS.map((d) => d.id);

export function isBeatId(id: string): id is BeatId {
  return id in BEATS;
}

/** Deepreach log beat for the n-th Recorder sold (1-based), or null past the MVP's six. */
export function recorderLog(n: number): BeatId | null {
  return n >= 1 && n <= RECORDER_LOGS ? (`L${n}` as BeatId) : null;
}

/** The cards of a beat with its live value filled in. */
export function renderBeat(id: BeatId, value = 0): BeatPart[] {
  return BEATS[id].parts(value);
}

/** The first sender of a beat (office log styling). */
export function beatSender(id: BeatId): Sender {
  return BEATS[id].parts(BEATS[id].value?.lo ?? 0)[0].sender;
}

/** Relic captions for the Assay list (01 §7.8 MVP "relic captions"), by relic id (canon §2.3). */
const RELIC_CAPTIONS: readonly string[] = [
  'A spiral shell in red stone. Something lived down here, long before the Co-op.',
  "Dented, locked and heavy. Somebody's savings from before the colony.",
  'A Deepreach crew recorder. Sell it and the Assay plays the tape for Dot.',
  'Slate cut with survey marks in no alphabet Dot knows. She logs it anyway.',
];

export function relicCaption(id: number): string {
  return RELIC_CAPTIONS[id] ?? '';
}

/**
 * Beats fired by a depth (canon §2.12 #1 lint): incentive beats are exempt because they carry only the
 * incentive; everything else must avoid the original transmission depths.
 */
export const DEPTH_BEATS: readonly { id: BeatId; row: number; incentive: boolean }[] = [
  { id: 'S1', row: SURVEY_PING_ROW, incentive: false },
  { id: 'S2', row: INCENTIVES[0].row, incentive: true },
  { id: 'S3', row: INCENTIVES[1].row, incentive: true },
  { id: 'S4', row: INCENTIVES[2].row, incentive: true },
  { id: 'S9', row: IRIDIUM_PING_ROW, incentive: false },
  { id: 'S11', row: MVP_SEAL_ROW, incentive: false },
];

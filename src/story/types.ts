// Story contracts (01 §7; canon §2.12, §3.9). PURE MODULE (types only).
import type { Line } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { Scope } from '../shared/types';

/** Radio senders (03 §6.5 card styles). */
export type Sender = Extract<GameEvent, { t: 'radio' }>['sender'];

/** One sender's run of cards inside a beat (a beat may switch sender, e.g. S7: Channel Zero, then Dot). */
export interface BeatPart {
  sender: Sender;
  cards: readonly string[];
}

/**
 * What the World tells the director about the pod after each step. The World reuses one object, so the
 * director must not keep it.
 */
export interface StorySnapshot {
  stepNo: number;
  /** Pod centre row, clamped to 0 in the sky and on the Rim. */
  row: number;
  /** Pod centre depth below the Rim in feet (≥ 0). */
  depthFt: number;
  grounded: boolean;
  onRim: boolean;
  /** Not destroyed and hull > 0. */
  alive: boolean;
  /** Steps until a pending second Magma hit (0 = none), canon §3.3. */
  magmaPending: number;
  trips: number;
  cash: number;
  tiers: Readonly<Record<Line, number>>;
}

/** World facts the director reads on demand (never per step unless noted). */
export interface StoryContext {
  scope: Scope;
  /** Id of the scripted Copper lode (canon §3.2). */
  scriptedLodeId: number;
  /** Id of the fixed Poor Iridium lode (R12), pinged at r180; −1 if absent. */
  iridiumLodeId: number;
  /** Cargo mass ÷ hover cap now (Heavy Hauler); called on trip end only. */
  loadFrac(): number;
  /** Parts of this id in the Stockpile (Plated); polled about twice a second. */
  partCount(part: string): number;
  /** Does buying this tier spend this part (canon §4.3.5)? Called on upgrade purchases only. */
  billHasPart(line: Line, tier: number, part: string): boolean;
}

/** Output port: the World's event buffer. */
export type Emit = (e: GameEvent) => void;

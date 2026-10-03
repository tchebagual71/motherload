// Radio card timing (canon §2.12 #5; 03 §6.5): a 1-line ticker (sender + 28 characters) while moving; the full
// card when grounded and idle ≥ 0.6 s, or on "›"; the next stick input after that collapses it again. The
// auto-advance clock (max(4 s, 60 ms × characters)) runs only while the full card is open, so a ticker never
// expires while moving. Fed the queue head and the pod's motion at the HUD rate. No DOM; unit-tested.
import type { RadioMessage } from '../../app/types';

export const IDLE_OPEN_MS = 600;
export const TICKER_CHARS = 28;
/** Typewriter rate (03 §6.5). */
export const TYPE_PER_MS = 40 / 1000;
const MIN_DWELL_MS = 4_000;
const DWELL_PER_CHAR_MS = 60;
/** A longer gap between samples (a pause, a hidden tab) does not count toward the clock. */
const MAX_DT_MS = 250;

export type RadioMode = 'hidden' | 'ticker' | 'card';

export function charCount(text: string): number {
  return [...text].length;
}

/** Auto-advance time for one card. */
export function cardDwellMs(text: string): number {
  return Math.max(MIN_DWELL_MS, DWELL_PER_CHAR_MS * charCount(text));
}

/** The ticker's share of a card: its first 28 characters, then "…". */
export function tickerText(text: string): string {
  const chars = [...text];
  return chars.length <= TICKER_CHARS ? text : `${chars.slice(0, TICKER_CHARS).join('').trimEnd()}…`;
}

export interface RadioInput {
  now: number;
  head: RadioMessage | null;
  grounded: boolean;
  /** Stick or thrust input, or the pod moving or digging, this sample. */
  moving: boolean;
  /** A sheet or overlay covers the play view: hide the radio and hold its clock. */
  covered: boolean;
}

export interface RadioView {
  mode: RadioMode;
  msg: RadioMessage | null;
  index: number;
  text: string;
  /** Milliseconds the current card has been open (drives the typewriter). */
  openMs: number;
}

const HIDDEN: RadioView = { mode: 'hidden', msg: null, index: 0, text: '', openMs: 0 };

export class RadioPlayer {
  private msgId = -1;
  private index = 0;
  private expanded = false;
  private openMs = 0;
  private idleSince = -1;
  private wasMoving = false;
  private lastNow = -1;
  private mode: RadioMode = 'hidden';
  /** Id of a message that finished its last card and should leave the queue, or −1. */
  done = -1;

  update(inp: RadioInput): RadioView {
    const dt = this.lastNow < 0 ? 0 : Math.min(MAX_DT_MS, Math.max(0, inp.now - this.lastNow));
    this.lastNow = inp.now;
    this.trackMotion(inp);
    const head = inp.head;
    if (!head || head.id === this.done) return this.hide();
    if (head.id !== this.msgId) this.startMessage(head.id);
    if (inp.covered) return this.hide();

    const idleOpen = inp.grounded && !inp.moving && this.idleSince >= 0 && inp.now - this.idleSince >= IDLE_OPEN_MS;
    const wasCard = this.mode === 'card';
    this.mode = this.expanded || idleOpen ? 'card' : 'ticker';
    if (this.mode === 'card') {
      if (wasCard) this.openMs += dt; // the clock starts when the card opens
      if (this.openMs >= cardDwellMs(head.cards[this.index] ?? '')) this.advance(head);
      if (head.id === this.done) return this.hide();
    }
    return { mode: this.mode, msg: head, index: this.index, text: head.cards[this.index] ?? '', openMs: this.openMs };
  }

  /** "›": open the ticker as a full card, or move the open card on. */
  tap(head: RadioMessage | null): void {
    if (!head || head.id !== this.msgId) return;
    if (this.mode === 'ticker') this.expanded = true;
    else if (this.mode === 'card') this.advance(head);
  }

  private trackMotion(inp: RadioInput): void {
    if (inp.moving) {
      if (!this.wasMoving) this.expanded = false; // the next stick input collapses an open card
      this.idleSince = -1;
    } else if (this.idleSince < 0) {
      this.idleSince = inp.now;
    }
    this.wasMoving = inp.moving;
  }

  private startMessage(id: number): void {
    this.msgId = id;
    this.index = 0;
    this.openMs = 0;
    this.expanded = false;
  }

  private advance(head: RadioMessage): void {
    this.openMs = 0;
    if (++this.index >= head.cards.length) this.done = head.id;
  }

  private hide(): RadioView {
    this.mode = 'hidden';
    return HIDDEN;
  }
}

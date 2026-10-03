// The story's persistent record, kept as keys in World.story.flags (the save codec's STRY section stores
// them; 04 §4.8 "flags … card log"). One key per fact, so the office log rebuilds from a save alone:
//   tx:<seq>:<beat>[:<value>]  a transmission that fired, in order, with its live value (S7 links, S8 rows)
//   ms:<seq>:<milestone>       a milestone earned (same sequence, so the log interleaves both)
//   rung:<U0…>                 a Co-op Plans rung (plans.ts)
//   ping:<lodeId>              a lode Dot marked on the map (S1, S9)
//   ob:<fact>                  an onboarding fact the goal chip needs (goals.ts)
// PURE MODULE.

export interface LedgerEntry {
  seq: number;
  kind: 'beat' | 'milestone';
  id: string;
  /** Live value of a beat's cards (0 when it has none). */
  value: number;
}

export const pingFlag = (lodeId: number): string => `ping:${lodeId}`;
export const obFlag = (fact: string): string => `ob:${fact}`;

function parseEntry(key: string): LedgerEntry | null {
  const p = key.split(':');
  const kind = p[0] === 'tx' ? 'beat' : p[0] === 'ms' ? 'milestone' : null;
  if (!kind || p.length < 3) return null;
  const seq = Number(p[1]);
  const value = p.length > 3 ? Number(p[3]) : 0;
  if (!Number.isInteger(seq) || seq < 0 || !Number.isFinite(value) || p[2] === '') return null;
  return { seq, kind, id: p[2], value };
}

export class StoryLedger {
  private readonly beats = new Map<string, LedgerEntry>();
  private readonly earned = new Map<string, LedgerEntry>();
  private nextSeq = 0;

  /** Reads every key once; later writes go through this ledger (or are plain flags it reads directly). */
  constructor(readonly flags: Record<string, boolean>) {
    for (const key of Object.keys(flags)) {
      if (flags[key] !== true) continue;
      const e = parseEntry(key);
      if (!e) continue;
      (e.kind === 'beat' ? this.beats : this.earned).set(e.id, e);
      if (e.seq >= this.nextSeq) this.nextSeq = e.seq + 1;
    }
  }

  hasBeat(id: string): boolean {
    return this.beats.has(id);
  }
  beatValue(id: string): number {
    return this.beats.get(id)?.value ?? 0;
  }
  /** Record a fired beat; false if it had already fired (each beat fires once, canon §3.9). */
  recordBeat(id: string, value = 0): boolean {
    if (this.beats.has(id)) return false;
    const e: LedgerEntry = { seq: this.nextSeq++, kind: 'beat', id, value };
    this.beats.set(id, e);
    this.flags[value !== 0 ? `tx:${e.seq}:${id}:${value}` : `tx:${e.seq}:${id}`] = true;
    return true;
  }

  hasMilestone(id: string): boolean {
    return this.earned.has(id);
  }
  recordMilestone(id: string): boolean {
    if (this.earned.has(id)) return false;
    const e: LedgerEntry = { seq: this.nextSeq++, kind: 'milestone', id, value: 0 };
    this.earned.set(id, e);
    this.flags[`ms:${e.seq}:${id}`] = true;
    return true;
  }
  get milestoneCount(): number {
    return this.earned.size;
  }

  has(flag: string): boolean {
    return this.flags[flag] === true;
  }
  /** Set a plain flag; true if it was not set before. */
  set(flag: string): boolean {
    if (this.flags[flag] === true) return false;
    this.flags[flag] = true;
    return true;
  }

  /** Deepreach logs heard so far (the Recorder index, 04 §4.8). */
  logsHeard(): number {
    let n = 0;
    for (const id of this.beats.keys()) if (id.startsWith('L')) n++;
    return n;
  }

  /** Everything recorded, oldest first. */
  entries(): LedgerEntry[] {
    return [...this.beats.values(), ...this.earned.values()].sort((a, b) => a.seq - b.seq);
  }
}

// Dot's office (canon §2.4; 03 §6.3; 01 §7.4 "each beat … is logged in Dot's office", §8): the transmission
// log (every beat and milestone, newest first, replayed in full), the milestone board, Co-op Plans (02 §9 rungs
// U0–U3) and claim stats. Everything is read back from World.story.flags, so it survives saves.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController } from '../../app/types';
import {
  MILESTONES,
  MVP_RUNGS,
  RECORDER_LOGS,
  StoryLedger,
  isBeatId,
  isMilestoneId,
  isRungUnlocked,
  milestone,
  renderBeat,
  BEATS,
  type LedgerEntry,
} from '../../story';
import { BottomSheet } from '../BottomSheet';
import { formatCash, formatDepth, formatInt } from '../format';
import { Icon } from '../icons';
import { Avatar, senderClass } from './Avatar';
import './story.css';

type Tab = 'log' | 'board' | 'plans' | 'stats';
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'log', label: 'Log' },
  { id: 'board', label: 'Milestones' },
  { id: 'plans', label: 'Plans' },
  { id: 'stats', label: 'Stats' },
];

export function OfficeSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  app.state.hudTick.value; // a beat that fires while the office is open shows up
  const [tab, setTab] = useState<Tab>('log');
  const ledger = new StoryLedger(app.world.story.flags);
  return (
    <BottomSheet title="Dot's office" icon="assay" onClose={close} leaving={leaving} class="hf-office">
      <div class="hf-seg hf-office-tabs" role="tablist" aria-label="Office">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            class={t.id === tab ? 'hf-seg-btn hf-on' : 'hf-seg-btn'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'log' && <TransmissionLog ledger={ledger} />}
      {tab === 'board' && <MilestoneBoard ledger={ledger} />}
      {tab === 'plans' && <CoopPlans flags={app.world.story.flags} />}
      {tab === 'stats' && <ClaimStats app={app} ledger={ledger} />}
    </BottomSheet>
  );
}

function TransmissionLog({ ledger }: { ledger: StoryLedger }): JSX.Element {
  const entries = ledger.entries().reverse();
  if (entries.length === 0) return <p class="hf-empty">No transmissions yet. Dot calls when there's news.</p>;
  return (
    <ol class="hf-list hf-office-log">
      {entries.map((e) => (
        <LogEntry key={e.seq} entry={e} />
      ))}
    </ol>
  );
}

function LogEntry({ entry }: { entry: LedgerEntry }): JSX.Element | null {
  if (entry.kind === 'milestone') {
    if (!isMilestoneId(entry.id)) return null;
    const m = milestone(entry.id);
    return (
      <li class="hf-office-ms">
        <span class="hf-office-star" aria-hidden="true">
          ★
        </span>
        <span>
          <b>{m.title}</b> · {m.how}
        </span>
      </li>
    );
  }
  if (!isBeatId(entry.id)) return null;
  return (
    <li class="hf-office-beat">
      <span class="hf-office-beat-title">{BEATS[entry.id].title}</span>
      {renderBeat(entry.id, entry.value).map((part, i) => (
        <div key={i} class={`hf-office-tx ${senderClass(part.sender)}`}>
          <Avatar sender={part.sender} size={28} />
          <div class="hf-office-tx-body">
            <span class="hf-radio-from">{part.sender}</span>
            {part.cards.map((c, k) => (
              <p key={k}>{c}</p>
            ))}
          </div>
        </div>
      ))}
    </li>
  );
}

function MilestoneBoard({ ledger }: { ledger: StoryLedger }): JSX.Element {
  return (
    <>
      <p class="hf-note">
        {ledger.milestoneCount} of {MILESTONES.length} on the board
      </p>
      <ul class="hf-list">
        {MILESTONES.map((m) => {
          const got = ledger.hasMilestone(m.id);
          return (
            <li key={m.id} class={got ? 'hf-list-row hf-office-got' : 'hf-list-row hf-office-todo'}>
              <span class="hf-office-badge" aria-hidden="true">
                {got ? <Icon name="check" size={18} /> : <Icon name="lock" size={16} />}
              </span>
              <span class="hf-list-main">
                <span class="hf-list-title">{m.title}</span>
                <span class="hf-list-sub">{m.how}</span>
              </span>
              <span class="hf-sr">{got ? 'earned' : 'not yet'}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function CoopPlans({ flags }: { flags: Readonly<Record<string, boolean>> }): JSX.Element {
  return (
    <>
      <p class="hf-note">The Co-op unlocks new kit as the claim proves out. No research needed, just progress.</p>
      <ul class="hf-list">
        {MVP_RUNGS.map((r) => {
          const open = isRungUnlocked(flags, r.id);
          return (
            <li key={r.id} class={open ? 'hf-list-row hf-office-got' : 'hf-list-row hf-office-todo'}>
              <span class="hf-office-rung">{r.id}</span>
              <span class="hf-list-main">
                <span class="hf-list-title">{r.name}</span>
                <span class="hf-list-sub">{r.unlocks}</span>
                {!open && <span class="hf-office-trigger">Locked · {r.trigger}</span>}
              </span>
              <span class={open ? 'hf-chip hf-chip-ok' : 'hf-chip hf-chip-miss'}>{open ? 'Open' : 'Locked'}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ClaimStats({ app, ledger }: { app: AppController; ledger: StoryLedger }): JSX.Element {
  const w = app.world;
  const entries = ledger.entries();
  const beats = entries.filter((e) => e.kind === 'beat').length;
  const lodes = w.terrain ? w.terrain.lodes.filter((l) => l.discovered).length : 0;
  const rows: [string, string][] = [
    ['Deepest', formatDepth(w.story.deepestRow)],
    ['Trips', formatInt(w.story.trips)],
    ['Salvage tows', formatInt(w.story.destructions)],
    ['Earned', formatCash(w.wallet.lifetimeEarned)],
    ['Lodes found', formatInt(lodes)],
    ['Transmissions', formatInt(beats)],
    ['Deepreach logs', `${ledger.logsHeard()} of ${RECORDER_LOGS}`],
    ['Milestones', `${ledger.milestoneCount} of ${MILESTONES.length}`],
  ];
  return (
    <dl class="hf-office-stats">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd class="hf-digits">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

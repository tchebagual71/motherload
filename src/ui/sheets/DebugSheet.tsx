// Debug menu (03 §6.3; 04 §13): only reachable when debugEnabled() (dev builds or ?debug=1).
import type { JSX } from 'preact';
import type { AppController, Overlay } from '../../app/types';
import { LINES, lineTierName, M0_FLOOR_ROW } from '../../shared/canon';
import { BottomSheet } from '../BottomSheet';
import { Button, SectionTitle, Switch } from '../widgets';

const TELEPORT_ROWS = [50, 100, M0_FLOOR_ROW - 1] as const;
const CASH_GIFTS = [
  { amount: 1_000, label: '+$1k' },
  { amount: 10_000, label: '+$10k' },
  { amount: 100_000, label: '+$100k' },
] as const;
const TEST_OVERLAYS: readonly { id: Overlay; label: string }[] = [
  { id: 'interrupt', label: 'Resume card' },
  { id: 'upright', label: 'Upright card' },
  { id: 'title', label: 'Title' },
];

function maxTier(line: (typeof LINES)[number]): number {
  for (let t = 7; t > 1; t--) if (lineTierName(line, t)) return t;
  return 1;
}

function perspectiveOn(): boolean {
  return new URLSearchParams(location.search).get('persp') === '1';
}

/** The perspective A/B flag is a renderer option (canon §3.4, M0 only): toggled through the URL + reload. */
function togglePerspective(): void {
  const url = new URL(location.href);
  url.searchParams.set('persp', perspectiveOn() ? '0' : '1');
  location.assign(url.toString());
}

export function DebugSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  app.state.hudTick.value;
  const w = app.world;
  const s = app.state.settings.value;
  return (
    <BottomSheet title="Debug" icon="bug" onClose={close} leaving={leaving}>
      <SectionTitle>Teleport</SectionTitle>
      <div class="hf-buy-row">
        {TELEPORT_ROWS.map((r) => (
          <Button key={r} onClick={() => w.debugTeleport(r)}>
            r{r}
          </Button>
        ))}
      </div>
      <SectionTitle>Cash</SectionTitle>
      <div class="hf-buy-row">
        {CASH_GIFTS.map((c) => (
          <Button key={c.amount} onClick={() => w.debugGiveCash(c.amount)}>
            {c.label}
          </Button>
        ))}
      </div>
      <SectionTitle>Pod</SectionTitle>
      <div class="hf-buy-row">
        <Button onClick={() => LINES.forEach((l) => w.debugSetTier(l, maxTier(l)))}>Max tiers</Button>
        <Button onClick={() => LINES.forEach((l) => w.debugSetTier(l, 1))}>Reset tiers</Button>
      </div>
      <SectionTitle>Look</SectionTitle>
      <div class="hf-buy-row">
        <Button onClick={() => app.setLook(app.state.look.peek() === 'toon' ? 'pixel' : 'toon')}>
          Toggle look ({app.state.look.value})
        </Button>
      </div>
      <Switch label="Perspective camera" hint="M0 A/B flag; reloads the page" value={perspectiveOn()} onChange={togglePerspective} />
      <Switch label="Performance HUD" value={s.showPerf} onChange={(v) => app.updateSettings({ showPerf: v })} />
      <SectionTitle>Screens</SectionTitle>
      <div class="hf-buy-row">
        {TEST_OVERLAYS.map((o) => (
          <Button
            key={o.label}
            onClick={() => {
              close();
              app.state.overlay.value = o.id;
            }}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </BottomSheet>
  );
}

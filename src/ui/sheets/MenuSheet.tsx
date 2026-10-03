// Pause / menu sheet (03 §6.3): Resume · Cargo (MVP) · Settings · Saves · How to play · Debug (dev).
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppController, SheetId } from '../../app/types';
import { scopeAtLeast } from '../../shared/scope';
import { BottomSheet } from '../BottomSheet';
import { debugEnabled } from '../env';
import { Icon, type IconName } from '../icons';
import { Button } from '../widgets';

export function MenuSheet({ app, close, leaving }: { app: AppController; close: () => void; leaving?: boolean }): JSX.Element {
  const [help, setHelp] = useState(false);
  const mvp = scopeAtLeast(app.world.scope, 'mvp');
  const go = (id: SheetId) => () => app.openSheet(id);
  return (
    <BottomSheet
      title={help ? 'How to play' : 'Paused'}
      onClose={close}
      leaving={leaving}
      footer={
        <Button kind="primary" big icon="play" onClick={close}>
          Resume
        </Button>
      }
    >
      {help ? (
        <HowToPlay onBack={() => setHelp(false)} />
      ) : (
        <nav class="hf-menu">
          {mvp && <MenuItem icon="cargo" label="Cargo" onClick={go('cargo')} />}
          {mvp && <MenuItem icon="assay" label="Dot's office" onClick={go('office')} />}
          <MenuItem icon="gear" label="Settings" onClick={go('settings')} />
          <MenuItem icon="save" label="Saves" onClick={go('saves')} />
          <MenuItem icon="help" label="How to play" onClick={() => setHelp(true)} />
          {debugEnabled() && <MenuItem icon="bug" label="Debug" onClick={go('debug')} />}
          <p class="hf-version">
            HoleFactory {__HF_VERSION__} · {app.world.scope.toUpperCase()}
          </p>
        </nav>
      )}
    </BottomSheet>
  );
}

function MenuItem({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" class="hf-row hf-menu-item" onClick={onClick}>
      <Icon name={icon} size={22} />
      <span class="hf-row-label">{label}</span>
      <span class="hf-chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

function HowToPlay({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <div class="hf-help">
      <ul>
        <li>
          <b>Drive and dig:</b> put your thumb down in the lower left and a stick appears. Push sideways to drive; push into
          dirt while on the ground to dig left, right or down.
        </li>
        <li>
          <b>Fly:</b> push the stick up to thrust. A little thrust brakes a fall; landing too fast dents the hull.
        </li>
        <li>
          <b>Fuel is the clock:</b> watch the fuel pill and get back to the Pump House before it runs dry.
        </li>
        <li>
          <b>Sell and upgrade:</b> park on the Assay Office pad to sell ore, then the Garage for a better drill, engine, tank
          and bay.
        </li>
        <li>
          <b>Quick slots:</b> hold an explosive until the ring fills, then let go. Slide off to cancel.
        </li>
        <li>
          <b>Keyboard:</b> arrows / WASD drive and dig, W or ↑ thrusts, 1–4 use slots, Esc opens this menu.
        </li>
      </ul>
      <Button onClick={onBack}>Back</Button>
    </div>
  );
}

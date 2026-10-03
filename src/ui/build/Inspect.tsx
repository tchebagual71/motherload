// Inspect sheet (03 §6.3: tap a building → 50% sheet): status, recipe picker (Assembler; the Smelter's recipes are
// automatic and listed), Router mode and filter, Bin unload filter, buffers, lift items in flight, Deconstruct and
// Route to surface. Underground ghosts show the Kit they wait for.
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { AppController } from '../../app/types';
import { BUILDINGS, type EntStatus, type InspectView, type ItemStack, type RecipeView, type RouterMode } from '../../factory/api';
import { hasItem } from '../../factory/items';
import { BottomSheet } from '../BottomSheet';
import { formatInt } from '../format';
import { Bar, Button } from '../widgets';
import { Glyph, kindGlyph, roleColour } from './glyphs';
import type { BuildSession } from './session';
import { buildingName, itemName, kitBill, kitName, unlockText } from './text';
import { kitsInCargo } from './tools';

const STATUS: Readonly<Record<EntStatus, string>> = {
  working: 'Working',
  idle: 'Idle: waiting for input',
  blocked: 'Blocked: output full',
  noRecipe: 'Pick a recipe',
  noOutput: 'Output full',
};

/** Items a Router filter or Bin unload filter may pick (MVP lode ores, ingots and parts). */
const FILTER_ITEMS = ['copperOre', 'hematiteOre', 'cobaltOre', 'goldOre', 'iridiumOre', 'copperIngot', 'ironIngot', 'cobaltIngot', 'goldIngot', 'gear', 'wire', 'hullPlate'].filter(hasItem);
const ROUTER_MODES: readonly { id: RouterMode; label: string }[] = [
  { id: 'even', label: 'Even' },
  { id: 'overflow', label: 'Overflow' },
  { id: 'filter', label: 'Filter' },
];

function stacks(list: readonly ItemStack[]): string {
  return list.length === 0 ? 'Empty' : list.map((s) => `${itemName(s.item)} ×${formatInt(s.n)}`).join(', ');
}

function recipeLine(r: RecipeView): string {
  const side = (l: readonly ItemStack[]): string => l.map((s) => `${s.n} ${itemName(s.item)}`).join(' + ');
  return `${side(r.inputs)} → ${side(r.outputs)} · ${(r.ticks / 20).toFixed(r.ticks % 20 === 0 ? 0 : 1)} s`;
}

/** The world tap that opened the sheet ends with a native click on its scrim: ignore closes this soon after opening. */
const OPEN_GUARD_MS = 400;

export function InspectSheet({ app, build }: { app: AppController; build: BuildSession }): JSX.Element | null {
  build.version.value;
  app.state.hudTick.value; // live buffers and status (≤ 10 Hz)
  const opened = useRef(performance.now());
  const close = (): void => {
    if (performance.now() - opened.current >= OPEN_GUARD_MS) build.closeInspect();
  };
  const f = app.world.factory;
  if (!f) return null;
  if (build.inspectGhost !== null) return <GhostSheet app={app} build={build} id={build.inspectGhost} close={close} />;
  const id = build.inspectId;
  const e = id !== null ? f.entity(id) : null;
  const iv = id !== null ? f.inspect(id) : null;
  if (!e || !iv || id === null) return null;
  // Route to surface from a drill (03 §4.6): a straight dug shaft beside it, up to a Headframe column.
  const piece = { x: e.x, y: e.y, w: e.w, h: e.h };
  const showRoute = e.kind === 'autoDrill' && build.routeFromPiece(piece) !== null;
  return (
    <BottomSheet
      title={`${buildingName(e.kind)}${e.rusted ? ' (rusted)' : ''}`}
      onClose={close}
      class="hf-sheet-half hf-inspect"
      footer={
        <div class="hf-inspect-foot">
          {showRoute && (
            <Button onClick={() => build.routeToSurface(piece)}>
              <Glyph name="route" size={20} />
              Route to surface
            </Button>
          )}
          <Button kind="danger" onClick={() => build.deconstruct(id)}>
            <Glyph name="bulldoze" size={20} />
            Deconstruct
          </Button>
        </div>
      }
    >
      <div class="hf-inspect-status">
        <span class="hf-inspect-swatch" style={{ background: roleColour(e.kind) }}>
          <Glyph name={kindGlyph(e.kind)} size={22} />
        </span>
        <span class="hf-inspect-state">
          <b>{STATUS[e.status]}</b>
          {e.kind === 'lift' && <span class="hf-row-hint">In flight: {formatInt(iv.inFlight)} · {e.h - 1} rows</span>}
          {e.recipe && <span class="hf-row-hint">Recipe {e.recipe}</span>}
        </span>
        {(e.kind === 'smelter' || e.kind === 'assembler' || e.kind === 'autoDrill') && <Bar frac={e.progress} color="var(--hf-primary)" class="hf-inspect-bar" />}
      </div>
      {e.kind === 'assembler' && <RecipePicker app={app} build={build} id={id} current={iv.recipe} />}
      {e.kind === 'smelter' && <SmelterRecipes app={app} />}
      {e.kind === 'router' && <RouterPanel build={build} id={id} iv={iv} />}
      {e.kind === 'bin' && <FilterPanel title="Unload filter" value={iv.filter} onPick={(item) => build.setUnloadFilter(id, item)} />}
      <dl class="hf-inspect-list">
        {iv.contents.length > 0 || e.kind === 'bin' || e.kind === 'smelter' || e.kind === 'assembler' ? (
          <>
            <dt>{e.kind === 'bin' ? 'Holds' : 'Input'}</dt>
            <dd>{stacks(iv.contents)}</dd>
          </>
        ) : null}
        {iv.output.length > 0 && (
          <>
            <dt>Output</dt>
            <dd>{stacks(iv.output)}</dd>
          </>
        )}
      </dl>
    </BottomSheet>
  );
}

function RecipePicker({ app, build, id, current }: { app: AppController; build: BuildSession; id: number; current: string | null }): JSX.Element {
  const list = app.world.factory?.recipes('assembler') ?? [];
  return (
    <div class="hf-inspect-section" role="radiogroup" aria-label="Recipe">
      <h3 class="hf-section">Recipe</h3>
      {list.map((r) => (
        <button
          key={r.id}
          type="button"
          role="radio"
          aria-checked={r.id === current}
          class={`hf-row hf-recipe${r.id === current ? ' hf-on' : ''}${r.unlocked ? '' : ' hf-locked'}`}
          disabled={!r.unlocked}
          onClick={() => build.setRecipe(id, r.id)}
        >
          <span class="hf-row-text">
            <span class="hf-row-label">
              {r.id} · {r.outputs.map((o) => itemName(o.item)).join(', ')}
            </span>
            <span class="hf-row-hint">{r.unlocked ? recipeLine(r) : 'Locked: own the inputs first'}</span>
          </span>
        </button>
      ))}
      {current && (
        <Button kind="ghost" onClick={() => build.setRecipe(id, null)}>
          Clear recipe
        </Button>
      )}
    </div>
  );
}

function SmelterRecipes({ app }: { app: AppController }): JSX.Element {
  const list = (app.world.factory?.recipes('smelter') ?? []).filter((r) => r.unlocked);
  return (
    <div class="hf-inspect-section">
      <h3 class="hf-section">Smelts automatically</h3>
      {list.slice(0, 6).map((r) => (
        <p key={r.id} class="hf-row-hint hf-recipe-line">
          {r.id}: {recipeLine(r)}
        </p>
      ))}
    </div>
  );
}

function RouterPanel({ build, id, iv }: { build: BuildSession; id: number; iv: InspectView }): JSX.Element {
  const mode = iv.routerMode ?? 'even';
  return (
    <div class="hf-inspect-section">
      <div class="hf-seg hf-router-seg" role="radiogroup" aria-label="Router mode">
        {ROUTER_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={m.id === mode}
            class={m.id === mode ? 'hf-seg-btn hf-on' : 'hf-seg-btn'}
            onClick={() => build.setRouterMode(id, m.id, m.id === 'filter' ? (iv.filter ?? FILTER_ITEMS[0]) : undefined)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'filter' && <FilterPanel title="Filter" value={iv.filter} onPick={(item) => item && build.setRouterMode(id, 'filter', item)} noOff />}
    </div>
  );
}

function FilterPanel({ title, value, onPick, noOff }: { title: string; value: string | null; onPick: (item: string | null) => void; noOff?: boolean }): JSX.Element {
  return (
    <div class="hf-inspect-section">
      <h3 class="hf-section">{title}</h3>
      <div class="hf-filter-chips" data-scroll="">
        {!noOff && (
          <button type="button" class={value === null ? 'hf-fchip hf-on' : 'hf-fchip'} aria-pressed={value === null} onClick={() => onPick(null)}>
            Off
          </button>
        )}
        {FILTER_ITEMS.map((it) => (
          <button key={it} type="button" class={value === it ? 'hf-fchip hf-on' : 'hf-fchip'} aria-pressed={value === it} onClick={() => onPick(it)}>
            {itemName(it)}
          </button>
        ))}
      </div>
    </div>
  );
}

function GhostSheet({ app, build, id, close }: { app: AppController; build: BuildSession; id: number; close: () => void }): JSX.Element | null {
  const g = app.world.factory?.ghosts().find((k) => k.id === id);
  if (!g) return null;
  const carried = kitsInCargo(app.world.pod.cargo)[g.kit] ?? 0;
  const locked = !app.world.factory?.isUnlocked(BUILDINGS[g.kind].mks[0].rung);
  return (
    <BottomSheet
      title={`${buildingName(g.kind)} ghost`}
      onClose={close}
      class="hf-sheet-half hf-inspect"
      footer={
        <div class="hf-inspect-foot">
          <Button kind="danger" onClick={() => build.removeGhost(id)}>
            <Glyph name="bulldoze" size={20} />
            Remove ghost
          </Button>
        </div>
      }
    >
      <dl class="hf-inspect-list">
        <dt>Needs</dt>
        <dd>{kitBill(g.kit, g.kitUnits)}</dd>
        <dt>In the bay</dt>
        <dd>{carried > 0 ? `${kitName(g.kit)}: ${formatInt(carried)}${g.kit === 'belt' ? ' tiles' : ''}` : 'None: buy at the Shed'}</dd>
      </dl>
      <p class="hf-row-hint">{locked ? unlockText(BUILDINGS[g.kind].mks[0].rung) : 'Pip builds it from the Kit by staying within 2 tiles for a second.'}</p>
    </BottomSheet>
  );
}

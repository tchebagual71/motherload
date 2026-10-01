// Model lineup for the render harness / debug gallery: every procedural model in one scene, animated,
// with Pip shown at each geometry step and in each pose, and the FX cycling through its events.
import type { Object3D } from 'three';
import { LINES, POD_H, type Line } from '../../shared/canon';
import type { GameEvent } from '../../shared/events';
import { createFx } from '../fx/fx';
import type { FxSystem, PodModel, PodVisualState, RimBuildingsModel, YardPropsModel } from './api';
import { createPodModel } from './pod';
import { createRimBuildings } from './rim';
import { createYardProps } from './yard';

export interface ModelLineup {
  pods: PodModel[];
  rim: RimBuildingsModel;
  yard: YardPropsModel;
  fx: FxSystem;
  /** Animate everything; `timeMs` is monotonic. */
  update(timeMs: number): void;
  /** Detach every model from the scene. */
  remove(): void;
}

export interface LineupOptions {
  /** Dot's survey column for the yard props (default 17). */
  surveyColumn?: number;
  /** Lineup start x on the Rim (default 15.5). */
  x0?: number;
}

type Pose = 'idle' | 'digDown' | 'digSide' | 'thrust' | 'fall';

interface PodSlot {
  model: PodModel;
  state: PodVisualState;
  pose: Pose;
  baseX: number;
}

function tiersAt(tier: number): Record<Line, number> {
  const out = {} as Record<Line, number>;
  for (const l of LINES) out[l] = tier;
  return out;
}

const SLOTS: readonly { tier: number; pose: Pose }[] = [
  { tier: 1, pose: 'idle' },
  { tier: 3, pose: 'idle' },
  { tier: 7, pose: 'idle' },
  { tier: 2, pose: 'digDown' },
  { tier: 5, pose: 'digSide' },
  { tier: 4, pose: 'thrust' },
  { tier: 6, pose: 'fall' },
];

function initialState(x: number, tier: number): PodVisualState {
  return {
    x,
    y: POD_H / 2,
    facing: 1,
    thrust: 0,
    digging: false,
    digDir: null,
    grounded: true,
    vx: 0,
    vy: 0,
    tiers: tiersAt(tier),
    timeMs: 0,
    fastFall: false,
  };
}

/** Pose a lineup pod for time t (seconds). Mutates the state in place. */
function pose(slot: PodSlot, t: number): void {
  const s = slot.state;
  s.x = slot.baseX;
  s.y = POD_H / 2;
  s.grounded = true;
  s.thrust = 0;
  s.digging = false;
  s.digDir = null;
  s.vx = 0;
  s.vy = 0;
  s.fastFall = false;
  switch (slot.pose) {
    case 'idle':
      s.facing = Math.floor(t / 3) % 2 === 0 ? 1 : -1;
      break;
    case 'digDown':
      s.digging = true;
      s.digDir = 'down';
      break;
    case 'digSide':
      s.digging = Math.floor(t / 2) % 2 === 0;
      s.digDir = 'right';
      s.facing = 1;
      break;
    case 'thrust': {
      const hop = (t % 2.4) / 2.4;
      s.grounded = hop > 0.85;
      s.y = POD_H / 2 + (s.grounded ? 0 : 1.6 * Math.sin(Math.min(1, hop / 0.85) * Math.PI));
      s.vy = s.grounded ? 0 : Math.cos(Math.min(1, hop / 0.85) * Math.PI) * 6;
      s.thrust = hop < 0.45 ? 1 : 0;
      s.vx = 2.5 * Math.sin(t * 0.8);
      break;
    }
    case 'fall':
      s.grounded = false;
      s.y = POD_H / 2 + 1.2;
      s.vy = -7;
      s.fastFall = true;
      break;
  }
}

const DEMO_EVENTS: readonly ((x: number) => GameEvent)[] = [
  (x) => ({ t: 'explosion', x: Math.floor(x), r: 2, radius: 1 }),
  () => ({ t: 'collect', item: { kind: 'mineral', tier: 4 } }),
  (x) => ({ t: 'dig-refused', x: Math.floor(x) + 1, r: 0, reason: 'hardrock' }),
  () => ({ t: 'landed', v: 6 }),
  (x) => ({ t: 'teleport', id: 'hopBeacon', x: x + 3, y: POD_H / 2 }),
  (x) => ({ t: 'explosion', x: Math.floor(x), r: 2, radius: 2 }),
  () => ({ t: 'damage', amount: 5, cause: 'landing' }),
];

/** Add every procedural model to `scene` in a lineup along the Rim and return its animator. */
export function addModelLineup(scene: Object3D, opts: LineupOptions = {}): ModelLineup {
  const x0 = opts.x0 ?? 15.5;
  const rim = createRimBuildings();
  const yard = createYardProps(opts.surveyColumn ?? 17);
  const fx = createFx();
  const slots: PodSlot[] = SLOTS.map((spec, i) => {
    const model = createPodModel();
    const baseX = x0 + i * 1.4;
    return { model, state: initialState(baseX, spec.tier), pose: spec.pose, baseX };
  });
  scene.add(rim.root, yard.root, fx.root, ...slots.map((s) => s.model.root));

  let lastMs = Number.NaN;
  let nextEvent = 1000;
  let eventIndex = 0;
  const fxX = x0 + SLOTS.length * 1.4 + 1;

  return {
    pods: slots.map((s) => s.model),
    rim,
    yard,
    fx,
    update(timeMs: number): void {
      const t = timeMs / 1000;
      for (const slot of slots) {
        pose(slot, t);
        slot.state.timeMs = timeMs;
        slot.model.update(slot.state);
      }
      rim.update(timeMs);
      yard.update(timeMs);
      if (timeMs >= nextEvent) {
        const make = DEMO_EVENTS[eventIndex++ % DEMO_EVENTS.length];
        fx.handle(make(fxX), fxX, POD_H / 2);
        nextEvent = timeMs + 1400;
      }
      const dt = Number.isNaN(lastMs) ? 0 : timeMs - lastMs;
      lastMs = timeMs;
      // Continuous emitters follow the digging and the thrusting lineup pods (half a frame each).
      fx.update(dt / 2, slots[3].state);
      fx.update(dt / 2, slots[5].state);
    },
    remove(): void {
      scene.remove(rim.root, yard.root, fx.root, ...slots.map((s) => s.model.root));
    },
  };
}

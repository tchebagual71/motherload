// UI-side action helpers shared by sheets, the HUD and the keyboard handler.
import type { AppController } from '../app/types';
import { RIM_BUILDINGS, type RimBuildingId } from '../shared/canon';
import type { Result } from '../world/api';

const RIM_IDS: ReadonlySet<string> = new Set(RIM_BUILDINGS.map((b) => b.id));

export function isRimSheet(id: string | null): id is RimBuildingId {
  return id !== null && RIM_IDS.has(id);
}

/** Close the open sheet. Rim sheets also tell the world so the pad stays disarmed (canon §2.4). */
export function closeCurrentSheet(app: AppController): void {
  const id = app.state.sheet.peek();
  if (isRimSheet(id)) app.world.sheetClosed(id);
  app.closeSheet();
}

/** Run a world action and hand its result to the app (toasts on failure, save soon on success). */
export function act(app: AppController, run: () => Result): Result {
  const r = run();
  app.afterAction(r);
  return r;
}

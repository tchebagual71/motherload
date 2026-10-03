// Keyboard map (03 §3.7). Pure: fed with KeyboardEvent.code strings.
// Arrows / WASD drive and dig; W / ↑ is full thrust; Space is THRUST; 1–4 are quick slots (explosives fire
// on key-up after the arm); E the context button; Esc closes a sheet or opens the menu; Tab cargo; L flips
// the look (M0); F3 or ` opens the debug menu.

type Dir = 'left' | 'right' | 'up' | 'down' | 'thrust';

const DIRS: Readonly<Record<string, Dir>> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'thrust',
};

const SLOTS: Readonly<Record<string, number>> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };

export type KeyCommand =
  | { kind: 'drive' }
  | { kind: 'slotDown'; slot: number }
  | { kind: 'slotUp'; slot: number }
  | { kind: 'escape' }
  | { kind: 'cargo' }
  | { kind: 'context' }
  | { kind: 'look' }
  | { kind: 'debug' };

const DRIVE: KeyCommand = { kind: 'drive' };
const ESCAPE: KeyCommand = { kind: 'escape' };
const CARGO: KeyCommand = { kind: 'cargo' };
const CONTEXT: KeyCommand = { kind: 'context' };
const LOOK: KeyCommand = { kind: 'look' };
const DEBUG: KeyCommand = { kind: 'debug' };

export interface KeyIntent {
  sx: number;
  sy: number;
  thrust: boolean;
}

const DIAG = Math.SQRT1_2;

export class KeyboardState {
  /** Held drive codes, and how many of them press each direction (← and A may both be down). */
  private readonly held = new Set<string>();
  private readonly count: Record<Dir, number> = { left: 0, right: 0, up: 0, down: 0, thrust: 0 };

  /** Returns the command for a key press, or null if the key is not mapped / is an auto-repeat. */
  keyDown(code: string, repeat: boolean): KeyCommand | null {
    if (Object.hasOwn(DIRS, code)) {
      if (!this.held.has(code)) {
        this.held.add(code);
        this.count[DIRS[code]]++;
      }
      return DRIVE;
    }
    if (repeat) return null;
    if (Object.hasOwn(SLOTS, code)) return { kind: 'slotDown', slot: SLOTS[code] };
    switch (code) {
      case 'Escape':
        return ESCAPE;
      case 'Tab':
        return CARGO;
      case 'KeyE':
        return CONTEXT;
      case 'KeyL':
        return LOOK;
      case 'F3':
      case 'Backquote':
        return DEBUG;
      default:
        return null;
    }
  }

  keyUp(code: string): KeyCommand | null {
    if (Object.hasOwn(DIRS, code)) {
      if (this.held.delete(code)) this.count[DIRS[code]]--;
      return DRIVE;
    }
    if (Object.hasOwn(SLOTS, code)) return { kind: 'slotUp', slot: SLOTS[code] };
    return null;
  }

  /** True while any drive/thrust key is held. */
  get active(): boolean {
    return this.held.size > 0;
  }

  /** Writes the keyboard's stick-equivalent into `out` (no allocation). */
  intent(out: KeyIntent): KeyIntent {
    const x = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    const y = (this.isHeld('up') ? 1 : 0) - (this.isHeld('down') ? 1 : 0);
    const k = x !== 0 && y !== 0 ? DIAG : 1;
    out.sx = x * k;
    out.sy = y * k;
    // W / ↑ is full thrust (s_t = 1) even on a diagonal; Space is the THRUST key.
    out.thrust = this.isHeld('thrust') || y > 0;
    return out;
  }

  clear(): void {
    this.held.clear();
    this.count.left = this.count.right = this.count.up = this.count.down = this.count.thrust = 0;
  }

  private isHeld(dir: Dir): boolean {
    return this.count[dir] > 0;
  }
}

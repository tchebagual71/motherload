// Build-mode glyphs on the 24-pt, 2-pt-stroke grid of ui/icons.tsx (03 §10.4): dock tools and building cards.
import type { JSX } from 'preact';
import type { BuildingKind } from '../../factory/api';

const PATHS = {
  done: 'M6 6l12 12M18 6L6 18',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  pan: 'M8 13V6a1.5 1.5 0 0 1 3 0v6M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.6 0-4-1.4-5.4-3.4L3.8 13a1.5 1.5 0 0 1 2.4-1.8L8 13.5',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4',
  bulldoze: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  ok: 'M5 12l5 5 9-10',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  yaw: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  overlay: 'M4 4h16v16H4zM4 12h16M12 4v16',
  lmode: 'M6 4v14h12',
  flip: 'M7 20V4M3 8l4-4 4 4M17 4v16M13 16l4 4 4-4',
  route: 'M12 21V5M7 9l5-5 5 5M8 21h8',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  kits: 'M4 8h16v12H4zM9 8V5h6v3M4 13h16',
  // building cards
  belt: 'M3 9h18v6H3zM7 10.5l2 1.5-2 1.5M12 10.5l2 1.5-2 1.5M17 10.5l2 1.5-2 1.5',
  router: 'M12 3l9 9-9 9-9-9zM12 8v8M8 12h8',
  bin: 'M4 7h16v13H4zM4 7l2-3h12l2 3M9 12h6',
  smelter: 'M5 21V9l7-5 7 5v12zM9 21v-5h6v5M10 12h4',
  assembler: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  export: 'M3 7h11v10H3zM14 10h4l3 3v4h-7M7 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  headframe: 'M5 21L12 4l7 17M8 14h8M12 4v17M3 21h18',
  autoDrill: 'M7 3h10v6H7zM9 9h6l-3 12zM10 13h4',
  lift: 'M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8',
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 22, class: cls }: { name: GlyphName; size?: number; class?: string }): JSX.Element {
  return (
    <svg
      class={cls ? `hf-icon ${cls}` : 'hf-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Card glyph for a building (unknown kinds fall back to the Kit box). */
export function kindGlyph(kind: BuildingKind | 'bulldoze'): GlyphName {
  return kind in PATHS ? (kind as GlyphName) : 'kits';
}

/** 03 §8.6 role colours: Logistics mustard, Extraction orange, Processing coral, Assembly teal, Storage lilac. */
export function roleColour(kind: BuildingKind | 'bulldoze'): string {
  switch (kind) {
    case 'belt':
    case 'router':
    case 'lift':
    case 'headframe':
    case 'chute':
      return '#F6C343';
    case 'autoDrill':
    case 'magmaTap':
    case 'gasTap':
      return '#FF7A3D';
    case 'smelter':
    case 'refinery':
    case 'gemCutter':
      return '#FF5A4E';
    case 'assembler':
    case 'podWorks':
      return '#2EC4B6';
    case 'bin':
    case 'silo':
    case 'export':
    case 'depot':
      return '#9B7BFF';
    case 'bulldoze':
      return '#FF4D5E';
    default:
      return '#B8A27A';
  }
}

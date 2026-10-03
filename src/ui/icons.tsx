// Inline SVG icons on a 24-pt grid with a 2-pt stroke (03 §10.4). No external sprite yet.
import type { JSX } from 'preact';

const PATHS = {
  fuel: 'M7 3h7l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v3h5M9 12h6M12 9v6',
  hull: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6zM12 8v8M8 12h8',
  cargo: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
  warn: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  pump: 'M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M7 7h6v4H7zM15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3',
  assay: 'M12 3v18M5 21h14M4 8h16M7 8l-3 7a3 3 0 0 0 6 0zM17 8l-3 7a3 3 0 0 0 6 0z',
  garage: 'M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3-3 6.5-6.5M3 21l6-6M9.5 9.5a4 4 0 0 1-5-5L7 7l2-2-2.5-2.5a4 4 0 0 1 5 5',
  shed: 'M3 10l9-6 9 6v11H3zM8 21v-7h8v7M8 17h8',
  pop: 'M11 9a6 6 0 1 0 2 0M12 9V6M12 6l2-2M15 3h2M17 6l1 1',
  megaPop: 'M11 8a7 7 0 1 0 2 0M12 8V5M12 5l2-2M15 2h2M17 5l1 1M9 14h6',
  jerrycan: 'M6 5h9l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 5V3h4v2M8 11l8 7M16 11l-8 7',
  patchKit: 'M4 8h16v11H4zM9 8V5h6v3M12 11v5M9.5 13.5h5',
  hopBeacon: 'M12 3v12M7 8l5-5 5 5M6 21h12M9 21l3-6 3 6',
  homingBeacon: 'M3 11l9-8 9 8M5 9.5V21h14V9.5M10 21v-6h4v6',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  pause: 'M8 5v14M16 5v14',
  share: 'M12 15V3M8 7l4-4 4 4M5 11v9h14v-9',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  play: 'M7 4l13 8-13 8z',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5',
  bug: 'M8 9h8v7a4 4 0 0 1-8 0zM9 9V7a3 3 0 0 1 6 0v2M4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 19l3-2M19 19l-3-2',
  drill: 'M4 10h9l7 2-7 2H4zM7 10V7M10 10V7M4 17h6',
  engine: 'M4 9h3l2-3h6l2 3h3v8h-3l-2 2H9l-2-2H4zM12 9v6M9 12h6',
  tank: 'M7 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 12h14M9 4V2h6v2',
  radiator: 'M4 5h16v14H4zM8 5v14M12 5v14M16 5v14',
  bay: 'M3 8h18v12H3zM3 8l3-4h12l3 4M9 12h6',
  scanner: 'M12 21a9 9 0 0 0 9-9M12 17a5 5 0 0 0 5-5M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 12L5 5',
  check: 'M5 12l5 5 9-10',
  upright: 'M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM20 8a8 8 0 0 1 0 8M4 16a8 8 0 0 1 0-8',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.5 9a2.5 2 0 0 0-5 0c0 2.5 5 1.5 5 4.5a2.5 2 0 0 1-5 0M12 6v1.5M12 16.5V18',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  flip: 'M7 20V4M3 8l4-4 4 4M17 4v16M13 16l4 4 4-4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, class: cls }: { name: IconName; size?: number; class?: string }): JSX.Element {
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

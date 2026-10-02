// 40-pt sender avatars for radio cards (03 §6.5): Dot's headset portrait, Channel Zero's oscilloscope trace,
// the Deepreach Recorder reel, Marlow's visor, the Surveyor's theodolite eye. Inline SVG placeholders until
// the 160 × 160 portraits land (03 §10.1).
import type { JSX } from 'preact';
import type { Sender } from '../../story';

function Dot(): JSX.Element {
  return (
    <>
      <circle cx="20" cy="20" r="19" fill="#F4D9B8" />
      <path d="M8 22c0-9 5-15 12-15s12 6 12 15" fill="#8A4B2A" />
      <circle cx="20" cy="22" r="9" fill="#F2C9A0" />
      <circle cx="16.5" cy="21" r="1.3" fill="#2B1E2F" />
      <circle cx="23.5" cy="21" r="1.3" fill="#2B1E2F" />
      <path d="M16.5 25.5c2 1.6 5 1.6 7 0" stroke="#2B1E2F" stroke-width="1.4" fill="none" stroke-linecap="round" />
      <path d="M9 22a11 11 0 0 1 22 0" stroke="#2B1E2F" stroke-width="2.2" fill="none" />
      <rect x="6.5" y="20" width="4" height="7" rx="2" fill="#2EC4B6" stroke="#2B1E2F" stroke-width="1.2" />
      <path d="M9 27c0 4 3 6 7 6" stroke="#2B1E2F" stroke-width="1.6" fill="none" stroke-linecap="round" />
      <circle cx="16.5" cy="33" r="1.6" fill="#2B1E2F" />
    </>
  );
}

function ChannelZero(): JSX.Element {
  return (
    <>
      <rect x="1" y="1" width="38" height="38" rx="8" fill="#0B0F0C" stroke="#7CFFB0" stroke-opacity="0.5" />
      <path d="M1 20h38M20 1v38" stroke="#7CFFB0" stroke-opacity="0.18" />
      <path d="M4 20h6l2-9 3 18 3-14 2 5h4l2-3 2 3h8" stroke="#7CFFB0" stroke-width="2" fill="none" stroke-linejoin="round" class="hf-av-trace" />
    </>
  );
}

function Recorder(): JSX.Element {
  return (
    <>
      <rect x="1" y="5" width="38" height="30" rx="5" fill="#E9DFC7" stroke="#6B5A6E" stroke-width="1.5" />
      <g class="hf-av-reel">
        <circle cx="12.5" cy="18" r="6.5" fill="none" stroke="#2B1E2F" stroke-width="2" />
        <path d="M12.5 11.5v13M6 18h13" stroke="#2B1E2F" stroke-width="1.4" />
      </g>
      <g class="hf-av-reel">
        <circle cx="27.5" cy="18" r="6.5" fill="none" stroke="#2B1E2F" stroke-width="2" />
        <path d="M27.5 11.5v13M21 18h13" stroke="#2B1E2F" stroke-width="1.4" />
      </g>
      <path d="M8 30h24" stroke="#6B5A6E" stroke-width="2" stroke-linecap="round" />
    </>
  );
}

function Marlow(): JSX.Element {
  return (
    <>
      <circle cx="20" cy="20" r="19" fill="#E8DDB5" />
      <rect x="7" y="13" width="26" height="14" rx="7" fill="#4A3F55" />
      <path d="M11 17l6 6M22 16l7 8" stroke="#E8DDB5" stroke-opacity="0.6" stroke-width="1.4" />
    </>
  );
}

function Surveyor(): JSX.Element {
  return (
    <>
      <circle cx="20" cy="20" r="19" fill="#2A1830" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="#E8C27A" stroke-width="2" />
      <circle cx="20" cy="20" r="4" fill="#E8C27A" />
      <path d="M20 4v6M20 30v6M4 20h6M30 20h6" stroke="#E8C27A" stroke-width="1.5" />
    </>
  );
}

const FACES: Record<Sender, () => JSX.Element> = {
  Dot,
  'Channel Zero': ChannelZero,
  'Deepreach log': Recorder,
  Marlow,
  'the Surveyor': Surveyor,
};

export function Avatar({ sender, size = 40 }: { sender: Sender; size?: number }): JSX.Element {
  const Face = FACES[sender];
  return (
    <svg class="hf-avatar" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <Face />
    </svg>
  );
}

/** CSS modifier for a sender's card style. */
export function senderClass(sender: Sender): string {
  switch (sender) {
    case 'Dot':
      return 'hf-tx-dot';
    case 'Channel Zero':
      return 'hf-tx-zero';
    case 'Deepreach log':
      return 'hf-tx-log';
    case 'Marlow':
      return 'hf-tx-marlow';
    case 'the Surveyor':
      return 'hf-tx-surveyor';
  }
}

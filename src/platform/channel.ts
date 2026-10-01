// Release channel (04 §4.10): prefixes every origin-scoped name (IndexedDB stores, localStorage keys) so dev,
// prod and e2e runs on a shared origin never read each other's saves.

export type Channel = 'prod' | 'dev' | 'test';

let cached: Channel | null = null;

function fromEnv(): Channel | null {
  const v = import.meta.env.VITE_CHANNEL as string | undefined;
  return v === 'prod' || v === 'dev' || v === 'test' ? v : null;
}

/** `?test=1` always isolates into the `test` channel; otherwise VITE_CHANNEL, else dev/prod by build mode. */
export function resolveChannel(search: string = typeof location === 'undefined' ? '' : location.search): Channel {
  if (new URLSearchParams(search).get('test') === '1') return 'test';
  return fromEnv() ?? (import.meta.env.DEV ? 'dev' : 'prod');
}

export function channel(): Channel {
  cached ??= resolveChannel();
  return cached;
}

/** localStorage key for this channel: `hf-<ch>.<name>`. */
export function lsKey(name: string, ch: Channel = channel()): string {
  return `hf-${ch}.${name}`;
}

// Safe Web Storage access: private mode, blocked site data and quota errors must never break boot.

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

function storageOf(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window[kind];
  } catch {
    return null;
  }
}

function wrap(kind: 'localStorage' | 'sessionStorage'): KeyValue {
  return {
    get(key) {
      try {
        return storageOf(kind)?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        const s = storageOf(kind);
        if (!s) return false;
        s.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        storageOf(kind)?.removeItem(key);
      } catch {
        // Nothing to do: the key simply stays.
      }
    },
  };
}

export const local: KeyValue = wrap('localStorage');
export const session: KeyValue = wrap('sessionStorage');

/** In-memory KeyValue (tests, or when storage is unavailable). */
export function memoryKeyValue(seed: Record<string, string> = {}): KeyValue {
  const m = new Map(Object.entries(seed));
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => (m.set(k, v), true),
    remove: (k) => void m.delete(k),
  };
}

export function readJson<T>(kv: KeyValue, key: string): T | null {
  const raw = kv.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(kv: KeyValue, key: string, value: unknown): boolean {
  return kv.set(key, JSON.stringify(value));
}

/** Ask the browser not to evict our IndexedDB (canon §3.15: after the first save). Never throws. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

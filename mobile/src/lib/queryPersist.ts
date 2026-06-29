/**
 * Lightweight offline cache — persist last-seen server data so the dashboard/app/
 * run render instantly offline, with an HONEST staleness label. Cached data is
 * NEVER presented as a live read: `stalenessLabel` always says "cached · …".
 *
 * Storage is injected (AsyncStorage in the app), so this tests headlessly.
 */
export type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type Snapshot<T> = { savedAt: number; data: T };

const PREFIX = "shipaso.cache.";

export async function saveSnapshot<T>(storage: StorageLike, key: string, data: T, now: number): Promise<void> {
  const snap: Snapshot<T> = { savedAt: now, data };
  await storage.setItem(PREFIX + key, JSON.stringify(snap));
}

export async function loadSnapshot<T>(storage: StorageLike, key: string): Promise<Snapshot<T> | null> {
  const raw = await storage.getItem(PREFIX + key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Snapshot<T>;
    if (typeof parsed?.savedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearSnapshot(storage: StorageLike, key: string): Promise<void> {
  await storage.removeItem(PREFIX + key);
}

/**
 * Honest label for cached data. NEVER returns "live" — a snapshot is by
 * definition not a fresh read. Used to render a "cached · 3m ago" badge so the
 * user always knows they're not looking at a measured-now value.
 */
export function stalenessLabel(savedAt: number, now: number, online: boolean): string {
  const secs = Math.max(0, Math.floor((now - savedAt) / 1000));
  const ago = secs < 60 ? "just now" : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`;
  return online ? `cached · ${ago}` : `offline · cached ${ago}`;
}

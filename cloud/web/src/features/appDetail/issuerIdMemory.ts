/**
 * Remembers the last App Store Connect Issuer ID so the connect form can
 * pre-fill it. The Issuer ID is a non-secret UUID identifying the Apple team —
 * safe to persist. The .p8 secret is NEVER stored here.
 *
 * Storage access is guarded (private mode / SSR / disabled storage) and
 * degrades to "" / no-op rather than throwing — matches ThemeToggle's pattern.
 */
const KEY = "store-ops:asc.issuerId";

export function readIssuerId(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeIssuerId(value: string): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* ignore */
  }
}

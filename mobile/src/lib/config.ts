/**
 * Runtime config — the API base URL, read from `app.config.ts` `extra.apiBase`
 * via expo-constants (mirrors the web's `config.js`). Falls back to the
 * production API so a misconfigured build still points somewhere sane.
 */
import Constants from "expo-constants";

const DEFAULT_API_BASE = "https://api.shipaso.com";

export function apiBase(): string {
  const extra = Constants.expoConfig?.extra as { apiBase?: string } | undefined;
  return extra?.apiBase ?? DEFAULT_API_BASE;
}

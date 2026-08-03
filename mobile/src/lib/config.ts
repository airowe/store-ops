/**
 * Runtime config — the API base URL, read from `app.config.ts` `extra.apiBase`
 * via expo-constants (mirrors the web's `config.js`). Falls back to the
 * production API so a misconfigured build still points somewhere sane.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

const DEFAULT_API_BASE = "https://api.shipaso.com";

export function apiBase(): string {
  const extra = Constants.expoConfig?.extra as { apiBase?: string } | undefined;
  return extra?.apiBase ?? DEFAULT_API_BASE;
}

/**
 * The RevenueCat PUBLIC SDK key for the current platform, from
 * `app.config.ts` `extra.revenueCat.{ios,android}`. Returns null when unset (no
 * RevenueCat provisioned yet — Workstream A) so the paywall degrades to an
 * "unavailable" state instead of crashing. Public SDK keys are not secrets.
 */
export function revenueCatApiKey(): string | null {
  const extra = Constants.expoConfig?.extra as
    | { revenueCat?: { ios?: string; android?: string } }
    | undefined;
  const keys = extra?.revenueCat;
  if (!keys) return null;
  const key = Platform.OS === "android" ? keys.android : keys.ios;
  return key && key.length > 0 ? key : null;
}

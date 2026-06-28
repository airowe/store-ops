/**
 * The two concrete `StoreProfile`s — the single source of truth for how the App
 * Store and Google Play differ in their metadata + ranking models, plus small
 * pure query helpers the shared engine uses to stay store-agnostic.
 *
 * iOS char budgets come from `CHAR_LIMITS` (the existing source of truth);
 * Play's budgets live HERE on its profile (Play is not iOS — its limits are its
 * own). See `docs/prd/google-play/00-implementation-plan.md` §2.
 */
import { CHAR_LIMITS } from "../constants.js";
import type {
  DeviceFamily,
  RankingSurface,
  StoreId,
  StoreProfile,
  SurfaceRole,
} from "./types.js";

/**
 * Google Play field char budgets (HARD limits, like iOS `CHAR_LIMITS`):
 *   • title             ≤ 30
 *   • short description ≤ 80
 *   • full description  ≤ 4000  (this is the SEARCH-INDEXED keyword surface)
 * Play has NO comma keyword field — there is deliberately no entry for one.
 */
export const PLAY_CHAR_LIMITS = {
  title: 30,
  shortDescription: 80,
  description: 4000,
} as const;

/**
 * App Store profile. NOTE: iOS does NOT index the description/promo for search
 * (`indexed:false`) — only name/subtitle/keywords feed ranking. This is the
 * inverse of Play, where the long description IS the keyword surface.
 */
export const APP_STORE_PROFILE: StoreProfile = {
  id: "appstore",
  hasKeywordField: true,
  fields: [
    { field: "name", limit: CHAR_LIMITS.name, indexed: true, role: "title" },
    { field: "subtitle", limit: CHAR_LIMITS.subtitle, indexed: true, role: "tagline" },
    { field: "keywords", limit: CHAR_LIMITS.keywords, indexed: true, role: "keywordfield" },
    { field: "promo", limit: CHAR_LIMITS.promo, indexed: false, role: "longform" },
    { field: "description", limit: CHAR_LIMITS.description, indexed: false, role: "longform" },
  ],
  deviceFamilies: [
    { key: "iphone", primary: true, label: "iPhone" },
    { key: "ipad", primary: false, label: "iPad" },
  ],
  fastlaneTool: "deliver",
};

/**
 * Google Play profile. The three Android truths that must not be ported blindly
 * from iOS are encoded here:
 *   1. `hasKeywordField:false` — there is NO comma keyword field.
 *   2. the long `description` is `indexed:true` — it IS the keyword surface.
 *   3. device families are phone / 7" / 10" tablet — there is no iPad family.
 */
export const GOOGLE_PLAY_PROFILE: StoreProfile = {
  id: "googleplay",
  hasKeywordField: false,
  fields: [
    { field: "title", limit: PLAY_CHAR_LIMITS.title, indexed: true, role: "title" },
    {
      field: "shortDescription",
      limit: PLAY_CHAR_LIMITS.shortDescription,
      indexed: true,
      role: "tagline",
    },
    { field: "description", limit: PLAY_CHAR_LIMITS.description, indexed: true, role: "longform" },
  ],
  deviceFamilies: [
    { key: "phone", primary: true, label: "Phone" },
    { key: "tablet7", primary: false, label: '7" tablet' },
    { key: "tablet10", primary: false, label: '10" tablet' },
  ],
  fastlaneTool: "supply",
};

/** Lookup table + accessor so callers resolve a profile from a `StoreId`. */
export const STORE_PROFILES: Record<StoreId, StoreProfile> = {
  appstore: APP_STORE_PROFILE,
  googleplay: GOOGLE_PLAY_PROFILE,
};

/** The profile for a store. */
export function profileFor(store: StoreId): StoreProfile {
  return STORE_PROFILES[store];
}

// ── Pure query helpers (so shared logic keys off the profile, not iOS literals) ─

/** The surface for a store-specific field name, or undefined if absent. */
export function getSurface(profile: StoreProfile, field: string): RankingSurface | undefined {
  return profile.fields.find((f) => f.field === field);
}

/** All surfaces playing a given ranking role (e.g. every `longform` field). */
export function surfacesByRole(profile: StoreProfile, role: SurfaceRole): RankingSurface[] {
  return profile.fields.filter((f) => f.role === role);
}

/** The single surface for a role, or undefined (title/tagline/keywordfield are 1:1). */
export function surfaceByRole(profile: StoreProfile, role: SurfaceRole): RankingSurface | undefined {
  return profile.fields.find((f) => f.role === role);
}

/** The search-INDEXED surfaces — what "your metadata" means for keyword analysis. */
export function indexedSurfaces(profile: StoreProfile): RankingSurface[] {
  return profile.fields.filter((f) => f.indexed);
}

/** The most-shown device family (drives the screenshot count budget). */
export function primaryDeviceFamily(profile: StoreProfile): DeviceFamily | undefined {
  return profile.deviceFamilies.find((d) => d.primary);
}

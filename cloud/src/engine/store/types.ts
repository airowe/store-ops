/**
 * Store abstraction — the seam that lets one engine serve BOTH the App Store and
 * Google Play without forking the shared logic (coverage, screenshot scoring,
 * keyword/intent grounding). See `docs/prd/google-play/00-implementation-plan.md`.
 *
 * Two ideas live here:
 *   • a STATIC `StoreProfile` describing a store's metadata + ranking model
 *     (which fields exist, their char budgets, whether each is search-indexed,
 *     the device families for screenshot scoring) — NO per-app data; and
 *   • a `NormalizedListing` the shared engine reads, with an HONEST tri-state on
 *     every text field: a string (incl. "") is MEASURED; `null` is UNREAD /
 *     UNMEASURED. This is the load-bearing honesty contract (constraint #1):
 *     the engine must never present an unread field as an empty one.
 *
 * Pure types only (plus a `StoreAdapter` interface). Concrete adapters and the
 * data sources they call are injected from the API layer, exactly like `FetchFn`,
 * so the whole engine still unit-tests with zero network.
 */
import type { ResolveResult } from "../resolveApp.js";

/** The stores we model. */
export type StoreId = "appstore" | "googleplay";

/**
 * The ranking ROLE a metadata field plays, abstracted across stores:
 *   • title       — the heaviest-weighted short field (iOS name / Play title)
 *   • tagline      — the secondary short field (iOS subtitle / Play short desc)
 *   • keywordfield — a dedicated comma keyword field (iOS ONLY; Play has none)
 *   • longform    — free prose (iOS promo/description; Play long description)
 * Shared logic keys off the ROLE, never the store-specific field name.
 */
export type SurfaceRole = "title" | "tagline" | "keywordfield" | "longform";

/** A metadata field a store exposes, with its budget and ranking role. */
export type RankingSurface = {
  /** the store's own field name, e.g. "subtitle" | "shortDescription". */
  field: string;
  /** hard character budget — never emit copy over this. */
  limit: number;
  /** does the store index this field for SEARCH ranking? */
  indexed: boolean;
  role: SurfaceRole;
};

/**
 * A screenshot device family for coverage scoring. `primary` marks the
 * most-shown family (drives the count budget); the rest are coverage bonuses.
 * iOS: iphone(primary)/ipad. Play: phone(primary)/tablet7/tablet10. NO iPad on
 * Play — the families are intentionally store-specific (don't port iOS blindly).
 */
export type DeviceFamily = {
  /** stable key the NormalizedListing's screenshot groups join on. */
  key: string;
  primary: boolean;
  label: string;
};

/** Static description of a store's metadata + ranking model. No per-app data. */
export type StoreProfile = {
  id: StoreId;
  fields: readonly RankingSurface[];
  /** iOS: true. Play: FALSE — Play has no keyword field (the key difference). */
  hasKeywordField: boolean;
  deviceFamilies: readonly DeviceFamily[];
  /** the fastlane subcommand this store's metadata handoff targets. */
  fastlaneTool: "deliver" | "supply";
};

/** A device family's screenshot URLs, joined to a `DeviceFamily.key`. */
export type ScreenshotGroup = {
  family: string;
  urls: string[];
};

/**
 * A store-agnostic listing the shared engine reads. HONEST tri-state on every
 * text field: a string (incl. "") = MEASURED; `null` = UNREAD / UNMEASURED.
 * `keywordField` is ALWAYS null for Google Play — Play has no keyword field, so
 * it is *absent*, never "empty" (the UI must not render it as a 0/100 field).
 */
export type NormalizedListing = {
  store: StoreId;
  /** bundleId (iOS) / packageName (Play). */
  appId: string;
  title: string | null;
  /** subtitle (iOS) / short description (Play). */
  tagline: string | null;
  /** iOS keyword field; ALWAYS null on Play. */
  keywordField: string | null;
  longDescription: string | null;
  screenshots: ScreenshotGroup[];
  category: { id: string; name: string | null } | null;
  /**
   * Is this source trustworthy for ABSENCE? `false` (the public/licensed tier)
   * means an empty screenshot/field set is UNKNOWN, not zero — the same #41
   * discipline the iOS public-data path already uses (`dataReliable:false`).
   */
  reliable: boolean;
};

/**
 * The per-store plug: resolve a query → candidates, and read a listing →
 * NormalizedListing. Injected from the API layer (like `FetchFn`), so the engine
 * never hard-codes a data provider and stays unit-testable with a fake.
 */
export type StoreAdapter = {
  profile: StoreProfile;
  resolve(query: string, opts?: { country?: string; offset?: number }): Promise<ResolveResult>;
  readListing(appId: string, opts?: { country?: string }): Promise<NormalizedListing>;
};

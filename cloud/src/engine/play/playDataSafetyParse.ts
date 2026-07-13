/**
 * Google Play "Data safety" section — the PARSE half (pure, network-free).
 *
 * The data-safety page (`/store/apps/datasafety?id=…`) has NO ld+json; its data
 * lives in the page's `AF_initDataCallback({... data: [...] })` blobs. Rather than
 * walk fragile positional `ds:` indices (which the listing parser deliberately
 * avoids — a wrong index silently fabricates data, violating honesty), we read
 * these blobs by CONTENT against Google's FIXED, published vocabulary:
 *   • the ~14 Play data-safety data-type labels (a stable taxonomy), and
 *   • the explicit "No data collected/shared" markers,
 * plus the external privacy-policy URL. Matching known strings is drift-tolerant
 * (it survives Google renumbering the arrays) and honest (every field is a
 * tri-state: a value, or `null`/`[]` = UNMEASURED, never invented).
 *
 * `reliable:false` throughout — this is scraped public data, so absence is
 * UNKNOWN, never zero.
 */

/** Google's published Play data-safety data-type categories (the fixed taxonomy). */
export const PLAY_DATA_SAFETY_TYPES = [
  "Location",
  "Personal info",
  "Financial info",
  "Health and fitness",
  "Messages",
  "Photos and videos",
  "Audio",
  "Files and docs",
  "Calendar",
  "Contacts",
  "App activity",
  "Web browsing",
  "App info and performance",
  "Device or other IDs",
] as const;

export type PlayDataSafety = {
  packageName: string;
  /** external privacy-policy URL found in the data-safety blob, else null. */
  privacyPolicyUrl: string | null;
  /** true = declares collection, false = "No data collected", null = UNKNOWN. */
  declaresCollection: boolean | null;
  /** true = declares sharing, false = "No data shared", null = UNKNOWN. */
  declaresSharing: boolean | null;
  /** known category labels found in the declaration (content-matched). */
  dataTypes: string[];
  /** scraped public data → an empty/absent field is UNKNOWN, not zero. */
  reliable: false;
};

/** Pull every `AF_initDataCallback({...})` payload's `data:` array, JSON-parsed. */
export function extractAfBlobs(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /AF_initDataCallback\(\s*\{([\s\S]*?)\}\s*\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const obj = m[1] ?? "";
    // The payload has `data:<json>, sideChannel:...`; grab the data: array/obj.
    const dataMatch = /data\s*:\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*,\s*sideChannel/.exec(obj);
    const raw = dataMatch?.[1];
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // skip malformed block — a partial page still yields what it can
    }
  }
  return out;
}

/** Collect every leaf string in a nested structure (order-preserving). */
function leafStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const el of v) leafStrings(el, out);
  else if (v && typeof v === "object") for (const el of Object.values(v)) leafStrings(el, out);
  return out;
}

/** An external (non-Google) https URL — the app's privacy policy, when present. */
function isExternalPolicyUrl(s: string): boolean {
  if (!/^https?:\/\//i.test(s)) return false;
  return !/(^https?:\/\/)?([a-z0-9-]+\.)*(google\.com|gstatic\.com|googleapis\.com|youtube\.com|schema\.org|play\.google\.com)/i.test(
    s,
  );
}

/**
 * Parse a data-safety page's HTML into `PlayDataSafety`, by CONTENT. Honest
 * tri-state: a signal we can positively observe is set; anything we can't read is
 * `null`/`[]` (UNKNOWN), never fabricated. Pure + deterministic.
 */
export function parsePlayDataSafety(html: string, packageName: string): PlayDataSafety {
  const strings = extractAfBlobs(html).flatMap((b) => leafStrings(b));
  const hay = strings.join("\n");

  const privacyPolicyUrl = strings.find(isExternalPolicyUrl) ?? null;

  // Explicit empty-state markers Google renders for a no-data declaration.
  const saysNoCollected = /no data (is )?collected/i.test(hay);
  const saysNoShared = /no data (is )?shared/i.test(hay);

  const dataTypes = PLAY_DATA_SAFETY_TYPES.filter((t) =>
    strings.some((s) => s.trim().toLowerCase() === t.toLowerCase()),
  );

  // declaresCollection: true if we positively see data types, false if we see the
  // explicit "no data collected" marker, else UNKNOWN (null). Never guess.
  const declaresCollection = dataTypes.length > 0 ? true : saysNoCollected ? false : null;
  const declaresSharing = saysNoShared ? false : null;

  return {
    packageName,
    privacyPolicyUrl,
    declaresCollection,
    declaresSharing,
    dataTypes,
    reliable: false,
  };
}

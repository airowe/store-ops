/**
 * "Our own" Google Play data provider — the PARSE half (pure, network-free).
 *
 * Extracts a Play listing from the page's STANDARDS-BASED surface — the embedded
 * `application/ld+json` `SoftwareApplication` block (schema.org) plus Open Graph
 * `<meta>` tags. We deliberately read THIS rather than the undocumented
 * positional `ds:` / `AF_initDataCallback` arrays: the schema.org/OG format is a
 * documented standard, far more stable, and — critically — lets us write a
 * parser we can be HONEST about. Guessing fragile array indices would risk
 * silently-wrong data, which violates the product's honesty constraint.
 *
 * Honesty contract (constraint #1): every field is a tri-state — a value when
 * the page actually carried it, else `null` (UNMEASURED). We never invent.
 *
 * NOT covered here (needs a captured real fixture; deferred, never faked):
 *   • the separate 80-char short description (lives in the `ds:` blobs)
 *   • per-device-family screenshots (ld+json `screenshot` is a flat list)
 */

/** The raw, store-shaped fields we can honestly read from a Play detail page. */
export type PlayDetailRaw = {
  packageName: string;
  /** app title (ld+json name → og:title). */
  title: string | null;
  /** the long description (ld+json description → og:description). */
  description: string | null;
  /** icon URL (ld+json image → og:image). */
  icon: string | null;
  /** screenshot URLs (ld+json `screenshot`), flat — no device family split. */
  screenshots: string[];
  /** applicationCategory / genre, verbatim (e.g. "MUSIC_AND_AUDIO"). */
  category: string | null;
  /** rating value, when published — never fabricated. */
  ratingValue: number | null;
  /** rating/review count, when published. */
  ratingCount: number | null;
  /** price as published (often "0" for free); shown verbatim, never inferred. */
  price: string | null;
  priceCurrency: string | null;
};

/** Decode the handful of HTML entities that show up in meta `content` values. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

/** A trimmed non-empty string, or null (so "" reads as absent, never measured-empty). */
function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number") return String(v);
  return null;
}

/** A finite number from a string|number, else null (never a fabricated 0). */
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Coerce a string | string[] (schema.org allows either) into a clean string[]. */
function arrStr(v: unknown): string[] {
  const items = Array.isArray(v) ? v : v == null ? [] : [v];
  return items.map(str).filter((s): s is string => s !== null);
}

/**
 * Pull every `application/ld+json` block out of the page and JSON.parse each.
 * Malformed blocks are skipped (never throw) — a partial page still yields what
 * it can.
 */
export function extractLdJson(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // skip malformed block
    }
  }
  return out;
}

/** Parse `<meta property|name="..." content="...">` tags into a lowercased map. */
export function extractOgMeta(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const prop = /(?:property|name)=["']([^"']+)["']/i.exec(tag)?.[1];
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (prop && content != null) map[prop.toLowerCase()] = decodeEntities(content);
  }
  return map;
}

/** Walk ld+json items (arrays + `@graph`) and find the SoftwareApplication node. */
function findSoftwareApplication(items: unknown[]): Record<string, unknown> | undefined {
  const flat: Record<string, unknown>[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      flat.push(o);
      if (Array.isArray(o["@graph"])) o["@graph"].forEach(visit);
    }
  };
  items.forEach(visit);
  return flat.find((o) => {
    const t = o["@type"];
    return t === "SoftwareApplication" || (Array.isArray(t) && t.includes("SoftwareApplication"));
  });
}

/**
 * Parse a Play detail page's HTML into the raw listing fields. Pure +
 * deterministic; honest tri-state on every field (null = the page didn't carry
 * it). Prefers the ld+json SoftwareApplication node, falling back to Open Graph
 * meta for the core text/image fields.
 */
export function parsePlayDetail(html: string, packageName: string): PlayDetailRaw {
  const sa = findSoftwareApplication(extractLdJson(html)) ?? {};
  const og = extractOgMeta(html);

  const offersRaw = sa["offers"];
  const offer = (Array.isArray(offersRaw) ? offersRaw[0] : offersRaw) as
    | Record<string, unknown>
    | undefined;
  const agg = sa["aggregateRating"] as Record<string, unknown> | undefined;

  return {
    packageName,
    title: str(sa["name"]) ?? str(og["og:title"]),
    description: str(sa["description"]) ?? str(og["og:description"]),
    icon: str(sa["image"]) ?? str(og["og:image"]),
    screenshots: arrStr(sa["screenshot"]),
    category: str(sa["applicationCategory"]) ?? str(sa["genre"]),
    ratingValue: num(agg?.["ratingValue"]),
    ratingCount: num(agg?.["ratingCount"] ?? agg?.["reviewCount"]),
    price: offer ? str(offer["price"]) : null,
    priceCurrency: offer ? str(offer["priceCurrency"]) : null,
  };
}

/**
 * Copy optimization + validation — enforces the HARD App Store char limits
 * (from aso_copy_stub.py LIMITS, mirrored in CHAR_LIMITS) and the keyword-field
 * rules the product guarantees:
 *   • name ≤ 30, subtitle ≤ 30, keywords ≤ 100, promo ≤ 170, description ≤ 4000
 *   • keyword field: comma-separated, NO spaces, no title/subtitle word dupes
 *
 * `validateCopy` is a pure guard the agent runs before ever proposing copy — we
 * NEVER emit over-limit copy. `buildKeywordField` constructs a compliant keyword
 * field from candidate terms; `optimizeCopy` assembles a full proposed listing
 * from bucketed keywords + a base listing.
 */
import { CHAR_LIMITS, type StoreField } from "./constants.js";
import type { ScoredKeyword } from "./keywords.js";

export type CopyFields = {
  name: string;
  subtitle: string;
  keywords: string; // the keyword FIELD (comma-joined, no spaces)
  promo?: string;
  description?: string;
};

export type FieldCheck = {
  field: StoreField;
  value: string;
  count: number;
  limit: number;
  ok: boolean;
  issues: string[];
};

export type CopyValidation = {
  pass: boolean;
  checks: FieldCheck[];
};

/** Split a keyword field into terms (comma-separated). */
function splitKeywordField(field: string): string[] {
  return field
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Lowercased word set from a phrase (for dup detection vs title/subtitle). */
function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean),
  );
}

/**
 * Validate a full set of copy fields. Returns pass/fail plus a per-field
 * breakdown with char counts and any rule violations. NEVER mutates input.
 */
export function validateCopy(fields: CopyFields): CopyValidation {
  const checks: FieldCheck[] = [];

  const simple = (field: StoreField, value: string): FieldCheck => {
    const limit = CHAR_LIMITS[field];
    const issues: string[] = [];
    if (value.length > limit) {
      issues.push(`over limit by ${value.length - limit} (${value.length}/${limit})`);
    }
    return { field, value, count: value.length, limit, ok: issues.length === 0, issues };
  };

  checks.push(simple("name", fields.name));
  checks.push(simple("subtitle", fields.subtitle));

  // keyword field: length + comma-separated + NO spaces + no title/subtitle dupes
  {
    const value = fields.keywords;
    const limit = CHAR_LIMITS.keywords;
    const issues: string[] = [];
    if (value.length > limit) {
      issues.push(`over limit by ${value.length - limit} (${value.length}/${limit})`);
    }
    if (/,\s/.test(value) || /\s,/.test(value)) {
      issues.push("keyword field must be comma-separated with NO spaces around commas");
    }
    const banned = new Set([...words(fields.name), ...words(fields.subtitle)]);
    const terms = splitKeywordField(value);
    const dupes = terms.filter((t) => [...words(t)].some((w) => banned.has(w)));
    if (dupes.length) {
      issues.push(`keyword field duplicates title/subtitle word(s): ${dupes.join(", ")}`);
    }
    checks.push({
      field: "keywords",
      value,
      count: value.length,
      limit,
      ok: issues.length === 0,
      issues,
    });
  }

  if (fields.promo !== undefined) checks.push(simple("promo", fields.promo));
  if (fields.description !== undefined) checks.push(simple("description", fields.description));

  return { pass: checks.every((c) => c.ok), checks };
}

/**
 * Build a compliant keyword field from candidate terms:
 *   • drops any term whose words collide with the title/subtitle,
 *   • lowercases + de-dupes terms,
 *   • joins comma-separated with NO spaces,
 *   • greedily packs terms up to the ≤100-char limit (never over).
 */
export function buildKeywordField(
  candidates: string[],
  { name = "", subtitle = "" }: { name?: string; subtitle?: string } = {},
): string {
  const banned = new Set([...words(name), ...words(subtitle)]);
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const raw of candidates) {
    const term = raw.trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    if ([...words(term)].some((w) => banned.has(w))) continue;
    const candidate = picked.length ? `${picked.join(",")},${term}` : term;
    if (candidate.length > CHAR_LIMITS.keywords) continue;
    picked.push(term);
    seen.add(term);
  }
  return picked.join(",");
}

/** Truncate to a field's limit without splitting mid-word where avoidable. */
function fitToLimit(value: string, field: StoreField): string {
  const limit = CHAR_LIMITS[field];
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > limit * 0.6 ? cut.slice(0, lastSpace).trimEnd() : cut.trimEnd();
}

export type ProposedCopy = CopyFields & { validation: CopyValidation };

/**
 * Assemble a proposed listing from bucketed keywords + a base listing.
 * Primary anchors the name, Secondary the subtitle, Long-tail feeds the keyword
 * field. Output is guaranteed within limits (over-limit copy is never emitted).
 */
export function optimizeCopy(
  scored: ScoredKeyword[],
  base: { name: string; subtitle: string; promo?: string; description?: string },
): ProposedCopy {
  const primary = scored.filter((k) => k.bucket === "Primary").map((k) => k.keyword);
  const secondary = scored.filter((k) => k.bucket === "Secondary").map((k) => k.keyword);
  const longTail = scored.filter((k) => k.bucket === "Long-tail").map((k) => k.keyword);

  // Keep the base copy as the spine; the anchor terms inform it but we don't
  // blindly overwrite human copy — we ensure it fits and surface the anchors.
  const name = fitToLimit(base.name || (primary[0] ?? ""), "name");
  const subtitle = fitToLimit(base.subtitle || (secondary[0] ?? ""), "subtitle");
  const keywords = buildKeywordField([...longTail, ...secondary, ...primary], {
    name,
    subtitle,
  });

  const fields: CopyFields = {
    name,
    subtitle,
    keywords,
    ...(base.promo !== undefined ? { promo: fitToLimit(base.promo, "promo") } : {}),
    ...(base.description !== undefined
      ? { description: fitToLimit(base.description, "description") }
      : {}),
  };

  return { ...fields, validation: validateCopy(fields) };
}

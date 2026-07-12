/**
 * Custom Product Page "wasted surface" lens (#154 Part 1, screenshot half).
 *
 * A CPP is only worth its slot if its creative DIFFERS from the default product
 * page — a CPP whose screenshots are byte-for-byte the same assets as the default
 * is a wasted surface (it ranks/segments to nothing new). This flags that, from
 * the MEASURED asset identities Apple exposes.
 *
 * Honesty, load-bearing:
 *   • "identical" means the CPP references the SAME assets as the default — same
 *     source fileNames (or, failing that, the same asset URLs). We never guess
 *     visual similarity; only a substantiated same-asset match counts,
 *   • MEASURED-OR-ABSENT: a CPP whose screenshots we couldn't read has NO
 *     signature and emits NOTHING (never a false "identical"). Likewise if the
 *     default page's screenshots weren't read, we can't compare → silence.
 *
 * Pure + deterministic. The ASC read that produces the signatures lives in
 * ascWrite.ts (and is flagged NEEDS-LIVE-VALIDATION); this module is the
 * comparison, fully unit-testable with plain strings.
 */
import { mk } from "./findings/core.js";
import type { Finding } from "./findings/core.js";

/** One screenshot's identity signal: its source fileName, else its asset URL. */
export type ShotIdentity = { fileName?: string | undefined; imageTemplate?: string | undefined };

/**
 * A stable signature for a screenshot SET: the sorted, de-duped asset keys
 * (fileName lowercased, else the URL). Empty string when the set carries no
 * usable identity — an empty signature NEVER matches (so "both empty" is not
 * treated as "identical").
 */
export function screenshotSignature(shots: ShotIdentity[] | null | undefined): string {
  const keys = (shots ?? [])
    .map((s) => (s.fileName?.trim().toLowerCase() || s.imageTemplate || "").trim())
    .filter((k) => k.length > 0);
  if (keys.length === 0) return "";
  return [...new Set(keys)].sort().join("|");
}

/** A CPP with its read screenshot signature (undefined = couldn't read it). */
export type CppSignature = { id: string; name?: string | undefined; screenshotSig?: string | undefined };

/**
 * Flag each CPP whose screenshots are the SAME assets as the default page. A
 * null/empty default signature (default shots unread) → [] (can't compare). A
 * CPP with no read signature → skipped (never a false positive). Deterministic,
 * ordered by CPP id.
 */
export function cppIdenticalFindings(
  defaultSig: string | null | undefined,
  pages: CppSignature[],
): Finding[] {
  if (!defaultSig) return [];
  const out: Finding[] = [];
  for (const p of [...pages].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!p.screenshotSig) continue; // unread → measured-or-absent, stay silent
    if (p.screenshotSig !== defaultSig) continue; // genuinely different — good
    const label = p.name ? `“${p.name}”` : "A custom product page";
    out.push(
      mk({
        id: `cpp_identical_to_default_${p.id}`,
        surface: "customProductPages",
        severity: "warn",
        impact: "conversion",
        title: `${p.name ? `Custom Product Page “${p.name}”` : "A Custom Product Page"} reuses your default screenshots`,
        detail:
          `${label}'s screenshots are the same assets as your default product page, so the page tailors nothing — ` +
          "a CPP only earns its slot when its creative speaks to a different audience or intent.",
        fix: "Give this page its own outcome-led screenshot set for the audience it targets, or retire it.",
        evidence: "same source assets as the default page",
      }),
    );
  }
  return out;
}

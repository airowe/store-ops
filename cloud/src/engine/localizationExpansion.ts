/**
 * Localization expansion — PRD 04 (`docs/prd/ranking-features/04-localization-expansion.md`).
 *
 * A PURE, DETERMINISTIC, NETWORK-FREE function that recommends high-ROI locales for
 * an app to expand into. Each App Store locale is a SEPARATE keyword surface (its
 * own name/subtitle/keywords that rank independently); most apps ship one locale
 * and leave ranking surfaces unclaimed. We rank the candidate locales by a
 * transparent heuristic:
 *
 *     score = tierScore(large|mid|long-tail) × categoryBoost(1.0–1.3) × effortPenalty
 *
 * HARD HONESTY DISCIPLINES (carried from the suite overview + PRD):
 *  - The locale-value model is a STATIC, bundled heuristic (`locales-data.json`) —
 *    NOT live install data. We never fabricate install/revenue numbers; rationale
 *    uses market/language descriptors only.
 *  - Passive, non-causal language ("a fresh ranking surface", "high-opportunity
 *    market") — never "will rank you #1" / "will gain N installs".
 *  - Winnability over vanity: a single-locale app is pointed at large *reachable*
 *    new surfaces (the win is the unclaimed keyword field), not an unreachable
 *    incumbent term. Effort is honest.
 *  - Diminishing returns: an app already live in many locales gets few or no
 *    recommendations (saturation).
 *  - No HTTP, no Date.now, no randomness — same input → identical output.
 */
import localesData from "./locales-data.json";

export type StorefrontTier = "large" | "mid" | "long-tail";

export type LocaleRecommendation = {
  /** ASC locale code, e.g. "es-MX". */
  locale: string;
  /** Human-readable, honest reason — market/language descriptors, never numbers. */
  rationale: string;
  storefrontTier: StorefrontTier;
  /** Always false for recommendations; live locales are excluded entirely. */
  alreadyLive: boolean;
  /** "translate" = there's existing copy to translate; "new" = net-new metadata. */
  effort: "translate" | "new";
};

export type RecommendLocalesInput = {
  /** Live locales (from `readAscAllLocales` or the public listing). */
  liveLocales: string[];
  /** Primary category name (from `readAscAppInfo().primaryCategory?.name`). */
  category?: string | undefined;
};

// ── Static model shapes (bundled, never live-fetched) ────────────────────────

type LocaleEntry = {
  tier: StorefrontTier;
  language: string;
  market: string;
  reach: string;
};

type LocalesModel = {
  locales: Record<string, LocaleEntry>;
  categoryAffinity: Record<string, Record<string, number>>;
};

const MODEL = localesData as unknown as LocalesModel;

// ── Scoring knobs (transparent, tunable heuristic) ───────────────────────────

const TIER_SCORE: Record<StorefrontTier, number> = {
  large: 100,
  mid: 70,
  "long-tail": 40,
};

/** Effort penalty: translating existing copy is cheaper than authoring net-new. */
const EFFORT_PENALTY: Record<LocaleRecommendation["effort"], number> = {
  translate: 0.9,
  new: 0.7,
};

/** Caps so we never over-recommend (UI shows a subset of this). */
const MAX_RECOMMENDATIONS = 7;
const MIN_RECOMMENDATIONS_TARGET = 5;

/**
 * Saturation: once an app is live in many locales, the marginal ranking surface
 * shrinks. We taper the returned count by how many locales are already covered.
 * 1 live locale → up to 7; 7+ live → at most 3 (diminishing returns).
 */
function maxForLiveCount(liveCount: number): number {
  if (liveCount <= 1) return MAX_RECOMMENDATIONS;
  if (liveCount === 2) return 6;
  if (liveCount === 3) return 5;
  if (liveCount === 4) return 4;
  return 3; // 5+ live locales — saturation; keep it short
}

// ── Category-fit lookup ──────────────────────────────────────────────────────

/**
 * The category boost for a (category, locale) pair. Unknown category or no
 * affinity entry → 1.0 (neutral), so a missing/unknown category degrades to
 * tier-only sorting rather than crashing or skewing the list.
 */
function categoryBoost(category: string | undefined, locale: string): number {
  if (!category) return 1.0;
  const affinity = MODEL.categoryAffinity[category];
  if (!affinity) return 1.0;
  return affinity[locale] ?? 1.0;
}

// ── Rationale (honest, non-fabricated, non-causal) ───────────────────────────

const TIER_PHRASE: Record<StorefrontTier, string> = {
  large: "Large storefront",
  mid: "Mid-sized storefront",
  "long-tail": "Smaller but real storefront",
};

/**
 * Build a human rationale from market/language descriptors only. No numbers, no
 * causal claims — passive framing that names the opportunity (a fresh ranking
 * surface) without promising a rank or an install count.
 */
function buildRationale(
  entry: LocaleEntry,
  boost: number,
  category: string | undefined,
  effort: LocaleRecommendation["effort"],
): string {
  const parts: string[] = [`${TIER_PHRASE[entry.tier]} — ${entry.reach}`];
  // Category fit only when the static model gives this pair a real boost (>1.0).
  if (category && boost > 1.0) {
    parts.push(`strong fit for your ${category} category`);
  }
  parts.push(
    effort === "translate"
      ? "your existing copy can be translated to claim it"
      : "a fresh keyword surface to claim",
  );
  return `${parts.join("; ")}.`;
}

// ── Public entrypoint ────────────────────────────────────────────────────────

/**
 * The FULL, ROI-sorted candidate ranking (every non-live locale), UNBOUNDED.
 * `recommendLocales` slices this to a saturation-aware top-N; tests use the full
 * list to assert ordering invariants (a large storefront outranks a long-tail one)
 * that a truncated list could hide.
 *
 * effort is honest about the app's starting point:
 *  - a single-locale app has ONE set of copy to translate → every rec is "translate"
 *  - a multi-locale app is already authoring per-locale metadata → recs are "new"
 *    (net-new copy for the new storefront, not a translate-once job)
 */
export function rankAll(input: RecommendLocalesInput): LocaleRecommendation[] {
  const live = new Set(input.liveLocales);
  const liveCount = input.liveLocales.length;
  // One live locale = one body of copy to translate everywhere. More than one and
  // the team is already authoring per-locale, so a new storefront is net-new work.
  const effort: LocaleRecommendation["effort"] = liveCount <= 1 ? "translate" : "new";

  const scored = Object.entries(MODEL.locales)
    .filter(([code]) => !live.has(code)) // exclude already-live locales (Test 2)
    .map(([code, entry]) => {
      const boost = categoryBoost(input.category, code);
      const score = TIER_SCORE[entry.tier] * boost * EFFORT_PENALTY[effort];
      const rec: LocaleRecommendation = {
        locale: code,
        rationale: buildRationale(entry, boost, input.category, effort),
        storefrontTier: entry.tier,
        alreadyLive: false,
        effort,
      };
      return { rec, score, tier: entry.tier, code };
    });

  // Sort by score desc; deterministic tiebreak: higher tier, then locale code asc.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = TIER_SCORE[a.tier];
    const tb = TIER_SCORE[b.tier];
    if (tb !== ta) return tb - ta;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });

  return scored.map((s) => s.rec);
}

/**
 * Recommend high-ROI locales to expand into, ROI-sorted, already-live excluded.
 *
 * Returns up to `maxForLiveCount(liveLocales.length)` recommendations (5–7 for a
 * single-locale app; tapering to ≤3 once the app is broadly localized).
 */
export function recommendLocales(input: RecommendLocalesInput): LocaleRecommendation[] {
  const liveCount = input.liveLocales.length;
  const ranked = rankAll(input);

  const cap = Math.max(0, Math.min(MAX_RECOMMENDATIONS, maxForLiveCount(liveCount)));
  // Aim for at least the MIN target when the app is single-locale, but never beyond
  // the saturation cap. (The candidate pool is far larger than the cap, so the
  // single-locale path always clears MIN_RECOMMENDATIONS_TARGET.)
  const take = liveCount <= 1 ? Math.max(MIN_RECOMMENDATIONS_TARGET, cap) : cap;
  return ranked.slice(0, Math.min(take, cap, ranked.length));
}

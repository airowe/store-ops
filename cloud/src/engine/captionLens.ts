/**
 * Screenshot caption lens (#182 Phase 1) — reads the FIRST screenshot's headline
 * and flags a feature-led caption (vs. an outcome-led one). The first shot is the
 * search-results frame, so its caption is the single highest-leverage line.
 *
 * Honesty, load-bearing:
 *   • the caption is MEASURED (OCR'd from the user's real screenshot, quoted
 *     verbatim as the finding's evidence) — never invented,
 *   • the feature-vs-outcome call is a HEURISTIC, labelled as one ("flagged, not
 *     a verdict"), and the conversion claim is a CITED public PPO result, not our
 *     own metric,
 *   • measured-or-absent: an outcome-led or UNCLEAR caption, an unreadable shot,
 *     or no OCR (flag off / no AI) emits NOTHING — never a fake flag.
 *
 * The OCR+classification is INJECTED (a CaptionAnalyzer, env.AI-backed in the API
 * adapter) so this module is pure and unit-testable with a fake analyzer.
 */
import type { Finding } from "./findings/core.js";

/** One first-screenshot caption read: the measured text + a heuristic style. */
export type CaptionAnalysis = {
  /** the OCR'd headline of the first screenshot (measured, quoted verbatim). */
  caption: string;
  /** heuristic style of that headline. */
  style: "outcome" | "feature" | "unclear";
};

/** Reads + classifies the first screenshot's caption. Returns null on any failure. */
export type CaptionAnalyzer = (imageUrl: string) => Promise<CaptionAnalysis | null>;

const CITED = "Public Product Page Optimization tests have measured roughly 2–7x higher conversion from outcome-led captions.";
const CAVEAT = "Flagged as a heuristic — not Apple's or our verdict; your call.";

/**
 * At most one finding: a FEATURE-led first caption. An outcome-led caption (good),
 * an unclear read (unmeasured), or no analysis emits nothing. Pure + deterministic.
 */
export function captionFindings(analysis: CaptionAnalysis | null): Finding[] {
  if (!analysis || analysis.style !== "feature") return [];
  return [
    {
      id: "caption_feature_led",
      surface: "screenshots",
      severity: "warn",
      impact: "conversion",
      title: "Your first screenshot leads with a feature, not an outcome",
      detail: `Its headline (“${analysis.caption}”) says what the app does, not what the user gets. ${CITED} ${CAVEAT}`,
      fix: "Rewrite the first caption around the transformation — the result the user achieves — not the feature.",
      evidence: analysis.caption,
    },
  ];
}

/**
 * Analyze the PRIMARY first screenshot only (cost-bounded to one inference).
 * Safe-degrade: no url, or the analyzer returning null/throwing → null. Never throws.
 */
export async function analyzeFirstShot(
  analyzer: CaptionAnalyzer,
  screenshotUrls: string[] | null | undefined,
): Promise<CaptionAnalysis | null> {
  const url = (screenshotUrls ?? [])[0];
  if (!url) return null;
  try {
    return await analyzer(url);
  } catch {
    return null;
  }
}

/**
 * Post-rejection assistant (#178 Phase 4, deterministic core).
 *
 * Paste an App Review rejection message → we identify the guideline Apple cited,
 * quote it verbatim (when it's in our corpus), recommend a resolution path, and
 * scaffold two ready-to-edit Resolution Center replies (fix-and-resubmit vs.
 * appeal). No LLM in this core: Apple's rejections cite the guideline number
 * explicitly, so identification is a parse, and the drafts are honest SCAFFOLDS
 * the developer completes — not fabricated claims about their app.
 *
 * Honesty, load-bearing:
 *   • the cited guideline is PARSED from Apple's own message, not guessed; its
 *     quote is VERBATIM from the corpus or null (never a paraphrase we invent),
 *   • the recommendation is a labelled HEURISTIC ("your call"), not a verdict,
 *   • the drafts carry [bracketed placeholders] the developer fills — we never
 *     assert facts about their app or put words in Apple's mouth.
 *
 * LLM tailoring (root-cause narrative, app-specific draft prose) is a follow-up;
 * this core is pure + deterministic + fully testable.
 */
import { guidelineQuoteForSection } from "./reviewGuidelines.js";

export type ResolutionPath = "fix_and_resubmit" | "appeal";

export type RejectionAnalysis = {
  /** guideline sections cited in the message, in first-seen order (e.g. ["2.3.7"]). */
  guidelines: string[];
  /** the primary (first) cited guideline, or null when none was parsed. */
  primaryGuideline: string | null;
  /** verbatim rule text for the primary guideline, or null if not in our corpus. */
  quote: string | null;
  /** heuristic recommendation; "unclear" when we shouldn't steer. */
  recommended: ResolutionPath | "unclear";
  /** why — a labelled heuristic, never a verdict. */
  rationale: string;
  /** two ready-to-edit Resolution Center reply scaffolds. */
  drafts: Record<ResolutionPath, string>;
};

/** Matches Apple's "Guideline 2.3.7" / "guideline 5.1.1" references. */
const GUIDELINE_RE = /guideline[s]?\s+(\d+(?:\.\d+){0,3})/gi;

/** Parse the cited guideline sections from a rejection message, de-duped, in order. */
export function parseGuidelines(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(GUIDELINE_RE)) {
    const g = m[1]!;
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

/**
 * A METADATA guideline (2.3.x) is usually the fastest to resolve: edit the copy
 * and resubmit, no new build. We only steer toward fix-and-resubmit for those;
 * everything else stays "unclear" (both drafts offered, the developer decides) —
 * we don't pretend to know whether a design/legal call is worth appealing.
 */
function recommend(primary: string | null): { recommended: ResolutionPath | "unclear"; rationale: string } {
  if (!primary) {
    return {
      recommended: "unclear",
      rationale:
        "No guideline number found in the pasted text — paste the full rejection (it cites a “Guideline X.Y.Z”) so we can identify the rule.",
    };
  }
  if (/^2\.3(\.\d+)?$/.test(primary)) {
    return {
      recommended: "fix_and_resubmit",
      rationale:
        `Guideline ${primary} is a metadata rule — usually the fastest fix: correct the flagged copy and resubmit, no new build needed. Heuristic, not a verdict — your call.`,
    };
  }
  return {
    recommended: "unclear",
    rationale:
      `Guideline ${primary} isn't a metadata-only rule, so fix-vs-appeal depends on the specifics. Both drafts are below — pick based on whether you can change what was flagged or believe it already complies. Heuristic, not a verdict.`,
  };
}

/** Build the two Resolution Center reply scaffolds for a cited guideline. */
function buildDrafts(primary: string | null): Record<ResolutionPath, string> {
  const g = primary ? `Guideline ${primary}` : "the cited guideline";
  return {
    fix_and_resubmit:
      `Hello App Review team,\n\n` +
      `Thank you for the feedback regarding ${g}. We've addressed it: [describe the specific change you made — e.g. the exact metadata/screenshot/behavior you corrected].\n\n` +
      `The updated [build / metadata] is now submitted for review. Please let us know if anything else is needed.\n\n` +
      `Best regards,\n[Your name]`,
    appeal:
      `Hello App Review team,\n\n` +
      `We're writing regarding the rejection under ${g}. We believe the app complies because [state your specific reasoning — reference the exact screens, settings, or behavior].\n\n` +
      `[If relevant: note any prior approvals of the same behavior, or attach a screen recording demonstrating compliance.]\n\n` +
      `We'd be grateful for a re-review or clarification on what would resolve this. Thank you.\n\n` +
      `Best regards,\n[Your name]`,
  };
}

/**
 * Analyze a pasted App Review rejection. Deterministic: identifies the cited
 * guideline(s), quotes the primary one verbatim (or null), recommends a path,
 * and scaffolds both replies. Empty/guideline-less input still returns usable
 * scaffolds + an honest "paste the full message" rationale.
 */
export function analyzeRejection(text: string): RejectionAnalysis {
  const guidelines = parseGuidelines(text ?? "");
  const primaryGuideline = guidelines[0] ?? null;
  const quote = primaryGuideline ? guidelineQuoteForSection(primaryGuideline) : null;
  const { recommended, rationale } = recommend(primaryGuideline);
  return {
    guidelines,
    primaryGuideline,
    quote,
    recommended,
    rationale,
    drafts: buildDrafts(primaryGuideline),
  };
}

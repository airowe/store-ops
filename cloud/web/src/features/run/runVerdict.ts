/**
 * The run page's one-line answer to "what do I do?".
 *
 * Measured before this existed: 8 equal-weight cards, 578 words, 2.6 screens —
 * and the verdict appeared nowhere. A reader had to derive "nothing needs my
 * approval" by reading everything and finding no fixes.
 *
 * Derived, never stored, so it cannot drift from the findings it describes.
 *
 * It obeys the same rule as every number in this product: it reports what was
 * measured, and never turns an unread surface into an all-clear. A run that read
 * nothing has no verdict to give, and says so.
 */
import type { FindingsSummary } from "@shipaso/api";

export type RunVerdict = {
  /** The sentence. The page's largest text. */
  headline: string;
  /** Secondary line: context and what we could not see. Empty when neither applies. */
  detail: string;
  /**
   * action  — there is work waiting
   * clear   — read enough to say nothing needs a decision
   * blocked — too little was read to judge
   */
  tone: "action" | "clear" | "blocked";
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function runVerdict(input: {
  summary: FindingsSummary;
  /** Surfaces the run could not read (no key). */
  lockCount: number;
}): RunVerdict {
  const { summary, lockCount } = input;
  // A "fix" is actionable only. Counting info/good would manufacture urgency the
  // run does not support — the same restraint `summarizeFindings`'s label uses.
  const fixes = summary.critical + summary.warn;

  const unread = lockCount > 0 ? `${lockCount} we can't see yet` : "";
  const context = summary.info > 0 ? plural(summary.info, "thing worth knowing", "things worth knowing") : "";
  const detail = [context, unread].filter(Boolean).join(" · ");

  if (fixes > 0) {
    return {
      headline: `${plural(fixes, "fix is", "fixes are")} ready for your call.`,
      detail,
      tone: "action",
    };
  }

  // Nothing actionable AND nothing read is not an all-clear — it is a blocked
  // run. Saying "nothing needs your approval" here would be a claim about
  // surfaces we never looked at.
  if (summary.total === 0 && lockCount > 0) {
    return {
      headline: "We can't see enough to judge this listing yet.",
      detail: `${lockCount} surface${lockCount === 1 ? "" : "s"} need App Store Connect access.`,
      tone: "blocked",
    };
  }

  return {
    headline: "Nothing needs your approval.",
    detail,
    tone: "clear",
  };
}

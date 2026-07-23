/**
 * DecisionSummary — the verdict, before the detail. On an open run it states the
 * net keyword delta and how many findings actually need the user, so a reviewer
 * can decide without reading all the cards. Honest: counts are derived from the
 * same data the cards render; nothing is invented. Pure presentational.
 */
import type { CopyFields, Finding } from "@shipaso/api";
import { diffKeywords } from "./keywordDiff.js";

const isBlocker = (f: Finding) => f.severity === "critical" || f.severity === "warn";

export function DecisionSummary({
  current, proposed, findings,
}: { current: CopyFields; proposed: CopyFields; findings: Finding[] }) {
  const kw = diffKeywords(current.keywords, proposed.keywords);
  const actionable = findings.filter((f) => !f.context);
  const blockers = actionable.filter(isBlocker);
  const rest = actionable.length - blockers.length;

  return (
    <div className="decision-summary" data-testid="decision-summary">
      <span className="ds-pill kw" data-testid="ds-keywords">
        keywords <b className="add">+{kw.added.length}</b> / <b className="rem">−{kw.removed.length}</b>
      </span>
      <span className={"ds-pill " + (blockers.length ? "warn" : "ok")} data-testid="ds-blockers">
        {blockers.length === 0
          ? "no blockers"
          : blockers.length === 1
            ? `1 needs you · ${blockers[0]!.title}`
            : `${blockers.length} need you`}
      </span>
      {rest > 0 ? (
        <span className="ds-pill quiet" data-testid="ds-rest">{rest} more check{rest === 1 ? "" : "s"}</span>
      ) : null}
    </div>
  );
}

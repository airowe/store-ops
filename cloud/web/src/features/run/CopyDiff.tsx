/**
 * CopyDiff — the current → proposed metadata diff, per field, with char budgets.
 * Honesty: a field the read couldn't see shows "(was unread)" (never a fake
 * empty); an over-limit proposal is flagged loudly (`invalid`) so it can't look
 * valid; a changed value strikes the old and highlights the new.
 */
import type { CopyFields } from "@shipaso/api";

const LIMITS: Partial<Record<keyof CopyFields, number>> = { name: 30, subtitle: 30, keywords: 100, promo: 170 };
const FIELDS: Array<keyof CopyFields> = ["name", "subtitle", "keywords", "promo"];

export function CopyDiff({ current, proposed }: { current: CopyFields; proposed: CopyFields }) {
  return (
    <div className="difflist">
      {FIELDS.map((f) => {
        const after = proposed[f];
        if (after === undefined) return null; // nothing proposed for this field
        const before = current[f];
        const changed = before !== after;
        const limit = LIMITS[f];
        const used = (after ?? "").length;
        const over = limit != null && used > limit;
        return (
          <div key={f} className={"diffrow" + (changed ? " is-changed" : "")} data-testid={`diff-${f}`}>
            <div className="dfield">
              <span className="fname">{f}</span>
              {limit != null ? (
                <span className={"charcount" + (over ? " over" : "")} data-testid={`count-${f}`}>
                  {used}/{limit}
                </span>
              ) : null}
            </div>
            <div className="diffcols">
              <div className="diffside was">
                {before !== undefined ? (
                  <span className={changed ? "strike" : ""}>{before || "—"}</span>
                ) : (
                  <span className="faint">(was unread)</span>
                )}
              </div>
              <div className="darrow">→</div>
              <div className={"diffside now" + (over ? " invalid" : "")} data-testid={`now-${f}`}>{after || "—"}</div>
            </div>
            {over ? (
              <div className="diff-issues" data-testid={`over-${f}`}>
                Over the {limit}-char limit by {used - limit}.
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One collapsed section of a run: a title, a measured count, and its content
 * behind a click.
 *
 * The run page stacked 8 cards of equal weight — 578 words across 2.6 screens
 * for a run whose verdict was "nothing needs your approval". Most of those cards
 * report ABSENCE (8 unreadable surfaces, 17 unmeasured keywords), and absence
 * does not deserve the same room as a finding.
 *
 * Native `<details>` on purpose: it is keyboard-accessible, works without JS,
 * and browsers already handle the disclosure semantics. A hand-rolled toggle
 * would be more code and less accessible.
 *
 * `count` is measured-or-absent like everything else — pass undefined and the
 * row simply shows no number rather than a fabricated zero.
 */
import type { ReactNode } from "react";

export function RunSection({
  title,
  count,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string;
  /** e.g. "4 notes", "99/100". Omit when there is nothing measured to show. */
  count?: string | undefined;
  defaultOpen?: boolean;
  testId?: string | undefined;
  children: ReactNode;
}) {
  return (
    <details
      className="run-section"
      open={defaultOpen}
      {...(testId ? { "data-testid": testId } : {})}
    >
      <summary className="run-section-summary">
        <span className="run-section-title">{title}</span>
        {count ? <span className="run-section-count">{count}</span> : null}
      </summary>
      <div className="run-section-body">{children}</div>
    </details>
  );
}

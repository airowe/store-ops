/**
 * RunDetailPane — renders exactly one section (master-detail). The caller
 * (RunView) composes each section's card into the `sections` map and selects
 * one via `activeId`. An unknown id renders an empty pane, never a throw.
 */
import type { ReactNode } from "react";

export function RunDetailPane({
  activeId, sections,
}: {
  activeId: string;
  sections: Record<string, ReactNode>;
}) {
  return (
    <div className="run-detail-pane" data-testid="run-detail-pane">
      {sections[activeId] ?? null}
    </div>
  );
}

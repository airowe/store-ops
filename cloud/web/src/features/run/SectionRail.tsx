/**
 * SectionRail — a grouped, selectable index of the run's sections. Controlled:
 * the caller owns `activeId` and gets `onSelect` on click. Selecting a section
 * swaps the single detail pane (master-detail) — this is the text-heavy fix
 * (#325): one section on screen at a time, not a stacked wall. Only non-empty
 * groups render a header. Pure presentational; items are buttons for keyboard
 * reach. Hidden-narrow handling lives in CSS.
 */
export type RailGroup = "needs" | "changes" | "fyi" | "healthy";
export type RailItem = { id: string; label: string; group: RailGroup };

/** Fixed display order + human labels for the groups. */
const GROUPS: { key: RailGroup; label: string }[] = [
  { key: "needs", label: "Needs you" },
  { key: "changes", label: "Changes" },
  { key: "fyi", label: "FYI" },
  { key: "healthy", label: "Healthy" },
];

export function SectionRail({
  items, activeId, onSelect,
}: {
  items: RailItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;

  // Group label map for quick lookup
  const groupLabels = new Map(GROUPS.map(({ key, label }) => [key, label]));

  // Track which groups we've already rendered a header for
  const renderedGroupHeaders = new Set<RailGroup>();

  return (
    <nav className="section-rail" data-testid="section-rail" aria-label="Run sections">
      {items.flatMap((it) => {
        const elements = [];

        // If this is the first item in its group, render the group header
        if (!renderedGroupHeaders.has(it.group)) {
          renderedGroupHeaders.add(it.group);
          elements.push(
            <div key={`${it.group}-header`} className="rail-group-label">
              {groupLabels.get(it.group)}
            </div>,
          );
        }

        // Render the item button
        elements.push(
          <button
            key={it.id}
            type="button"
            className={"rail-link" + (activeId === it.id ? " active" : "")}
            aria-current={activeId === it.id ? "true" : undefined}
            onClick={() => onSelect(it.id)}
          >
            {it.label}
          </button>,
        );

        return elements;
      })}
    </nav>
  );
}

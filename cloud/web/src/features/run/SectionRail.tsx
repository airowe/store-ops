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
  return (
    <nav className="section-rail" data-testid="section-rail" aria-label="Run sections">
      {GROUPS.map(({ key, label }) => {
        const groupItems = items.filter((it) => it.group === key);
        if (groupItems.length === 0) return null;
        return (
          <div key={key} className="rail-group">
            <div className="rail-group-label">{label}</div>
            {groupItems.map((it) => (
              <button
                key={it.id}
                type="button"
                className={"rail-link" + (activeId === it.id ? " active" : "")}
                aria-current={activeId === it.id ? "true" : undefined}
                onClick={() => onSelect(it.id)}
              >
                {it.label}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

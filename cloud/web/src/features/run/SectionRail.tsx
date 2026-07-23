/**
 * SectionRail — a slim sticky index of the run's sections, so a long report is
 * navigable instead of a linear wall. Jump links to each section anchor; the
 * active one highlights on scroll (IntersectionObserver, guarded for SSR/jsdom).
 * Hidden on narrow viewports via CSS (the sticky action bar carries the decision
 * there). Pure presentational; the caller passes only the sections present.
 */
import { useEffect, useState } from "react";

export type RailItem = { id: string; label: string };

export function SectionRail({ items }: { items: RailItem[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || items.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const it of items) {
      const el = document.getElementById(it.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [items]);

  if (items.length === 0) return null;
  return (
    <nav className="section-rail" data-testid="section-rail" aria-label="Run sections">
      {items.map((it) => (
        <a
          key={it.id}
          href={`#${it.id}`}
          className={"rail-link" + (active === it.id ? " active" : "")}
        >
          {it.label}
        </a>
      ))}
    </nav>
  );
}

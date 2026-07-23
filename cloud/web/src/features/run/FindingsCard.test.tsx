import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Finding, SurfaceLock } from "@shipaso/api";
import { FindingsCard } from "./FindingsCard.js";

const actionable: Finding = {
  id: "subtitle_missing",
  surface: "subtitle",
  severity: "critical",
  impact: "ranking",
  title: "No subtitle",
  detail: "The subtitle is a ranked field you're not using.",
  fix: "Add a 30-char subtitle with your top keyword.",
};

const contextFact: Finding = {
  id: "version_state",
  surface: "version",
  severity: "info",
  impact: "completeness",
  title: "Live version 2.1 in READY_FOR_SALE",
  detail: "Facts that frame the audit.",
  fix: "",
  context: true,
};

const unlockCta: Finding = {
  id: "asc_unlock",
  surface: "asc",
  severity: "info",
  impact: "completeness",
  title: "Connect App Store Connect",
  detail: "Unlock subtitle, keywords, and screenshots.",
  fix: "Connect your ASC key.",
};

const lock: SurfaceLock = {
  surface: "keywords",
  label: "We can't see your keyword field without access",
  unlockCopy: "Unlock to read + improve it",
};

describe("<FindingsCard />", () => {
  it("renders actionable findings with severity, fix, and the summary label", () => {
    render(
      <FindingsCard
        findings={[actionable]}
        summary={{ label: "1 fix available · 1 critical", critical: 1 }}
      />,
    );
    expect(screen.getByText("1 fix available · 1 critical")).toBeInTheDocument();
    expect(screen.getByText("No subtitle")).toBeInTheDocument();
    expect(screen.getByText(/Add a 30-char subtitle/)).toBeInTheDocument();
    expect(screen.getByTestId("finding-subtitle_missing")).toHaveTextContent("critical");
  });

  it("separates status/context facts from the actionable list", () => {
    render(<FindingsCard findings={[actionable, contextFact]} />);
    const status = screen.getByTestId("listing-status");
    expect(status).toHaveTextContent("Live version 2.1");
    // the context fact must not appear inside the actionable list
    expect(screen.getByTestId("findings-list")).not.toHaveTextContent("Live version 2.1");
  });

  it("renders the asc_unlock CTA as a single button, apart from the fixes list", () => {
    render(<FindingsCard findings={[actionable, unlockCta]} />);
    expect(screen.getByTestId("asc-unlock")).toBeInTheDocument();
    // one CTA, and it's a button/link labelled 'Unlock your full audit'
    expect(screen.getAllByTestId("asc-unlock-cta")).toHaveLength(1);
    expect(screen.getByTestId("asc-unlock-cta")).toHaveTextContent("Unlock your full audit");
    // the finding's own copy stays out of the actionable fixes list
    expect(screen.getByTestId("findings-list")).not.toHaveTextContent("Unlock subtitle");
  });

  it("collapses locked surfaces into ONE connect CTA — no per-surface wall of text", () => {
    render(<FindingsCard findings={[]} locks={[lock, lock]} />);
    const cta = screen.getByTestId("asc-unlock");
    expect(screen.getByTestId("asc-unlock-cta")).toHaveTextContent("Unlock your full audit");
    // honest about how much is hidden, without repeating a sentence per surface
    expect(cta).toHaveTextContent("2 surfaces");
    expect(cta).not.toHaveTextContent("We can't see your keyword field without access");
  });

  it("fires onConnect when the unlock CTA is a button (client-side connect)", () => {
    const onConnect = vi.fn();
    render(<FindingsCard findings={[unlockCta]} onConnect={onConnect} />);
    fireEvent.click(screen.getByTestId("asc-unlock-cta"));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("renders nothing at all when there are no findings and no locks", () => {
    const { container } = render(<FindingsCard findings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  const mk = (over: Partial<Finding> = {}): Finding => ({
    id: over.id ?? "f", surface: "s", severity: "info", impact: "ranking",
    title: "T", detail: "D", fix: "", ...over,
  });

  it("shows a severity stripe and sorts blockers above healthy rows", () => {
    render(
      <FindingsCard
        findings={[
          mk({ id: "good1", severity: "good", title: "All good", fix: "" }),
          mk({ id: "crit1", severity: "critical", title: "Blocker", fix: "Fix it" }),
          mk({ id: "warn1", severity: "warn", title: "Warning", fix: "Do this" }),
        ]}
      />,
    );
    const list = screen.getByTestId("findings-list");
    const rows = within(list).getAllByTestId(/^finding-/);
    // critical first, then warn (blockers sorted up)
    expect(rows[0]).toHaveAttribute("data-severity", "critical");
    expect(rows[1]).toHaveAttribute("data-severity", "warn");
  });

  it("collapses healthy (good/info-no-fix) findings behind a counted disclosure", () => {
    render(
      <FindingsCard
        findings={[
          mk({ id: "crit1", severity: "critical", title: "Blocker", fix: "Fix it" }),
          mk({ id: "good1", severity: "good", title: "Healthy one", fix: "" }),
          mk({ id: "good2", severity: "good", title: "Healthy two", fix: "" }),
        ]}
      />,
    );
    // blocker visible immediately
    expect(screen.getByText("Blocker")).toBeInTheDocument();
    // healthy hidden until expanded, but the count is stated honestly
    const toggle = screen.getByTestId("healthy-toggle");
    expect(toggle).toHaveTextContent("2 healthy checks");
    expect(screen.queryByText("Healthy one")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("Healthy one")).toBeInTheDocument();
  });
});

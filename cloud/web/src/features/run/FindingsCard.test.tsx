import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("renders the asc_unlock CTA exactly once, apart from the fixes list", () => {
    render(<FindingsCard findings={[actionable, unlockCta]} />);
    expect(screen.getAllByText("Connect App Store Connect")).toHaveLength(1);
    expect(screen.getByTestId("asc-unlock")).toBeInTheDocument();
    expect(screen.getByTestId("findings-list")).not.toHaveTextContent(
      "Connect App Store Connect",
    );
  });

  it("renders locked surfaces as honest capability gaps", () => {
    render(<FindingsCard findings={[]} locks={[lock]} />);
    expect(screen.getByTestId("locks")).toHaveTextContent(
      "We can't see your keyword field without access",
    );
    expect(screen.getByTestId("locks")).toHaveTextContent("Unlock to read + improve it");
  });

  it("renders nothing at all when there are no findings and no locks", () => {
    const { container } = render(<FindingsCard findings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

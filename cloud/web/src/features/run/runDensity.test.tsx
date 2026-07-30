/**
 * The run page must answer before it explains.
 *
 * Measured on a live run (Snagg, approved) before this redesign: 8 equal-weight
 * cards, 578 words, 2.6 screens — and the verdict, "nothing needs your
 * approval", appeared nowhere. The reader derived it by reading everything and
 * noticing the absence of fixes.
 *
 * Asserted on structure rather than pixels: jsdom reports every height as 0, so
 * a "2.6 screens" assertion would pass vacuously. What IS checkable is that the
 * verdict exists, comes first, and that the evidence below it is collapsed.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunVerdictHeader } from "./RunVerdictHeader.js";
import { RunSection } from "./RunSection.js";

const summary = (over = {}) => ({
  label: "",
  critical: 0,
  warn: 0,
  good: 0,
  info: 0,
  total: 0,
  topImpact: null,
  ...over,
});

describe("the verdict header", () => {
  it("states the answer as the page's heading", () => {
    render(
      <RunVerdictHeader summary={summary({ info: 4, total: 4 })} lockCount={8} appName="Snagg" />,
    );
    const h = screen.getByRole("heading", { level: 1 });
    expect(h).toHaveTextContent(/nothing needs your approval/i);
  });

  it("names the app in the connect CTA instead of implying a paywall", () => {
    // "Unlock your full audit" read as a plan limit. Credentials are per-APP —
    // saying so is both truer and more actionable.
    render(
      <RunVerdictHeader
        summary={summary({ info: 4, total: 4 })}
        lockCount={8}
        appName="Snagg"
        onConnect={() => {}}
      />,
    );
    const cta = screen.getByTestId("run-verdict-connect");
    expect(cta).toHaveTextContent("Snagg");
    expect(cta.textContent ?? "").not.toMatch(/unlock/i);
  });

  it("offers no connect CTA when every surface was readable", () => {
    render(
      <RunVerdictHeader
        summary={summary({ info: 1, total: 1 })}
        lockCount={0}
        appName="Snagg"
        onConnect={() => {}}
      />,
    );
    expect(screen.queryByTestId("run-verdict-connect")).toBeNull();
  });

  /** No summary ⇒ nothing measured ⇒ no verdict. Never an implied all-clear. */
  it("renders nothing when the run has no findings summary", () => {
    const { container } = render(
      <RunVerdictHeader summary={undefined} lockCount={0} appName="Snagg" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("marks a blocked run so it can be styled as unanswered", () => {
    render(<RunVerdictHeader summary={summary()} lockCount={8} appName="Snagg" />);
    expect(screen.getByTestId("run-verdict")).toHaveAttribute("data-tone", "blocked");
  });
});

describe("collapsed sections", () => {
  it("hides its body until opened", () => {
    render(
      <RunSection title="What we found" count="4 notes" testId="s">
        <p>the evidence</p>
      </RunSection>,
    );
    // <details> without `open` — the content exists for search/a11y but is not
    // shown, which is the entire density win.
    expect(screen.getByTestId("s")).not.toHaveAttribute("open");
  });

  it("shows its measured count on the collapsed row", () => {
    render(
      <RunSection title="Keyword budget" count="99/100" testId="s">
        <p>x</p>
      </RunSection>,
    );
    expect(screen.getByText("99/100")).toBeInTheDocument();
  });

  /** Measured-or-absent, applied to the row itself. */
  it("shows no count when there is nothing measured", () => {
    const { container } = render(
      <RunSection title="Build assets" testId="s">
        <p>x</p>
      </RunSection>,
    );
    expect(container.querySelector(".run-section-count")).toBeNull();
  });

  it("can start open for the section that carries the work", () => {
    render(
      <RunSection title="Proposed changes" count="3 fields" defaultOpen testId="s">
        <p>x</p>
      </RunSection>,
    );
    expect(screen.getByTestId("s")).toHaveAttribute("open");
  });
});

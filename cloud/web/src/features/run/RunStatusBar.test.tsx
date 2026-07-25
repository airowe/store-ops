import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunStatusBar } from "./RunStatusBar.js";

describe("<RunStatusBar />", () => {
  it("renders the app name", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Heathen");
  });

  it("shows the honest version placeholder when no version is measured", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-version")).toHaveTextContent("v— live");
  });

  it("shows the measured version when provided", () => {
    render(<RunStatusBar appName="Heathen" version="1.2.1" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-version")).toHaveTextContent("v1.2.1 live");
  });

  it("shows the rating placeholder when rating is unmeasured", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-rating")).toHaveTextContent("★—");
  });

  it("shows the rating placeholder when the audit measured neither average nor count", () => {
    render(
      <RunStatusBar
        appName="Heathen"
        status="awaiting_approval"
        rating={{ average: null, count: null, source: "lookup" }}
      />,
    );
    expect(screen.getByTestId("sb-rating")).toHaveTextContent("★—");
  });

  it("shows the measured rating average and count", () => {
    render(
      <RunStatusBar
        appName="Heathen"
        status="awaiting_approval"
        rating={{ average: 4.7, count: 1240, source: "lookup" }}
      />,
    );
    expect(screen.getByTestId("sb-rating")).toHaveTextContent("★4.7");
    expect(screen.getByTestId("sb-rating")).toHaveTextContent("1,240");
  });

  it("renders a measured average with no count without inventing a count", () => {
    const { container } = render(
      <RunStatusBar
        appName="Heathen"
        status="awaiting_approval"
        rating={{ average: 4.7, count: null, source: "lookup" }}
      />,
    );
    expect(screen.getByTestId("sb-rating")).toHaveTextContent("★4.7");
    expect(container.querySelector('[data-testid="sb-rating"]')?.textContent).not.toMatch(/\(/);
  });

  /**
   * The two rating surfaces can disagree, so the bar must stay able to say
   * WHICH one it read — on hover, not as a visible marker. The visible text is
   * identical either way; only the title differs.
   */
  it("names the lookup API in the title when the rating came from the lookup", () => {
    render(
      <RunStatusBar
        appName="Heathen"
        status="awaiting_approval"
        rating={{ average: 4.7, count: 1240, source: "lookup" }}
      />,
    );
    expect(screen.getByTestId("sb-rating")).toHaveAttribute(
      "title",
      "Rating read from the App Store lookup API",
    );
  });

  it("names the listing page in the title when the rating came from the storefront", () => {
    render(
      <RunStatusBar
        appName="Heathen"
        status="awaiting_approval"
        rating={{ average: 4.7, count: 1240, source: "storefront" }}
      />,
    );
    expect(screen.getByTestId("sb-rating")).toHaveAttribute(
      "title",
      "Rating read from the App Store listing page",
    );
  });

  it("renders identical visible text regardless of which surface the rating came from", () => {
    const { getByTestId, unmount } = render(
      <RunStatusBar
        appName="Heathen"
        status="awaiting_approval"
        rating={{ average: 4.7, count: 1240, source: "lookup" }}
      />,
    );
    const lookupText = getByTestId("sb-rating").textContent;
    unmount();
    render(
      <RunStatusBar
        appName="Heathen"
        status="awaiting_approval"
        rating={{ average: 4.7, count: 1240, source: "storefront" }}
      />,
    );
    expect(screen.getByTestId("sb-rating").textContent).toBe(lookupText);
  });

  it("has no rating title when no rating was measured", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-rating")).not.toHaveAttribute("title");
  });

  it("shows the rank placeholder when rank is unmeasured", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-rank")).toHaveTextContent("#—");
  });

  it("shows the rank placeholder when the app was measured as not charting", () => {
    render(
      <RunStatusBar
        appName="Heathen"
        status="awaiting_approval"
        categoryRank={{ rank: null, category: "Health & Fitness" }}
      />,
    );
    expect(screen.getByTestId("sb-rank")).toHaveTextContent("#—");
  });

  it("shows the measured category rank with its category", () => {
    render(
      <RunStatusBar
        appName="Heathen"
        status="awaiting_approval"
        categoryRank={{ rank: 42, category: "Health & Fitness" }}
      />,
    );
    expect(screen.getByTestId("sb-rank")).toHaveTextContent("#42");
    expect(screen.getByTestId("sb-rank")).toHaveTextContent("Health & Fitness");
  });

  /**
   * An unresolvable genre id yields a CategoryRank with no category at all, so
   * the bar renders a bare "#42" rather than the bug-looking "#42 in 6013".
   */
  it("renders a bare rank when the audit carried no category name", () => {
    render(
      <RunStatusBar appName="Heathen" status="awaiting_approval" categoryRank={{ rank: 42 }} />,
    );
    const cell = screen.getByTestId("sb-rank");
    expect(cell).toHaveTextContent("#42");
    expect(cell.textContent).not.toMatch(/\bin\b/);
  });

  it("never renders a raw numeric genre id as the category", () => {
    render(
      <RunStatusBar appName="Heathen" status="awaiting_approval" categoryRank={{ rank: 42 }} />,
    );
    expect(screen.getByTestId("sb-rank").textContent).not.toMatch(/in\s+\d+/);
  });

  it("renders downloads as a CTA that calls onConnectAnalytics", () => {
    const onConnect = vi.fn();
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" onConnectAnalytics={onConnect} />);
    const cta = screen.getByTestId("sb-downloads");
    expect(cta).toHaveTextContent("connect analytics");
    fireEvent.click(cta);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("renders the measured grade and coverage when provided", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" grade="B+" coverageScore={95.6} />);
    expect(screen.getByTestId("sb-grade")).toHaveTextContent("B+");
    expect(screen.getByTestId("sb-coverage")).toHaveTextContent("95.6");
  });

  it("shows a dash for grade/coverage when unmeasured, never fabricates", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" grade={null} coverageScore={null} />);
    expect(screen.getByTestId("sb-grade")).toHaveTextContent("—");
    expect(screen.getByTestId("sb-coverage")).toHaveTextContent("—");
  });
});

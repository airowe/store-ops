import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunDetailPane } from "./RunDetailPane.js";

const SECTIONS = {
  changes: <div data-testid="sec-changes">changes body</div>,
  audit: <div data-testid="sec-audit">audit body</div>,
};

describe("<RunDetailPane />", () => {
  it("renders only the active section", () => {
    render(<RunDetailPane activeId="audit" sections={SECTIONS} />);
    expect(screen.getByTestId("sec-audit")).toBeInTheDocument();
    expect(screen.queryByTestId("sec-changes")).toBeNull();
  });

  it("renders nothing (no throw) for an unknown active id", () => {
    render(<RunDetailPane activeId="nope" sections={SECTIONS} />);
    expect(screen.queryByTestId("sec-changes")).toBeNull();
    expect(screen.queryByTestId("sec-audit")).toBeNull();
    expect(screen.getByTestId("run-detail-pane")).toBeInTheDocument();
  });

  it("swaps the rendered section when activeId changes", () => {
    const { rerender } = render(<RunDetailPane activeId="changes" sections={SECTIONS} />);
    expect(screen.getByTestId("sec-changes")).toBeInTheDocument();
    rerender(<RunDetailPane activeId="audit" sections={SECTIONS} />);
    expect(screen.getByTestId("sec-audit")).toBeInTheDocument();
    expect(screen.queryByTestId("sec-changes")).toBeNull();
  });
});

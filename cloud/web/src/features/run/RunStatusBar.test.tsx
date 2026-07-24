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

  it("shows the rating placeholder — rating is never measured this branch", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-rating")).toHaveTextContent("★—");
  });

  it("shows the rank placeholder", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-rank")).toHaveTextContent("#—");
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

import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { Lever, ShotScore } from "../types/api.js";
import { ScreenshotGallery } from "./ScreenshotGallery.js";

function shot(over: Partial<ShotScore> = {}): ShotScore {
  return {
    app: "Acme",
    iphoneCount: 5,
    ipadCount: 0,
    score: 72,
    grade: "B",
    findings: [],
    aspectHint: "6.5in shots look right",
    screenshotUrls: ["https://x/1.png", "https://x/2.png"],
    ipadScreenshotUrls: [],
    levers: [],
    ...over,
  };
}

const lever: Lever = { id: "count", label: "Add a 6th screenshot", detail: "", delta: 8, fromGrade: "B", toGrade: "A" };

describe("ScreenshotGallery (honesty empty states)", () => {
  it("renders the gallery + grade for a readable set", () => {
    render(<ScreenshotGallery shots={shot()} />);
    expect(screen.getByText(/B · 72/)).toBeTruthy();
    expect(screen.getAllByTestId("shot").length).toBe(2);
  });

  it("'?' grade / null score → NO gallery, an explicit unknown (never a zero)", () => {
    render(<ScreenshotGallery shots={shot({ grade: "?", score: null, screenshotUrls: [] })} />);
    expect(screen.queryByTestId("shot")).toBeNull();
    expect(screen.getByText(/grade unknown/)).toBeTruthy();
  });

  it("levers render for a B grade with headroom", () => {
    render(<ScreenshotGallery shots={shot({ levers: [lever] })} />);
    expect(screen.getByTestId("lever-count")).toBeTruthy();
  });

  it("A grade → NO levers (never over-sell a finished listing)", () => {
    render(<ScreenshotGallery shots={shot({ grade: "A", score: 96, levers: [lever] })} />);
    expect(screen.queryByTestId("lever-count")).toBeNull();
  });
});

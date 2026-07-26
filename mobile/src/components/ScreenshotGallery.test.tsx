import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { Lever, ShotScore } from "../types/api.js";
import { ScreenshotGallery } from "./ScreenshotGallery.js";
import { useColorScheme } from "react-native";
import { ThemeProvider } from "../theme/index.js";
import { lightPalette, palette } from "../theme/tokens.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
const mockColorScheme = useColorScheme as unknown as jest.Mock;

/** Flatten RN's style prop (array | object) into one resolved object. */
function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  const flatten = (s: unknown): Record<string, unknown> =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : ((s ?? {}) as Record<string, unknown>);
  return flatten(node.props.style);
}


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
  beforeEach(() => mockColorScheme.mockReturnValue("dark"));
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

describe("ScreenshotGallery theming", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("light"));

  it("uses the LIGHT palette for shot placeholders inside a light provider", () => {
    render(
      <ThemeProvider>
        <ScreenshotGallery shots={shot()} />
      </ThemeProvider>,
    );
    const first = screen.getAllByTestId("shot")[0]!;
    const style = flatStyle(first as never);
    expect(style.backgroundColor).toBe(lightPalette.panel2);
    expect(style.borderColor).toBe(lightPalette.line);

    expect(lightPalette.panel2).not.toBe(palette.panel2);
    expect(lightPalette.line).not.toBe(palette.line);
  });

  it("uses the LIGHT signal for a lever's delta", () => {
    render(
      <ThemeProvider>
        <ScreenshotGallery shots={shot({ levers: [lever] })} />
      </ThemeProvider>,
    );
    const delta = screen.getByText(/\+8/);
    expect(flatStyle(delta as never).color).toBe(lightPalette.signal);
    expect(lightPalette.signal).not.toBe(palette.signal);
  });
});

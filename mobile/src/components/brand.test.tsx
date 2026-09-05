import React from "react";
import { render, screen } from "@testing-library/react-native";
import { Eyebrow, Highlight, Headline, Kicker, LOOP_STEPS, LoopTerminal } from "./brand.js";
import { typeface } from "../theme/fonts.js";

jest.mock("react-native-svg", () => {
  const { View } = jest.requireActual("react-native");
  return { __esModule: true, default: View, Path: View };
});

/** Flatten RN's style prop (array | object) into one resolved object. */
function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  const flatten = (s: unknown): Record<string, unknown> =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : ((s ?? {}) as Record<string, unknown>);
  return flatten(node.props.style);
}

/**
 * The brand blocks are marketing copy on screens that get captured into App
 * Store screenshots. Two invariants: no number that could read as a measured
 * claim, and no price language (Apple reads "free" as a price — 2.3.7).
 */
const PRICE_WORDS = /\b(free|price|pricing|paid|cost|cheap|discount|trial)\b|\$/i;

describe("LoopTerminal", () => {
  it("shows the five steps of the loop", () => {
    render(<LoopTerminal />);
    for (const s of LOOP_STEPS) expect(screen.getByText(s.verb)).toBeTruthy();
    expect(screen.getByText("shipaso — the loop")).toBeTruthy();
  });

  it("states no numbers and no price language", () => {
    // The arrows are the shell prompt glyphs ("$", "→"), not currency — scan
    // the words only.
    const text = LOOP_STEPS.map((s) => `${s.verb} ${s.note}`).join(" ");
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(PRICE_WORDS);
    expect(LOOP_STEPS.map((s) => s.arrow)).toEqual(["$", "→", "→", "→", "→"]);
  });

  it("is set in the mono face", () => {
    render(<LoopTerminal />);
    expect(flatStyle(screen.getByText("audit")).fontFamily).toBe(typeface.mono);
  });
});

describe("Kicker / Eyebrow / Headline", () => {
  it("Kicker and Eyebrow are mono captions", () => {
    render(
      <>
        <Kicker>App Store + Google Play · open source</Kicker>
        <Eyebrow>proof, not promises</Eyebrow>
      </>,
    );
    expect(flatStyle(screen.getByText("App Store + Google Play · open source")).fontFamily).toBe(typeface.mono);
    expect(flatStyle(screen.getByText("proof, not promises")).fontFamily).toBe(typeface.mono);
  });

  it("Headline is the display face and Highlight is a nested span (inherits it)", () => {
    render(
      <Headline>
        Ships your metadata and <Highlight>proves the rank moved.</Highlight>
      </Headline>,
    );
    const heading = screen.getByText(/Ships your metadata/);
    expect(flatStyle(heading).fontFamily).toBe(typeface.display);
    expect(screen.getByText("proves the rank moved.")).toBeTruthy();
  });
});

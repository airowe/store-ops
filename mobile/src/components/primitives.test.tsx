import React from "react";
import { View, useColorScheme } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ThemeProvider } from "../theme/index.js";
import { lightPalette, palette } from "../theme/tokens.js";
import { Button, AppText, Card } from "./primitives.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
const mockColorScheme = useColorScheme as unknown as jest.Mock;

/** Flatten RN's style prop (array | object) into one resolved object. */
function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  const flatten = (s: unknown): Record<string, unknown> =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : ((s ?? {}) as Record<string, unknown>);
  return flatten(node.props.style);
}

describe("primitives", () => {
  it("AppText renders its children", () => {
    render(<AppText kind="title">Hello</AppText>);
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("Button fires onPress when enabled", () => {
    const onPress = jest.fn();
    render(<Button label="Go" onPress={onPress} />);
    fireEvent.press(screen.getByText("Go"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("Button does not fire when disabled", () => {
    const onPress = jest.fn();
    render(<Button label="Go" onPress={onPress} disabled testID="btn" />);
    fireEvent.press(screen.getByTestId("btn"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("Button shows a spinner (no label) while loading", () => {
    render(<Button label="Go" onPress={() => {}} loading />);
    expect(screen.queryByText("Go")).toBeNull();
  });
});

describe("primitives track the live palette", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("light"));

  const renderLight = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

  it.each([
    ["display", "ink"],
    ["title", "ink"],
    ["lead", "ink"],
    ["body", "ink"],
    ["dim", "dim"],
    ["mono", "ink"],
    ["micro", "faint"],
  ] as const)("AppText kind=%s uses the LIGHT palette's %s", (kind, token) => {
    renderLight(<AppText kind={kind}>Hi</AppText>);
    expect(flatStyle(screen.getByText("Hi")).color).toBe(lightPalette[token]);
    // the migration is only meaningful because the two schemes differ here
    expect(lightPalette[token]).not.toBe(palette[token]);
  });

  it("Card uses the LIGHT panel + line", () => {
    const { UNSAFE_getByType } = renderLight(
      <Card>
        <AppText>inside</AppText>
      </Card>,
    );
    const style = flatStyle(UNSAFE_getByType(View) as never);
    expect(style.backgroundColor).toBe(lightPalette.panel);
    expect(style.borderColor).toBe(lightPalette.line);
  });

  it("primary Button fills with the LIGHT signal and labels with the LIGHT bg", () => {
    renderLight(<Button label="Go" onPress={() => {}} testID="btn" />);
    expect(flatStyle(screen.getByTestId("btn")).backgroundColor).toBe(lightPalette.signal);
    expect(flatStyle(screen.getByText("Go")).color).toBe(lightPalette.bg);
  });

  it("ghost Button borders with the LIGHT line and labels with the LIGHT signal", () => {
    renderLight(<Button label="Go" variant="ghost" onPress={() => {}} testID="btn" />);
    expect(flatStyle(screen.getByTestId("btn")).borderColor).toBe(lightPalette.line);
    expect(flatStyle(screen.getByText("Go")).color).toBe(lightPalette.signal);
  });
});

import { typeface } from "../theme/fonts.js";

/**
 * The brand typefaces (Fraunces display, Space Grotesk text, JetBrains Mono)
 * were declared in the tokens and never applied: every kind rendered in the
 * system font with a fontWeight, and `mono` was the literal "monospace". Each
 * kind now names a loaded face, and the weight lives in the face, not in
 * fontWeight (a synthesized weight on a static face falls back to the system
 * font on iOS).
 */
describe("AppText is set in the brand typefaces", () => {
  it.each([
    ["display", typeface.display],
    ["title", typeface.title],
    ["lead", typeface.lead],
    ["body", typeface.sans],
    ["dim", typeface.sans],
    ["micro", typeface.sans],
    ["mono", typeface.mono],
  ] as const)("kind=%s uses %s", (kind, face) => {
    render(<AppText kind={kind}>Hi</AppText>);
    const style = flatStyle(screen.getByText("Hi"));
    expect(style.fontFamily).toBe(face);
    expect(style.fontWeight).toBeUndefined();
  });

  it("Button labels are set in the bold text face, not the system font", () => {
    render(<Button label="Go" onPress={() => {}} />);
    expect(flatStyle(screen.getByText("Go")).fontFamily).toBe(typeface.title);
  });
});

import React from "react";
import { TextInput, useColorScheme } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ThemeProvider } from "../theme/index.js";
import { lightPalette, palette } from "../theme/tokens.js";
import { TextField } from "./TextField.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
const mockColorScheme = useColorScheme as unknown as jest.Mock;

/** Flatten RN's style prop (array | object) into one resolved object. */
function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  const flatten = (s: unknown): Record<string, unknown> =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : ((s ?? {}) as Record<string, unknown>);
  return flatten(node.props.style);
}

describe("TextField", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("dark"));

  it("reports what the user types", () => {
    const onChangeText = jest.fn();
    render(<TextField value="" onChangeText={onChangeText} testID="f" />);
    fireEvent.changeText(screen.getByTestId("f"), "hello");
    expect(onChangeText).toHaveBeenCalledWith("hello");
  });

  it("grows for multiline input", () => {
    render(<TextField value="" onChangeText={() => {}} multiline testID="f" />);
    expect(flatStyle(screen.getByTestId("f")).minHeight).toBe(120);
  });

  it("uses the LIGHT palette inside a light provider", () => {
    mockColorScheme.mockReturnValue("light");
    const { UNSAFE_getByType } = render(
      <ThemeProvider>
        <TextField value="" onChangeText={() => {}} placeholder="you@example.com" testID="f" />
      </ThemeProvider>,
    );

    const input = UNSAFE_getByType(TextInput);
    const style = flatStyle(input as never);
    expect(style.color).toBe(lightPalette.ink);
    expect(style.backgroundColor).toBe(lightPalette.bg2);
    expect(style.borderColor).toBe(lightPalette.line);
    expect(input.props.placeholderTextColor).toBe(lightPalette.faint);

    // the migration is only meaningful because the two schemes differ here
    expect(lightPalette.ink).not.toBe(palette.ink);
  });
});

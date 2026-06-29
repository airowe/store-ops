import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Button, AppText } from "./primitives.js";

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

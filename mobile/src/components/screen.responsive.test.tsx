import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { Screen, AppText } from "./primitives.js";
import { CONTENT_MAX_WIDTH, resolveLayout } from "../theme/responsive.js";

// Control ONLY our layout hook (not all of react-native) so we can assert how
// Screen constrains its content per size class. resolveLayout stays real.
jest.mock("../theme/responsive.js", () => {
  const actual = jest.requireActual("../theme/responsive.js");
  return { ...actual, useLayout: jest.fn(() => actual.resolveLayout(390)) };
});

// Control ONLY the safe-area insets hook so we can assert Screen pads content
// below the status bar; the provider/context stays real.
jest.mock("react-native-safe-area-context", () => ({
  ...jest.requireActual("react-native-safe-area-context"),
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

import { useLayout } from "../theme/responsive.js";
const mockLayout = useLayout as jest.Mock;

/** Pull the flattened style array off the constrained content container. */
function contentStyles() {
  const node = screen.getByTestId("screen-content");
  const style = node.props.style as Array<Record<string, unknown> | false | undefined>;
  return style.filter(Boolean) as Array<Record<string, unknown>>;
}

describe("Screen (responsive width)", () => {
  it("phone: content fills width (no readable-column cap below tablet)", () => {
    mockLayout.mockReturnValue(resolveLayout(390));
    render(<Screen><AppText>hi</AppText></Screen>);
    const caps = contentStyles().filter((s) => typeof s.maxWidth === "number");
    expect(caps.every((s) => s.maxWidth === 390)).toBe(true);
  });

  it("iPad: content column is capped to CONTENT_MAX_WIDTH and centered", () => {
    mockLayout.mockReturnValue(resolveLayout(1024));
    render(<Screen><Text>hi</Text></Screen>);
    const styles = contentStyles();
    expect(styles.some((s) => s.maxWidth === CONTENT_MAX_WIDTH)).toBe(true);
    expect(styles.some((s) => s.alignSelf === "center")).toBe(true);
  });

  it("wide screens opt out of the cap", () => {
    mockLayout.mockReturnValue(resolveLayout(1024));
    render(<Screen wide><Text>hi</Text></Screen>);
    expect(contentStyles().some((s) => s.maxWidth === CONTENT_MAX_WIDTH)).toBe(false);
  });

  it("pads content below the status bar using the safe-area inset", () => {
    mockLayout.mockReturnValue(resolveLayout(390));
    render(<Screen><AppText>hi</AppText></Screen>);
    const content = screen.getByTestId("screen-content");
    const flat = Object.assign({}, ...([] as unknown[]).concat(content.props.style as never));
    // Exactly gutter + top inset — a bare ">= 47" would pass even if the gutter
    // were dropped from the sum.
    const gutter = resolveLayout(390).gutter;
    expect(flat.paddingTop).toBe(gutter + 47);
  });

  it("topInset={false} drops the top inset (screens under a native header)", () => {
    mockLayout.mockReturnValue(resolveLayout(390));
    render(<Screen topInset={false}><AppText>hi</AppText></Screen>);
    const content = screen.getByTestId("screen-content");
    const flat = Object.assign({}, ...([] as unknown[]).concat(content.props.style as never));
    // No status-bar inset added — react-navigation's header already insets it;
    // bottom inset still applies (home indicator).
    const gutter = resolveLayout(390).gutter;
    expect(flat.paddingTop).toBe(gutter);
  });
});

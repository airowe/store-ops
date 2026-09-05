import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import type { AppListItem } from "../types/api.js";
import { AppCard } from "./AppCard.js";
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


const NOW = Date.parse("2026-06-29T12:00:00Z");

function appItem(over: Partial<AppListItem> = {}): AppListItem {
  return {
    id: "app1",
    bundle_id: "com.acme.app",
    name: "Acme App",
    country: "US",
    created_at: "2026-06-01T00:00:00Z",
    latest_run: { id: "run1", status: "awaiting_approval", created_at: "2026-06-29T11:00:00Z" },
    rank_summary: { lead_keyword: "budget", lead_rank: 4, top10: 2, tracked: 5 },
    findings_summary: { critical: 1, warn: 2, good: 0, info: 1, total: 4, topImpact: "ranking", label: "3 fixes available · 1 critical" },
    ...over,
  };
}

describe("AppCard (honesty)", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("dark"));
  it("renders name, lead rank, status badge, and findings label", () => {
    render(<AppCard app={appItem()} now={NOW} onPress={() => {}} />);
    expect(screen.getByText("Acme App")).toBeTruthy();
    expect(screen.getByText("#4")).toBeTruthy();
    expect(screen.getByText("Awaiting approval")).toBeTruthy();
    expect(screen.getByText("3 fixes available · 1 critical")).toBeTruthy();
  });

  it("an unmeasured lead rank renders '—', never a guessed number", () => {
    render(<AppCard app={appItem({ rank_summary: { lead_keyword: "budget", lead_rank: null, top10: 0, tracked: 1 } })} now={NOW} onPress={() => {}} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("no rank summary → an explicit 'no ranks checked yet', not a zero", () => {
    render(<AppCard app={appItem({ rank_summary: null })} now={NOW} onPress={() => {}} />);
    expect(screen.getByText("no ranks checked yet")).toBeTruthy();
  });

  it("omits the findings badge when the server returned no summary", () => {
    render(<AppCard app={appItem({ findings_summary: null })} now={NOW} onPress={() => {}} />);
    expect(screen.queryByText(/fixes available/)).toBeNull();
  });

  it("says what the quiet week recorded (#493), once, on a detected row", () => {
    render(
      <AppCard
        app={appItem({
          latest_run: { id: "run1", status: "detected", created_at: "2026-06-29T11:00:00Z" },
          recorded_proposals: { runs: 1, proposals: 3, since: "2026-06-22T00:00:00.000Z" },
        })}
        now={NOW}
        onPress={() => {}}
      />,
    );
    expect(screen.getByTestId("recorded-proposals-app1")).toHaveTextContent("3 proposals recorded · nothing moved");
  });

  it("stays silent on zero, on an absent field, and on a row that awaits approval", () => {
    const { rerender } = render(
      <AppCard app={appItem({ recorded_proposals: { runs: 1, proposals: 3, since: "2026-06-22T00:00:00.000Z" } })} now={NOW} onPress={() => {}} />,
    );
    expect(screen.queryByTestId("recorded-proposals-app1")).toBeNull(); // awaiting_approval fixture
    rerender(
      <AppCard
        app={appItem({ latest_run: { id: "run1", status: "detected", created_at: "2026-06-29T11:00:00Z" }, recorded_proposals: { runs: 1, proposals: 0, since: "x" } })}
        now={NOW}
        onPress={() => {}}
      />,
    );
    expect(screen.queryByTestId("recorded-proposals-app1")).toBeNull();
    rerender(<AppCard app={appItem({ latest_run: { id: "run1", status: "detected", created_at: "2026-06-29T11:00:00Z" } })} now={NOW} onPress={() => {}} />);
    expect(screen.queryByTestId("recorded-proposals-app1")).toBeNull();
  });

  it("press fires onPress with the app id", () => {
    const onPress = jest.fn();
    render(<AppCard app={appItem()} now={NOW} onPress={onPress} />);
    fireEvent.press(screen.getByTestId("app-card-app1"));
    expect(onPress).toHaveBeenCalledWith("app1");
  });
});

describe("AppCard theming", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("light"));

  it("uses the LIGHT palette for the icon chip and rank divider inside a light provider", () => {
    render(
      <ThemeProvider>
        <AppCard app={appItem()} now={NOW} onPress={() => {}} />
      </ThemeProvider>,
    );
    const chip = flatStyle(screen.getByTestId("app-chip-app1") as never);
    expect(chip.backgroundColor).toBe(lightPalette.signalGlow);
    expect(chip.borderColor).toBe(lightPalette.signalDim);

    // the migration is only meaningful because the two schemes differ here
    expect(lightPalette.signalGlow).not.toBe(palette.signalGlow);
    expect(lightPalette.signalDim).not.toBe(palette.signalDim);
  });
});

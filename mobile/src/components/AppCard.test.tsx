import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import type { AppListItem } from "../types/api.js";
import { AppCard } from "./AppCard.js";

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

  it("press fires onPress with the app id", () => {
    const onPress = jest.fn();
    render(<AppCard app={appItem()} now={NOW} onPress={onPress} />);
    fireEvent.press(screen.getByTestId("app-card-app1"));
    expect(onPress).toHaveBeenCalledWith("app1");
  });
});

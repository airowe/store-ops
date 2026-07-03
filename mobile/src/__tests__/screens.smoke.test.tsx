/**
 * Screen smoke tests — mount every screen at BOTH a phone width (390) and an iPad
 * width (1024) and assert it renders its hallmark content without crashing. This
 * is the "all screens functional + UI renders properly on iPad" guarantee: the
 * responsive `Screen`/`Grid` path is exercised for each screen, not just the
 * primitives in isolation.
 *
 * The router is stubbed (screens render standalone); data comes from a fake
 * ApiClient injected via AuthProvider, and `useLayout` is driven per-test.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── router stub: screens render without the real navigation tree ───────────────
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: "x1" }),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

// ── drive the layout width per test ────────────────────────────────────────────
jest.mock("../theme/responsive.js", () => {
  const actual = jest.requireActual("../theme/responsive.js");
  return { ...actual, useLayout: jest.fn(() => actual.resolveLayout(390)) };
});

import { useLayout, resolveLayout } from "../theme/responsive.js";
import { AuthProvider } from "../auth/AuthProvider.js";
import { setToken, clearToken } from "../auth/session.js";
import type { ApiClient } from "../api/client.js";
import type { Me } from "../types/api.js";

const mockLayout = useLayout as jest.Mock;

// ── fake API: route by path to canned, honest payloads ─────────────────────────
const ME: Me = { authed: true, via: "session", email: "owner@example.com" };

const APP = { id: "x1", bundle_id: "com.acme.app", name: "Acme", country: "US" };
const RUN_DETAIL = {
  id: "x1", app_id: "x1", status: "awaiting_approval", created_at: "2026-06-29T11:00:00Z", approval: null,
  result: {
    audit: { screenshots: { app: "Acme", iphoneCount: 5, ipadCount: 0, score: 72, grade: "B", findings: [], aspectHint: "", screenshotUrls: [], ipadScreenshotUrls: [], levers: [] } },
    findings: [{ id: "f1", surface: "screenshots", severity: "warn", impact: "conversion", title: "Add a 6th shot", detail: "d", fix: "do it" }],
    findingsSummary: { critical: 0, warn: 1, good: 0, info: 0, total: 1, topImpact: "conversion", label: "1 fix available" },
    currentCopy: { name: "Acme", subtitle: "old" }, proposedCopy: { name: "Acme+", subtitle: "new" },
    pushCommands: [], coverage: undefined, locks: [], opportunities: [], keywordGaps: [],
  },
};

function routed(path: string): unknown {
  if (path === "/auth/me") return ME;
  if (path === "/apps" && true) return { apps: [{ id: "x1", bundle_id: "com.acme.app", name: "Acme", country: "US", created_at: "2026-06-01T00:00:00Z", latest_run: { id: "r1", status: "awaiting_approval", created_at: "2026-06-29T11:00:00Z" }, rank_summary: { lead_keyword: "budget", lead_rank: 4, top10: 1, tracked: 3 }, findings_summary: { critical: 0, warn: 1, good: 0, info: 0, total: 1, topImpact: "ranking", label: "1 fix available" } }] };
  if (/^\/apps\/[^/]+\/deltas$/.test(path)) return { appName: "Acme", entries: [{ keyword: "budget", current: 4, previous: 9, delta: 5, direction: "up" }], anyMovement: true };
  if (/^\/apps\/[^/]+\/war-room/.test(path)) return { appName: "Acme", warRoom: [{ keyword: "budget", you: 3, youPrevious: 8, competitors: [{ name: "Rival", rank: 5 }], gapToBest: -2, trend: "gaining", winning: true }], competitors: ["Rival"], window: 7, checkedAt: "2026-06-29" };
  if (/^\/apps\/[^/]+$/.test(path)) return { app: APP, runs: [{ id: "r1", status: "awaiting_approval", created_at: "2026-06-29T11:00:00Z" }] };
  if (/^\/runs\/[^/]+$/.test(path)) return RUN_DETAIL;
  if (path === "/portfolio") return { totalApps: 2, pendingApprovals: 1, appsTracked: 2, gradeBreakdown: { A: 1 }, cards: [{ appId: "x1", name: "Acme", grade: "A", leadKeyword: "budget", leadRank: 3, pendingApproval: false }] };
  return {};
}

function fakeClient(): ApiClient {
  const call = async <T,>(path: string) => routed(path) as T;
  return { get: call, post: call, request: call } as unknown as ApiClient;
}

function renderScreen(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider clientOverride={fakeClient()}>{ui}</AuthProvider>
    </QueryClientProvider>,
  );
}

// Import the screens (after the mocks above are registered).
import Dashboard from "../../app/(app)/index.js";
import AppDetail from "../../app/(app)/apps/[id].js";
import RunDetailScreen from "../../app/(app)/runs/[id].js";
import PortfolioScreen from "../../app/(app)/portfolio.js";
import WarRoomScreen from "../../app/(app)/war-room/[id].js";
import Login from "../../app/(public)/login.js";
import SettingsScreen from "../../app/(app)/settings.js";

beforeEach(async () => {
  await setToken("sess-1"); // authed for the (app) screens' data
  mockLayout.mockReturnValue(resolveLayout(390));
});
afterEach(async () => {
  await clearToken();
});

const WIDTHS: Array<[string, number]> = [["phone", 390], ["iPad", 1024]];

describe.each(WIDTHS)("screens render on %s (width %i)", (_label, width) => {
  beforeEach(() => mockLayout.mockReturnValue(resolveLayout(width)));

  it("Dashboard", async () => {
    renderScreen(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Your apps")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy());
  });

  it("App detail", async () => {
    renderScreen(<AppDetail />);
    await waitFor(() => expect(screen.getByText("Runs")).toBeTruthy());
    expect(screen.getByText(/Credentialed audits/)).toBeTruthy();
  });

  it("Run detail (money screen)", async () => {
    renderScreen(<RunDetailScreen />);
    await waitFor(() => expect(screen.getByText("1 fix available")).toBeTruthy());
    expect(screen.getByText("Proposed changes")).toBeTruthy();
    expect(screen.getByText("Findings")).toBeTruthy();
  });

  it("Portfolio", async () => {
    renderScreen(<PortfolioScreen />);
    await waitFor(() => expect(screen.getByText("2 apps")).toBeTruthy());
    expect(screen.getByText("Acme")).toBeTruthy();
  });

  it("War room", async () => {
    renderScreen(<WarRoomScreen />);
    await waitFor(() => expect(screen.getByText("War room")).toBeTruthy());
    expect(screen.getByText("#3")).toBeTruthy();
  });

  it("Settings", async () => {
    renderScreen(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText("Communications")).toBeTruthy());
    expect(screen.getByTestId("sign-out")).toBeTruthy();
  });

  it("Login", async () => {
    renderScreen(<Login />);
    await waitFor(() => expect(screen.getByText("Sign in")).toBeTruthy());
    expect(screen.getByTestId("email-input")).toBeTruthy();
  });
});

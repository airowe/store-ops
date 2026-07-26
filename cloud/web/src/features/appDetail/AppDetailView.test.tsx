import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";

// RankChart renders via uPlot (canvas) — stub it so this test is about the
// detail composition, not the renderer (RankChart has its own test).
vi.mock("../charts/RankChart.js", () => ({
  RankChart: ({ points }: { points: unknown[] }) => <div data-testid="rankchart">{points.length}</div>,
}));

import { AppDetailView } from "./AppDetailView.js";

function makeClient(
  over: {
    ranks?: unknown;
    deltas?: unknown;
    runs?: unknown[];
    engagement?: unknown;
    credentials?: unknown[];
  } = {},
) {
  const get = vi.fn(async (path: string) => {
    if (path.endsWith("/ranks")) return over.ranks ?? { points: [], annotations: [] };
    if (path.endsWith("/deltas")) return over.deltas ?? { entries: [] };
    if (path.endsWith("/analytics/engagement")) return over.engagement ?? { state: "no_data", message: "none" };
    if (path.endsWith("/competitors")) return { competitors: [] };
    if (path.endsWith("/play/funnel")) return { state: "no_data", message: "none" };
    if (path === "/account/credentials") return { enabled: true, credentials: over.credentials ?? [] };
    if (/\/apps\/[^/]+$/.test(path)) {
      return { app: { id: "a1", bundle_id: "com.acme", name: "Acme", country: "US" }, runs: over.runs ?? [] };
    }
    throw new Error("unexpected GET " + path);
  });
  return { get, post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
}

function renderView(client: ApiClient, onOpenRun = () => {}, onWarRoom = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppDetailView client={client} id="a1" onOpenRun={onOpenRun} onWarRoom={onWarRoom} now={Date.parse("2026-07-05T00:00:00Z")} />
    </QueryClientProvider>,
  );
}

describe("<AppDetailView />", () => {
  it("renders identity + a run row", async () => {
    const client = makeClient({ runs: [{ id: "r1", status: "awaiting_approval", created_at: "2026-07-04T00:00:00Z" }] });
    renderView(client);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    expect(screen.getByText("com.acme · US")).toBeInTheDocument();
    expect(screen.getByTestId("run-r1")).toHaveTextContent("Awaiting approval");
  });

  it("shows the rank-trend chart only with >= 2 points", async () => {
    const two = { points: [{ rank: 10, total: null, checked_at: "2026-07-01T00:00:00Z" }, { rank: 6, total: null, checked_at: "2026-07-02T00:00:00Z" }], annotations: [] };
    renderView(makeClient({ ranks: two }));
    await waitFor(() => expect(screen.getByTestId("rank-trend")).toBeInTheDocument());
    expect(screen.getByTestId("rankchart")).toHaveTextContent("2");
  });

  it("hides the trend for a single snapshot (no trend to draw)", async () => {
    const one = { points: [{ rank: 10, total: null, checked_at: "2026-07-01T00:00:00Z" }], annotations: [] };
    renderView(makeClient({ ranks: one }));
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.queryByTestId("rank-trend")).toBeNull();
  });

  it("renders rank movement when deltas are present", async () => {
    const deltas = { entries: [{ keyword: "todo", previous: 20, current: 8, delta: 12, direction: "up" }] };
    renderView(makeClient({ deltas }));
    await waitFor(() => expect(screen.getByTestId("rank-movement")).toBeInTheDocument());
    expect(screen.getByTestId("move-todo")).toBeInTheDocument();
  });

  it("offers the App Store Connect connect card (#179 keyed loop entry point) on the Connections tab", async () => {
    renderView(makeClient());
    await waitFor(() => screen.getByText("Acme"));
    fireEvent.click(screen.getByTestId("audit-tab-connections"));
    await waitFor(() => expect(screen.getByTestId("connect-asc")).toBeInTheDocument());
  });

  it("shows the measured conversion card once analytics are ingested", async () => {
    const engagement = { state: "measured", latestConversion: { date: "2026-07-02", rate: 0.2 }, movements: [], days: 2 };
    renderView(makeClient({ engagement }));
    await waitFor(() => expect(screen.getByTestId("conversion")).toBeInTheDocument());
    expect(screen.getByTestId("conv-latest")).toHaveTextContent("20.0%");
  });

  it("shows no conversion card before anything is ingested", async () => {
    renderView(makeClient());
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.queryByTestId("conversion")).toBeNull();
  });

  it("renders store tabs with App Store active and Google Play behind a connect chip", async () => {
    renderView(makeClient());
    await waitFor(() => screen.getByText("Acme"));
    const tabs = screen.getByTestId("store-tabs");
    expect(tabs).toHaveTextContent("App Store");
    expect(tabs).toHaveTextContent("Google Play");
    expect(tabs).toHaveTextContent("connect");
  });

  it("metric band shows the strongest measured lead rank from deltas, honestly", async () => {
    const deltas = {
      entries: [
        { keyword: "weather", previous: 20, current: 8, delta: 12, direction: "up" },
        { keyword: "forecast", previous: 6, current: 4, delta: 2, direction: "up" }, // strongest current
      ],
    };
    renderView(makeClient({ deltas }));
    await waitFor(() => screen.getByText("Acme"));
    // scope to the lead-rank tile — "#4" also appears in the rank-movement rows below
    const leadTile = screen.getByTestId("lead-rank-tile");
    expect(leadTile).toHaveTextContent("#4"); // forecast (#4) beats weather (#8)
    expect(leadTile).toHaveTextContent("↑2");
    expect(leadTile).toHaveTextContent("forecast");
  });

  it("renders an unmeasured lead rank as '—', never a fabricated number", async () => {
    // no deltas → nothing measured → the tile must show the em dash
    renderView(makeClient({ deltas: { entries: [] } }));
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.getByText("no keyword measured yet")).toBeInTheDocument();
  });

  it("shows the measured conversion rate in the metric band when analytics exist", async () => {
    const engagement = { state: "measured", latestConversion: { date: "2026-07-02", rate: 0.042 }, movements: [], days: 2 };
    renderView(makeClient({ engagement }));
    await waitFor(() => expect(screen.getByTestId("conversion-tile")).toHaveTextContent("4.2%"));
  });

  it("shows a coverage gauge derived honestly from the tracked deltas", async () => {
    const deltas = {
      entries: [
        { keyword: "a", previous: 20, current: 4, delta: 16, direction: "up" }, // top 10
        { keyword: "b", previous: 9, current: 7, delta: 2, direction: "up" }, // top 10
        { keyword: "c", previous: 30, current: 24, delta: 6, direction: "up" }, // not top 10
      ],
    };
    renderView(makeClient({ deltas }));
    const tile = await screen.findByTestId("coverage-tile");
    expect(tile).toHaveTextContent("67%"); // 2 of 3 measured in top 10
    expect(tile).toHaveTextContent("2 of 3");
  });

  it("coverage reads 'none measured yet' with no tracked deltas — never a fake 0%", async () => {
    renderView(makeClient({ deltas: { entries: [] } }));
    const tile = await screen.findByTestId("coverage-tile");
    expect(tile).toHaveTextContent("—");
    expect(tile).toHaveTextContent("none measured yet");
  });

  // ── v2 tab split (#344): Monitor stays monitoring; setup lives in Connections ──

  const CREDENTIAL_CARDS = ["connect-asc", "play-audit-card", "play-data-safety-card", "play-funnel-card"];

  it("defaults to Monitor, with the monitoring surfaces visible", async () => {
    const deltas = { entries: [{ keyword: "todo", previous: 20, current: 8, delta: 12, direction: "up" }] };
    renderView(makeClient({ deltas }));
    await waitFor(() => screen.getByText("Acme"));
    const monitor = screen.getByTestId("audit-tab-monitor");
    expect(monitor).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("audit-tab-connections")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("rank-movement")).toBeInTheDocument();
  });

  it("keeps the four credential cards OFF the Monitor tab", async () => {
    renderView(makeClient());
    await waitFor(() => screen.getByText("Acme"));
    for (const id of CREDENTIAL_CARDS) expect(screen.queryByTestId(id)).toBeNull();
  });

  it("reveals exactly the four credential cards on Connections, and hides monitoring", async () => {
    const deltas = { entries: [{ keyword: "todo", previous: 20, current: 8, delta: 12, direction: "up" }] };
    renderView(makeClient({ deltas }));
    await waitFor(() => screen.getByText("Acme"));

    fireEvent.click(screen.getByTestId("audit-tab-connections"));
    for (const id of CREDENTIAL_CARDS) {
      expect(await screen.findByTestId(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("rank-movement")).toBeNull();
    expect(screen.getByTestId("audit-tab-connections")).toHaveAttribute("aria-selected", "true");
  });

  it("wires the tabs to their panel with aria-controls (native button semantics)", async () => {
    renderView(makeClient());
    await waitFor(() => screen.getByText("Acme"));
    const monitor = screen.getByTestId("audit-tab-monitor");
    expect(monitor.tagName).toBe("BUTTON");
    const panelId = monitor.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toBeTruthy();
  });

  it("counts BOTH surfaces as unconnected when no credentials are stored", async () => {
    renderView(makeClient({ credentials: [] }));
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.getByTestId("connections-unconnected")).toHaveTextContent("2 unconnected");
  });

  it("derives the count from real credential state — one stored key leaves one unconnected", async () => {
    const credentials = [
      { id: "c1", appId: null, kind: "asc", keyId: "K1", issuerId: "I1", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, kekVersion: 1 },
    ];
    renderView(makeClient({ credentials }));
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.getByTestId("connections-unconnected")).toHaveTextContent("1 unconnected");
  });

  it("renders NO count pill when every surface is connected — never a fabricated 0", async () => {
    const credentials = [
      { id: "c1", appId: null, kind: "asc", keyId: "K1", issuerId: "I1", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, kekVersion: 1 },
      { id: "c2", appId: "a1", kind: "play", keyId: "K2", issuerId: "I2", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, kekVersion: 1 },
    ];
    renderView(makeClient({ credentials }));
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.queryByTestId("connections-unconnected")).toBeNull();
  });

  it("renders NO count pill while credential state is still unknown — never a guess", async () => {
    // A client whose /account/credentials never resolves: the count is unmeasured.
    const client = makeClient();
    const inner = client.get as unknown as ReturnType<typeof vi.fn>;
    const orig = inner.getMockImplementation()!;
    inner.mockImplementation(async (path: string) => {
      if (path === "/account/credentials") return new Promise(() => {}) as never;
      return orig(path);
    });
    renderView(client);
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.queryByTestId("connections-unconnected")).toBeNull();
  });
});

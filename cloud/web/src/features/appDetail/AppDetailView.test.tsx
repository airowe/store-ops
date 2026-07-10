import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";

// RankChart renders via uPlot (canvas) — stub it so this test is about the
// detail composition, not the renderer (RankChart has its own test).
vi.mock("../charts/RankChart.js", () => ({
  RankChart: ({ points }: { points: unknown[] }) => <div data-testid="rankchart">{points.length}</div>,
}));

import { AppDetailView } from "./AppDetailView.js";

function makeClient(over: { ranks?: unknown; deltas?: unknown; runs?: unknown[] } = {}) {
  const get = vi.fn(async (path: string) => {
    if (path.endsWith("/ranks")) return over.ranks ?? { points: [], annotations: [] };
    if (path.endsWith("/deltas")) return over.deltas ?? { entries: [] };
    if (path === "/account/credentials") return { enabled: true, credentials: [] };
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

  it("offers the App Store Connect connect card (#179 keyed loop entry point)", async () => {
    renderView(makeClient());
    await waitFor(() => expect(screen.getByTestId("connect-asc")).toBeInTheDocument());
  });
});

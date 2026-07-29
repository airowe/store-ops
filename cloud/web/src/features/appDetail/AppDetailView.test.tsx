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

function renderView(
  client: ApiClient,
  onOpenRun: (runId: string) => void = () => {},
  onWarRoom: (appId: string) => void = () => {},
) {
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
    // #384: the empty state now names the SCOPE — "targeted" — so it reads as
    // "this run's targets haven't ranked", not "this app ranks nowhere".
    expect(screen.getByText("no targeted keyword measured yet")).toBeInTheDocument();
  });

  /**
   * #384 — the metric band is scoped to the LATEST RUN'S keyword targets (#74,
   * so keywords the app has since dropped don't resurface here). That scoping is
   * deliberate and correct. The bug was that the copy didn't say so.
   *
   * Heathen showed "0 currently ranking" on this page while the Keywords page
   * showed the same app at #1 for "secular meditation" — a term the latest run
   * didn't target. Both screens were honest; together they read as broken.
   *
   * The fix is precision, not new data: name the set the number describes.
   */
  it("says which set the count describes, so it cannot read as 'this app ranks nowhere'", async () => {
    const deltas = {
      entries: [
        { keyword: "meditation", previous: null, current: null, delta: null, direction: "unmeasured" },
        { keyword: "calm", previous: null, current: null, delta: null, direction: "unmeasured" },
      ],
    };
    renderView(makeClient({ deltas }));
    await waitFor(() => screen.getByText("Acme"));
    const tile = screen.getByTestId("tracked-terms-tile");
    // "0 of 2 tracked terms ranking" — not a bare "0 currently ranking"
    expect(tile).toHaveTextContent(/0 of 2/);
    expect(tile).toHaveTextContent(/tracked/i);
  });

  it("scopes the lead-rank tile's empty state to this run's targets", async () => {
    renderView(makeClient({ deltas: { entries: [] } }));
    await waitFor(() => screen.getByText("Acme"));
    const tile = screen.getByTestId("lead-rank-tile");
    // must not imply the app has never ranked for anything
    expect(tile).toHaveTextContent(/target/i);
  });

  it("still reports a real measured count without hedging", async () => {
    const deltas = {
      entries: [
        { keyword: "weather", previous: 20, current: 8, delta: 12, direction: "up" },
        { keyword: "forecast", previous: null, current: null, delta: null, direction: "unmeasured" },
      ],
    };
    renderView(makeClient({ deltas }));
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.getByTestId("tracked-terms-tile")).toHaveTextContent(/1 of 2/);
  });

  /**
   * #385 — the keyless run had no caller in either surface. The only way to
   * start an audit was to paste a .p8 key, so the free tier — whose entire
   * product is the public audit — had no manual start button for its own loop.
   */
  describe("run audit now (#385)", () => {
    /** makeClient's post is a bare vi.fn(); give it a resolved/rejected value. */
    function withRun(result: unknown, reject = false) {
      const client = makeClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).post = vi.fn(async () =>
        reject ? Promise.reject(result) : result,
      );
      return client;
    }

    it("triggers the keyless run and opens the resulting run", async () => {
      const opened: string[] = [];
      const client = withRun({ id: "run-new", status: "detected" });
      renderView(client, (id: string) => opened.push(id));
      await waitFor(() => screen.getByText("Acme"));

      fireEvent.click(screen.getByTestId("run-audit"));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await waitFor(() => expect((client as any).post).toHaveBeenCalledWith("/apps/a1/run"));
      await waitFor(() => expect(opened).toEqual(["run-new"]));
    });

    /**
     * The audit costs a run against the plan and re-reads the store, so it must
     * never fire on render — only on an explicit click. Same rule as every
     * other action in this product.
     */
    it("never runs on mount — only on an explicit click", async () => {
      const client = withRun({ id: "r", status: "detected" });
      renderView(client);
      await waitFor(() => screen.getByText("Acme"));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((client as any).post).not.toHaveBeenCalled();
    });

    it("surfaces a refusal honestly instead of failing silently", async () => {
      const client = withRun(new Error("your plan allows 1 connected app"), true);
      renderView(client);
      await waitFor(() => screen.getByText("Acme"));
      fireEvent.click(screen.getByTestId("run-audit"));
      const msg = await screen.findByTestId("run-audit-error");
      expect(msg).toHaveTextContent(/plan allows 1 connected app/);
    });
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

  /**
   * The run page's "Connect a key" CTA links here to connect a key, and the key
   * cards live on Connections. Landing on Monitor instead is the dead end the
   * CTA was reported for — right page, wrong tab, no visible way to act.
   *
   * Rendered directly rather than through renderView(): initialTab is the thing
   * under test, and the ~30 other tests should keep asserting the default.
   */
  it("opens on Connections when told to, so a connect link lands on the key cards", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AppDetailView
          client={makeClient()}
          id="a1"
          onOpenRun={() => {}}
          onWarRoom={() => {}}
          initialTab="connections"
          now={Date.parse("2026-07-05T00:00:00Z")}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.getByTestId("audit-tab-connections")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("connect-asc")).toBeInTheDocument();
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

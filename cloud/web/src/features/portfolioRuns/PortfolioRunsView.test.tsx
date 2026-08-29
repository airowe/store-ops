import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient, PortfolioRunRow, RunStatus } from "@shipaso/api";
import { PortfolioRunsView } from "./PortfolioRunsView.js";

const NOW = Date.parse("2026-07-25T12:00:00Z");

function row(
  id: string,
  status: RunStatus,
  created_at: string,
  extra: Partial<PortfolioRunRow> = {},
): PortfolioRunRow {
  return {
    id,
    status,
    created_at,
    app_id: `app-${id}`,
    app_name: `App ${id}`,
    findings_summary: null,
    ...extra,
  };
}

function makeClient(runs: PortfolioRunRow[], opts: { hang?: boolean } = {}) {
  const get = vi.fn(async (path: string) => {
    if (path !== "/runs") throw new Error("unexpected GET " + path);
    if (opts.hang) await new Promise(() => {});
    return { runs };
  });
  const post = vi.fn(async (path: string) => {
    if (path !== "/runs/approve-all") throw new Error("unexpected POST " + path);
    const pending = runs.filter((r) => r.status === "awaiting_approval");
    return { approved: pending.map((r) => r.id), approvedCount: pending.length, skipped: [] };
  });
  return { client: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
}

function renderView(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortfolioRunsView client={client} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("<PortfolioRunsView /> states", () => {
  it("shows a loading state while the request is in flight", () => {
    const { client } = makeClient([], { hang: true });
    renderView(client);
    expect(screen.getByTestId("runs-loading")).toBeInTheDocument();
    expect(screen.getByText(/Loading runs/i)).toBeInTheDocument();
    expect(screen.queryByTestId("runs-empty")).not.toBeInTheDocument();
  });

  it("empty state names the two real ways a run appears and disclaims filler", async () => {
    const { client } = makeClient([]);
    renderView(client);
    const empty = await screen.findByTestId("runs-empty");
    expect(within(empty).getByText(/weekly sweep/i)).toBeInTheDocument();
    expect(within(empty).getByText(/start one yourself from an app/i)).toBeInTheDocument();
    expect(within(empty).getByText(/don’t create runs to fill this page/i)).toBeInTheDocument();
    expect(screen.queryByTestId("runs-queue")).not.toBeInTheDocument();
  });

  it("renders the queue and the history for a populated portfolio", async () => {
    const { client } = makeClient([
      row("q1", "awaiting_approval", "2026-07-20T09:00:00Z"),
      row("h1", "approved", "2026-07-25T08:00:00Z"),
    ]);
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("runs-queue")).toBeInTheDocument());
    expect(screen.getByTestId("runs-history")).toBeInTheDocument();
    expect(screen.queryByTestId("runs-empty")).not.toBeInTheDocument();
  });
});

describe("<PortfolioRunsView /> queue / history partition", () => {
  const runs = [
    // Server order: the OLDEST awaiting run leads, then created_at desc.
    row("q-old", "awaiting_approval", "2026-01-02T09:00:00Z", { app_name: "Ancient" }),
    row("q-new", "awaiting_approval", "2026-07-25T09:00:00Z", { app_name: "Fresh" }),
    row("h-a", "approved", "2026-07-25T08:00:00Z", { app_name: "Decided" }),
    row("h-b", "researching", "2026-07-24T08:00:00Z", { app_name: "Working" }),
  ];

  it("puts awaiting-approval runs in the queue at any age and everything else in history", async () => {
    const { client } = makeClient(runs);
    renderView(client);
    const queue = await screen.findByTestId("runs-queue");
    const ids = within(queue)
      .getAllByTestId(/^queue-row-/)
      .map((el) => el.getAttribute("data-run-id"));
    expect(ids).toEqual(["q-old", "q-new"]);

    const history = screen.getByTestId("runs-history");
    const hids = within(history)
      .getAllByTestId(/^history-row-/)
      .map((el) => el.getAttribute("data-run-id"));
    expect(hids).toEqual(["h-a", "h-b"]);
  });

  it("renders in the server's order — it does not re-sort by date", async () => {
    const { client } = makeClient(runs);
    renderView(client);
    const queue = await screen.findByTestId("runs-queue");
    const names = within(queue)
      .getAllByTestId(/^queue-row-/)
      .map((el) => within(el).getByTestId("queue-app-name").textContent);
    // Date-descending would be ["Fresh", "Ancient"]. The server's order is the
    // opposite, and that order must survive.
    expect(names).toEqual(["Ancient", "Fresh"]);
  });

  it("headline and approve-all button count the queue, not the whole response", async () => {
    const { client } = makeClient(runs);
    renderView(client);
    await screen.findByTestId("runs-queue");
    expect(screen.getByTestId("queue-headline")).toHaveTextContent("2 runs are ready for your decision.");
    expect(screen.getByTestId("approve-all")).toHaveTextContent("Approve all 2");
  });
});

describe("<PortfolioRunsView /> honesty", () => {
  it("renders NO findings chip when findings_summary is null — never a zero", async () => {
    const { client } = makeClient([
      row("n", "awaiting_approval", "2026-07-25T09:00:00Z", { findings_summary: null }),
    ]);
    renderView(client);
    const queue = await screen.findByTestId("runs-queue");
    expect(within(queue).queryByTestId("queue-findings-chip")).not.toBeInTheDocument();
    expect(queue.textContent).not.toMatch(/\b0\b/);
  });

  it("renders the chip only when a summary was actually measured", async () => {
    const { client } = makeClient([
      row("y", "awaiting_approval", "2026-07-25T09:00:00Z", {
        findings_summary: { label: "2 critical findings", critical: 2, warn: 0, good: 0, info: 0, total: 2, topImpact: "ranking" },
      }),
    ]);
    renderView(client);
    const chip = await screen.findByTestId("queue-findings-chip");
    expect(chip).toHaveTextContent("2 critical findings");
  });

  it("states that approval only reveals push commands", async () => {
    const { client } = makeClient([row("q", "awaiting_approval", "2026-07-25T09:00:00Z")]);
    renderView(client);
    await screen.findByTestId("runs-queue");
    expect(screen.getByTestId("approve-all-note")).toHaveTextContent(
      /Reveals every push command\. Still nothing shipped\./i,
    );
    expect(screen.getByTestId("runs-intro")).toHaveTextContent(
      /nothing reaches a store without you running them/i,
    );
  });

  it("does not ship the comp's preview state switcher", async () => {
    const { client } = makeClient([row("q", "awaiting_approval", "2026-07-25T09:00:00Z")]);
    renderView(client);
    await screen.findByTestId("runs-queue");
    expect(screen.queryByTestId("state-switcher")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /populated/i })).not.toBeInTheDocument();
  });
});

describe("<PortfolioRunsView /> history grouping and filters", () => {
  const runs = [
    row("a", "approved", "2026-07-25T10:00:00Z"),
    row("b", "rejected", "2026-07-24T10:00:00Z"),
    row("c", "superseded", "2026-07-22T10:00:00Z"),
  ];

  it("groups history by day with a pluralised count", async () => {
    const { client } = makeClient(runs);
    renderView(client);
    const history = await screen.findByTestId("runs-history");
    const headers = within(history)
      .getAllByTestId(/^day-header-/)
      .map((el) => el.textContent);
    expect(headers[0]).toContain("Today");
    expect(headers[0]).toContain("1 run");
    expect(headers[1]).toContain("Yesterday");
    expect(headers[2]).toContain("Wednesday");
  });

  it("filter chips narrow history without touching the queue", async () => {
    const { client } = makeClient([row("q", "awaiting_approval", "2026-07-25T09:00:00Z"), ...runs]);
    renderView(client);
    await screen.findByTestId("runs-history");
    fireEvent.click(screen.getByTestId("history-filter-rejected"));
    await waitFor(() =>
      expect(within(screen.getByTestId("runs-history")).getAllByTestId(/^history-row-/)).toHaveLength(1),
    );
    expect(within(screen.getByTestId("runs-history")).getByTestId("history-row-b")).toBeInTheDocument();
    // The queue is the action loop; a history filter must never hide it.
    expect(within(screen.getByTestId("runs-queue")).getAllByTestId(/^queue-row-/)).toHaveLength(1);
  });

  it("uses the shared status labels rather than raw statuses", async () => {
    const { client } = makeClient([row("s", "superseded", "2026-07-25T10:00:00Z")]);
    renderView(client);
    const history = await screen.findByTestId("runs-history");
    expect(within(history).getByText("Superseded by a newer run")).toBeInTheDocument();
    expect(within(history).queryByText("superseded")).not.toBeInTheDocument();
  });

  it("says history starts where tracking started", async () => {
    const { client } = makeClient(runs);
    renderView(client);
    const history = await screen.findByTestId("runs-history");
    expect(within(history).getByText(/History starts when tracking started/i)).toBeInTheDocument();
  });
});

describe("<PortfolioRunsView /> approve all", () => {
  it("posts to approve-all and reports the count the server actually approved", async () => {
    const { client, post } = makeClient([
      row("q1", "awaiting_approval", "2026-07-25T09:00:00Z", { approval_challenge: "c-q1" }),
      row("q2", "awaiting_approval", "2026-07-24T09:00:00Z", { approval_challenge: "c-q2" }),
    ]);
    renderView(client);
    await screen.findByTestId("runs-queue");
    fireEvent.click(screen.getByTestId("approve-all"));
    // #515: the challenge for every queued run rides along, or the server
    // refuses. Asserting the PATH alone would pass against a request that
    // presents nothing — which is the request that approved 12 runs in prod.
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/runs/approve-all", {
        challenges: [
          { runId: "q1", challenge: "c-q1" },
          { runId: "q2", challenge: "c-q2" },
        ],
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("approve-all-result")).toHaveTextContent("Approved 2 runs."),
    );
  });

  it("omits a queued run that carries no challenge rather than inventing one", async () => {
    // The server refuses a partial set, and that refusal is correct. Sending a
    // fabricated or blank challenge to make the request look complete would be
    // the client lying about what it holds.
    const { client, post } = makeClient([
      row("q1", "awaiting_approval", "2026-07-25T09:00:00Z", { approval_challenge: "c-q1" }),
      row("q2", "awaiting_approval", "2026-07-24T09:00:00Z"),
    ]);
    renderView(client);
    await screen.findByTestId("runs-queue");
    fireEvent.click(screen.getByTestId("approve-all"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/runs/approve-all", {
        challenges: [{ runId: "q1", challenge: "c-q1" }],
      }),
    );
  });

  it("shows no queue panel at all when nothing awaits approval", async () => {
    const { client } = makeClient([row("h", "approved", "2026-07-25T08:00:00Z")]);
    renderView(client);
    await screen.findByTestId("runs-history");
    expect(screen.queryByTestId("runs-queue")).not.toBeInTheDocument();
    expect(screen.queryByTestId("approve-all")).not.toBeInTheDocument();
  });
});

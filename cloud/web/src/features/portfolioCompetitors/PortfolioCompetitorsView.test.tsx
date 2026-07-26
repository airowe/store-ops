/**
 * /competitors (#356). The honesty surface under test:
 *
 *  • A rival is one card, but watching is a per-(app, rival) FACT — a rival
 *    confirmed on one app and merely suggested on another must render BOTH
 *    states, never a flattened single status.
 *  • "overlaps N of your apps · watched on M" is COUNTED from the pairs in the
 *    response, never estimated, so the counts are asserted against fixtures
 *    whose shape differs from the comp's sample data.
 *  • There is NO shared-term count in the API. It is not measurable, so nothing
 *    may render it — not a number, not a zero, not an em dash placeholder.
 *  • Add / Discover carry an EXPLICIT app target, because both endpoints are
 *    per app and a portfolio-level action would have to guess.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient, PortfolioRival } from "@shipaso/api";
import { PortfolioCompetitorsView } from "./PortfolioCompetitorsView.js";

const APPS = [
  { id: "a1", name: "Cal AI", bundle_id: "com.cal.ai", latest_run: null, rank_summary: null, findings_summary: null },
  { id: "a2", name: "Lift Log", bundle_id: "com.lift.log", latest_run: null, rank_summary: null, findings_summary: null },
  { id: "a3", name: "Sleep Coach", bundle_id: "com.sleep.coach", latest_run: null, rank_summary: null, findings_summary: null },
];

/** Confirmed on two apps, suggested on a third — the mixed case the comp calls real and common. */
const MIXED: PortfolioRival = {
  key: "r-mixed",
  name: "MacroTrack",
  pairs: [
    { app_id: "a1", app_name: "Cal AI", status: "confirmed", source: "user" },
    { app_id: "a2", app_name: "Lift Log", status: "confirmed", source: "keywords" },
    { app_id: "a3", app_name: "Sleep Coach", status: "suggested", source: "similar" },
  ],
};

/** Watched nowhere — every pair is a suggestion, so the rival belongs in the suggested grid. */
const UNWATCHED: PortfolioRival = {
  key: "r-unwatched",
  name: "FoodSnap",
  pairs: [
    { app_id: "a1", app_name: "Cal AI", status: "suggested", source: "similar" },
    { app_id: "a2", app_name: "Lift Log", status: "suggested", source: "keywords" },
  ],
};

/** Watched on its only app. */
const SINGLE: PortfolioRival = {
  key: "r-single",
  name: "PlateIQ",
  pairs: [{ app_id: "a1", app_name: "Cal AI", status: "confirmed", source: "user" }],
};

type Deferred = { promise: Promise<unknown>; resolve: (v: unknown) => void };
function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeClient(opts: {
  rivals?: PortfolioRival[];
  pending?: Deferred;
  post?: ReturnType<typeof vi.fn>;
}) {
  const get = vi.fn(async (path: string) => {
    if (path === "/competitors") {
      if (opts.pending) return opts.pending.promise;
      return { rivals: opts.rivals ?? [] };
    }
    if (path === "/apps") return { apps: APPS };
    throw new Error("unexpected GET " + path);
  });
  return {
    get,
    post: opts.post ?? vi.fn(async () => ({ competitors: [] })),
    request: vi.fn(),
  } as unknown as ApiClient;
}

function renderView(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortfolioCompetitorsView client={client} />
    </QueryClientProvider>,
  );
}

describe("<PortfolioCompetitorsView />", () => {
  it("shows a loading state while the fleet's rivals are in flight", async () => {
    const pending = deferred();
    renderView(makeClient({ pending }));
    expect(await screen.findByTestId("pcomp-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("pcomp-empty")).toBeNull();
    expect(screen.queryByTestId("pcomp-toolbar")).toBeNull();
    pending.resolve({ rivals: [] });
    await waitFor(() => expect(screen.queryByTestId("pcomp-loading")).toBeNull());
  });

  it("empty state names discovery's precondition and that nothing is watched until confirmed", async () => {
    renderView(makeClient({ rivals: [] }));
    const empty = await screen.findByTestId("pcomp-empty");
    expect(empty).toHaveTextContent(/tracked keywords/i);
    expect(empty).toHaveTextContent(/Nothing is watched until you confirm it/i);
    expect(screen.queryByTestId("pcomp-watched")).toBeNull();
  });

  it("renders one card per watched rival and a suggested card per unwatched rival×app pair", async () => {
    renderView(makeClient({ rivals: [MIXED, SINGLE, UNWATCHED] }));
    await screen.findByTestId("pcomp-rival-r-mixed");
    expect(screen.getByTestId("pcomp-rival-r-single")).toBeInTheDocument();
    // A rival watched nowhere is not a watched card…
    expect(screen.queryByTestId("pcomp-rival-r-unwatched")).toBeNull();
    // …it is one suggestion card per app, because you confirm for one app.
    expect(screen.getByTestId("pcomp-suggestion-r-unwatched-a1")).toBeInTheDocument();
    expect(screen.getByTestId("pcomp-suggestion-r-unwatched-a2")).toBeInTheDocument();
  });

  it("renders a rival's MIXED pair states per pair rather than flattening the rival", async () => {
    renderView(makeClient({ rivals: [MIXED] }));
    const card = await screen.findByTestId("pcomp-rival-r-mixed");
    for (const [appId, state] of [["a1", "confirmed"], ["a2", "confirmed"], ["a3", "suggested"]] as const) {
      expect(within(card).getByTestId(`pcomp-pair-r-mixed-${appId}`)).toHaveAttribute("data-state", state);
    }
    // Only the unconfirmed pair carries its own inline confirm.
    expect(within(card).getByTestId("pcomp-confirm-r-mixed-a3")).toBeInTheDocument();
    expect(within(card).queryByTestId("pcomp-confirm-r-mixed-a1")).toBeNull();
    expect(within(card).queryByTestId("pcomp-confirm-r-mixed-a2")).toBeNull();
  });

  it("counts overlaps and watched-on from the pairs received", async () => {
    renderView(makeClient({ rivals: [MIXED, SINGLE] }));
    expect(await screen.findByTestId("pcomp-meta-r-mixed")).toHaveTextContent(
      "overlaps 3 of your apps · watched on 2",
    );
    expect(screen.getByTestId("pcomp-meta-r-single")).toHaveTextContent(
      "overlaps 1 of your apps · watched on 1",
    );
  });

  it("summarises the watched section from the response, counting watched pairs only", async () => {
    renderView(makeClient({ rivals: [MIXED, SINGLE, UNWATCHED] }));
    // MIXED contributes 2 confirmed pairs, SINGLE 1; UNWATCHED contributes none.
    expect(await screen.findByTestId("pcomp-watched-summary")).toHaveTextContent("2 rivals · 3 app pairs");
  });

  it("renders NO shared-term count anywhere — the number is not measurable and is absent from the API", async () => {
    const { container } = renderView(makeClient({ rivals: [MIXED, SINGLE, UNWATCHED] }));
    await screen.findByTestId("pcomp-rival-r-mixed");
    expect(container.textContent).not.toMatch(/terms? shared/i);
    expect(container.textContent).not.toMatch(/shared terms?/i);
    // and no placeholder standing in for it: a confirmed chip is the app name
    // plus its per-pair control, and carries no number at all.
    const chip = screen.getByTestId("pcomp-pair-r-mixed-a1");
    expect(chip).toHaveTextContent("Cal AI");
    expect(chip.textContent).not.toMatch(/\d/);
    expect(chip.textContent).not.toMatch(/—/);
    // the comp's trailing footnote existed only to qualify that count
    expect(container.textContent).not.toMatch(/not counted here/i);
  });

  it("names a suggestion's source honestly from the pair's source field", async () => {
    renderView(makeClient({ rivals: [UNWATCHED] }));
    expect(await screen.findByTestId("pcomp-suggestion-meta-r-unwatched-a1")).toHaveTextContent(
      "from Apple’s similar apps · Cal AI",
    );
    expect(screen.getByTestId("pcomp-suggestion-meta-r-unwatched-a2")).toHaveTextContent(
      "from your tracked keywords · Lift Log",
    );
  });

  it("gives Add and Discover an explicit app target and posts to that app's endpoint", async () => {
    const post = vi.fn(async () => ({ competitors: [] }));
    renderView(makeClient({ rivals: [SINGLE], post }));
    const target = await screen.findByTestId("pcomp-target");
    await waitFor(() => expect((target as HTMLSelectElement).value).toBe("a1"));
    expect(screen.getByTestId("pcomp-toolbar")).toHaveTextContent(/for/i);

    fireEvent.change(target, { target: { value: "a2" } });
    fireEvent.change(screen.getByTestId("pcomp-add-name"), { target: { value: "Rival X" } });
    fireEvent.click(screen.getByTestId("pcomp-add"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/a2/competitors", { name: "Rival X" }),
    );

    fireEvent.click(screen.getByTestId("pcomp-discover"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/a2/competitors/discover"),
    );
  });

  it("confirming a pair posts to that pair's app, not the rival alone", async () => {
    const post = vi.fn(async () => ({ competitors: [] }));
    renderView(makeClient({ rivals: [MIXED], post }));
    fireEvent.click(await screen.findByTestId("pcomp-confirm-r-mixed-a3"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/a3/competitors/r-mixed/confirm"),
    );
  });

  it("states that only confirmed pairs feed a run", async () => {
    const { container } = renderView(makeClient({ rivals: [SINGLE] }));
    await screen.findByTestId("pcomp-rival-r-single");
    expect(container.textContent).toMatch(/only .*confirmed.* pairs ever feed a run/i);
  });
});

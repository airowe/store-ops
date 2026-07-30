import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient, PortfolioDeltaEntry } from "@shipaso/api";
import { PortfolioKeywordsView } from "./PortfolioKeywordsView.js";

const entry = (o: Partial<PortfolioDeltaEntry>): PortfolioDeltaEntry => ({
  keyword: "habit tracker",
  previous: null,
  current: null,
  delta: null,
  direction: "unmeasured",
  app_id: "a1",
  app_name: "Acme",
  country: "us",
  ...o,
});

const moved = (o: Partial<PortfolioDeltaEntry>): PortfolioDeltaEntry =>
  entry({ previous: 20, current: 12, delta: 8, direction: "up", ...o });

function clientFor(entries: PortfolioDeltaEntry[] | (() => Promise<never>)) {
  const get = vi.fn(async (path: string) => {
    if (path !== "/keywords") throw new Error("unexpected GET " + path);
    if (typeof entries === "function") return entries();
    return { entries };
  });
  return { get, post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
}

function renderView(c: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortfolioKeywordsView client={c} />
    </QueryClientProvider>,
  );
}

describe("<PortfolioKeywordsView />", () => {
  it("shows the loading state while the ranks are still being read", async () => {
    const never = { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), request: vi.fn() };
    renderView(never as unknown as ApiClient);

    expect(await screen.findByTestId("pkw-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("pkw-empty")).toBeNull();
    expect(screen.queryByTestId("pkw-table")).toBeNull();
  });

  it("empty: says tracking starts on an app's first run and that there is no history before it", async () => {
    renderView(clientFor([]));

    const empty = await screen.findByTestId("pkw-empty");
    expect(empty).toHaveTextContent(/first run/i);
    expect(empty).toHaveTextContent(/no rank history before that point/i);
    expect(screen.queryByTestId("pkw-table")).toBeNull();
  });

  it("populated: renders one row per keyword × app × storefront pair", async () => {
    renderView(
      clientFor([
        moved({ keyword: "sleep", app_id: "a1", app_name: "Dozy", country: "us" }),
        moved({ keyword: "sleep", app_id: "a1", app_name: "Dozy", country: "jp", delta: 3, current: 30 }),
      ]),
    );

    await screen.findByTestId("pkw-table");
    expect(screen.getByTestId("pkw-row-sleep-a1-us")).toHaveTextContent("US");
    expect(screen.getByTestId("pkw-row-sleep-a1-jp")).toHaveTextContent("JP");
  });

  it("populated: header tiles are derived from the entries received, not hardcoded", async () => {
    renderView(
      clientFor([
        moved({ keyword: "one", app_id: "a1", current: 3, direction: "up", delta: 5 }),
        moved({ keyword: "two", app_id: "a2", current: 8, direction: "down", delta: -2 }),
        entry({ keyword: "three", app_id: "a2" }),
      ]),
    );

    await screen.findByTestId("pkw-tiles");
    expect(screen.getByTestId("pkw-tile-tracked")).toHaveTextContent("3");
    expect(screen.getByTestId("pkw-tile-tracked")).toHaveTextContent("across 2 apps · 3 pairs");
    expect(screen.getByTestId("pkw-tile-measured")).toHaveTextContent("1 not checked");
    expect(screen.getByTestId("pkw-tile-top")).toHaveTextContent("of 2 measured");
    expect(screen.getByTestId("pkw-tile-moved")).toHaveTextContent("1 up · 1 down");
    // the comp's sample numbers must never appear as literals
    expect(screen.getByTestId("pkw-tiles")).not.toHaveTextContent("61");
  });

  it("groups a term several apps chase: the lead carries it, continuations carry ↳", async () => {
    renderView(
      clientFor([
        moved({ keyword: "calorie", app_id: "a1", app_name: "Cal AI", delta: 12, current: 4 }),
        moved({ keyword: "calorie", app_id: "a2", app_name: "Macro", delta: 2, current: 30 }),
      ]),
    );

    await screen.findByTestId("pkw-table");
    const lead = screen.getByTestId("pkw-row-calorie-a1-us");
    const cont = screen.getByTestId("pkw-row-calorie-a2-us");

    expect(within(lead).getByTestId("pkw-term")).toHaveTextContent("calorie");
    expect(within(lead).queryByText("↳")).toBeNull();
    expect(within(cont).getByText("↳")).toBeInTheDocument();
    // the continuation does not repeat the term — the group already stated it
    expect(within(cont).getByTestId("pkw-term")).toBeEmptyDOMElement();
  });

  it("unmeasured rows sit in their own section, render '—', and never render 0", async () => {
    renderView(
      clientFor([
        moved({ keyword: "measured one" }),
        entry({ keyword: "gone one", app_id: "a2", app_name: "Macro" }),
        entry({ keyword: "gone two", app_id: "a2", app_name: "Macro" }),
      ]),
    );

    // The copy no longer hedges between two causes: since #360 "fell out of the
    // results" has its own section, so this one can say plainly that we did not
    // check these.
    const header = await screen.findByTestId("pkw-unmeasured-header");
    expect(header).toHaveTextContent("Not checked this week · 2");
    expect(header).toHaveTextContent(/The check hasn't run for these yet\./);

    const row = screen.getByTestId("pkw-row-gone one-a2-us");
    expect(within(row).getByTestId("pkw-rank")).toHaveTextContent("—");
    expect(within(row).getByTestId("pkw-delta")).toHaveTextContent("—");
    expect(row).not.toHaveTextContent("0");
  });

  /**
   * #360 — a term that fell out of the results gets its own section, above
   * "not checked". Both have no rank, but only one of them is news.
   */
  it("a term that fell out of the results is separated from the unchecked ones", async () => {
    renderView(
      clientFor([
        moved({ keyword: "measured one" }),
        entry({ keyword: "fell out", app_id: "a2", app_name: "Macro", previous: 9, direction: "lost" }),
        entry({ keyword: "never checked", app_id: "a2", app_name: "Macro" }),
      ]),
    );

    const lostHeader = await screen.findByTestId("pkw-lost-header");
    expect(lostHeader).toHaveTextContent("Fell out of the results · 1");
    expect(lostHeader).toHaveTextContent(/Ranked last time we checked/);

    // It reads "lost", not the neutral "—", and carries no invented number.
    const row = screen.getByTestId("pkw-row-fell out-a2-us");
    expect(within(row).getByTestId("pkw-delta")).toHaveTextContent("lost");
    expect(within(row).getByTestId("pkw-rank")).toHaveTextContent("—");
    expect(row).not.toHaveTextContent("0");

    // …and the unchecked term is still counted separately.
    expect(screen.getByTestId("pkw-unmeasured-header")).toHaveTextContent("Not checked this week · 1");
  });

  it("omits the unmeasured section entirely when everything was measured", async () => {
    renderView(clientFor([moved({ keyword: "all good" })]));

    await screen.findByTestId("pkw-table");
    expect(screen.queryByTestId("pkw-unmeasured-header")).toBeNull();
  });

  it("uses the house rank-movement vocabulary, driven by direction", async () => {
    renderView(
      clientFor([
        moved({ keyword: "up one", direction: "up", delta: 6, current: 4 }),
        moved({ keyword: "down one", direction: "down", delta: -3, current: 40 }),
        moved({ keyword: "new one", direction: "new", previous: null, delta: null, current: 22 }),
        moved({ keyword: "flat one", direction: "same", delta: 0, current: 60 }),
      ]),
    );

    await screen.findByTestId("pkw-table");
    const deltaOf = (id: string) =>
      within(screen.getByTestId(id)).getByTestId("pkw-delta").textContent;

    expect(deltaOf("pkw-row-up one-a1-us")).toBe("▲6");
    expect(deltaOf("pkw-row-down one-a1-us")).toBe("▼3");
    expect(deltaOf("pkw-row-new one-a1-us")).toBe("new");
    // a flat week is "—", not "0" — a fabricated-looking zero move
    expect(deltaOf("pkw-row-flat one-a1-us")).toBe("—");
  });

  it("filters the table by term and by app name", async () => {
    renderView(
      clientFor([
        moved({ keyword: "sleep sounds", app_name: "Dozy", app_id: "a1" }),
        moved({ keyword: "calorie count", app_name: "Cal AI", app_id: "a2" }),
      ]),
    );

    await screen.findByTestId("pkw-table");
    fireEvent.change(screen.getByTestId("pkw-filter-input"), { target: { value: "cal ai" } });

    await waitFor(() => expect(screen.queryByTestId("pkw-row-sleep sounds-a1-us")).toBeNull());
    expect(screen.getByTestId("pkw-row-calorie count-a2-us")).toBeInTheDocument();
  });

  it("filter chips carry live counts and narrow the table", async () => {
    renderView(
      clientFor([
        moved({ keyword: "moved one", direction: "up", delta: 4, current: 50 }),
        moved({ keyword: "top one", direction: "same", delta: 0, current: 2 }),
      ]),
    );

    await screen.findByTestId("pkw-table");
    expect(screen.getByTestId("pkw-chip-top")).toHaveTextContent("Top 10 · 1");

    fireEvent.click(screen.getByTestId("pkw-chip-top"));
    await waitFor(() => expect(screen.queryByTestId("pkw-row-moved one-a1-us")).toBeNull());
    expect(screen.getByTestId("pkw-row-top one-a1-us")).toBeInTheDocument();
  });

  it("does not ship the comp's state switcher or an unwired sort button", async () => {
    renderView(clientFor([moved({})]));

    await screen.findByTestId("pkw-table");
    expect(screen.queryByText(/populated · empty · loading/i)).toBeNull();
    const buttons = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(buttons.some((t) => /biggest move/i.test(t))).toBe(false);
  });

  it("states the read cadence and that history opens on the app, without a per-row sparkline", async () => {
    renderView(clientFor([moved({})]));

    const footnote = await screen.findByTestId("pkw-footnote");
    expect(footnote).toHaveTextContent(/once per week, per app, per storefront/i);
    expect(footnote).toHaveTextContent(/history opens on the app it belongs to/i);
    // getRanks is an app-level series — a per-row sparkline would draw the app's
    // trend against a keyword's name.
    expect(document.querySelectorAll("svg")).toHaveLength(0);
  });
});

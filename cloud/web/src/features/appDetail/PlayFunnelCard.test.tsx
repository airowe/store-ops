import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { PlayFunnelCard } from "./PlayFunnelCard.js";

const MEASURED = {
  state: "measured",
  cadence: "monthly",
  throughPeriod: "2026-06",
  months: [
    { period: "2026-06", country: "us", visitors: 1000, acquisitions: 120, conversionRate: 0.12 },
    { period: "2026-06", country: "jp", visitors: 500, acquisitions: null, conversionRate: null },
  ],
};

function makeClient({ funnel = MEASURED as unknown, credentials = [] as unknown[] } = {}) {
  const get = vi.fn(async (path: string) => {
    if (path.endsWith("/play-funnel")) return funnel;
    if (path === "/account/credentials") return { enabled: true, credentials };
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async (path: string) => {
    if (path.endsWith("/play-funnel/ingest")) return { ingested: 2, periods: ["2026-06"] };
    throw new Error("unexpected POST " + path);
  });
  return { client: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
}

function renderCard(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PlayFunnelCard client={client} appId="a1" />
    </QueryClientProvider>,
  );
}

describe("<PlayFunnelCard />", () => {
  it("renders the monthly series with an honest 'through' stamp and derived conversion", async () => {
    const { client } = makeClient();
    renderCard(client);
    expect(await screen.findByTestId("pf-stamp")).toHaveTextContent(/Monthly · through 2026-06/);
    // derived conversion shows the computed rate, and "—" where it can't be computed
    expect(screen.getByTestId("pf-row-2026-06-us")).toHaveTextContent("12.0%");
    const jp = screen.getByTestId("pf-row-2026-06-jp");
    expect(jp).toHaveTextContent("—"); // null acquisitions + null rate, never a fake 0
  });

  it("empty state prompts an ingest; ingest posts package + account and refreshes", async () => {
    const empty = { state: "empty", cadence: "monthly", throughPeriod: null, months: [] };
    const { client, post } = makeClient({ funnel: empty });
    renderCard(client);
    expect(await screen.findByTestId("pf-empty")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("pf-ingest")).toBeDisabled());
    fireEvent.change(screen.getByTestId("pf-package"), { target: { value: "com.foo.bar" } });
    fireEvent.change(screen.getByTestId("pf-account"), { target: { value: "12345" } });
    fireEvent.change(screen.getByTestId("pf-sa"), { target: { value: '{"client_email":"x"}' } });
    expect(screen.getByTestId("pf-ingest")).toBeEnabled();
    fireEvent.click(screen.getByTestId("pf-ingest"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/a1/play-funnel/ingest", {
        packageName: "com.foo.bar",
        accountId: "12345",
        serviceAccount: '{"client_email":"x"}',
      }),
    );
    expect(await screen.findByTestId("pf-success")).toHaveTextContent(/Pulled 2 row/);
  });
});

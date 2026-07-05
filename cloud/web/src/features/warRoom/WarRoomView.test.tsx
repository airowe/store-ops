import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { WarRoomView } from "./WarRoomView.js";

function makeClient() {
  const get = vi.fn(async (path: string) => {
    // echo the requested competitors so the grid reflects the selection
    const m = path.match(/competitors=([^&]+)/);
    const competitors = m ? decodeURIComponent(m[1]).split(",") : ["A", "B"];
    return {
      appName: "Acme",
      competitors,
      window: 7,
      checkedAt: "2026-07-04T00:00:00Z",
      warRoom: [
        {
          keyword: "todo",
          you: 5,
          youPrevious: null,
          competitors: competitors.map((c) => ({ name: c, rank: 9 })),
          gapToBest: -4,
          trend: "gaining",
          winning: true,
        },
      ],
    };
  });
  return { client: { get, post: vi.fn(), request: vi.fn() } as unknown as ApiClient, get };
}

function renderView(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WarRoomView client={client} id="a1" />
    </QueryClientProvider>,
  );
}

describe("<WarRoomView />", () => {
  it("renders the grid, competitor chips, and an honest 'as of' line", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("chip-A")).toBeInTheDocument());
    expect(screen.getByTestId("war-todo")).toBeInTheDocument();
    expect(screen.getByTestId("as-of")).toHaveTextContent("As of 2026-07-04");
  });

  it("toggling a competitor chip refetches with the new set", async () => {
    const { client, get } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("chip-B"));
    fireEvent.click(screen.getByTestId("chip-B")); // turn B off
    await waitFor(() => {
      const calledWithAOnly = get.mock.calls.some(
        ([p]) => /war-room\?competitors=A$/.test(p as string),
      );
      expect(calledWithAOnly).toBe(true);
    });
  });
});

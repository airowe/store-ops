import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { CompetitorsCard } from "./CompetitorsCard.js";

const CONFIRMED = { key: "111", name: "Rival A", source: "user", status: "confirmed" };
const SUGGESTED = { key: "222", name: "Rival B", source: "similar", status: "suggested" };

function makeClient(initial: unknown[], post?: any, request?: any) {
  const get = vi.fn(async (path: string) => {
    if (path === "/apps/a1/competitors") return { competitors: initial };
    throw new Error("unexpected GET " + path);
  });
  return {
    client: {
      get,
      post: post ?? vi.fn(),
      request: request ?? vi.fn(),
    } as unknown as ApiClient,
  };
}

function renderCard(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CompetitorsCard client={client} appId="a1" />
    </QueryClientProvider>,
  );
}

describe("<CompetitorsCard />", () => {
  it("splits confirmed vs suggested; only suggested get Confirm/Dismiss", async () => {
    const { client } = makeClient([CONFIRMED, SUGGESTED]);
    renderCard(client);
    await waitFor(() => expect(screen.getByTestId("comp-111")).toBeInTheDocument());
    expect(screen.getByTestId("comp-remove-111")).toBeInTheDocument(); // confirmed → remove only
    expect(screen.queryByTestId("comp-confirm-111")).toBeNull();
    expect(screen.getByTestId("comp-confirm-222")).toBeInTheDocument(); // suggested → confirm + dismiss
    expect(screen.getByTestId("comp-dismiss-222")).toBeInTheDocument();
  });

  it("Confirm posts to the confirm endpoint and updates the list from the response", async () => {
    const post = vi.fn(async (path: string) => {
      if (path === "/apps/a1/competitors/222/confirm") return { competitors: [CONFIRMED, { ...SUGGESTED, status: "confirmed" }] };
      throw new Error("unexpected POST " + path);
    });
    const { client } = makeClient([CONFIRMED, SUGGESTED], post);
    renderCard(client);
    await waitFor(() => screen.getByTestId("comp-confirm-222"));
    fireEvent.click(screen.getByTestId("comp-confirm-222"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/apps/a1/competitors/222/confirm"));
    // now both are confirmed → no more suggested section
    await waitFor(() => expect(screen.queryByTestId("comp-suggested")).toBeNull());
  });

  it("Discover posts and surfaces the honest note", async () => {
    const post = vi.fn(async () => ({ competitors: [], discovered: 0, note: "No tracked keywords yet." }));
    const { client } = makeClient([], post);
    renderCard(client);
    await waitFor(() => screen.getByTestId("comp-discover"));
    fireEvent.click(screen.getByTestId("comp-discover"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/apps/a1/competitors/discover"));
    expect(await screen.findByTestId("comp-note")).toHaveTextContent("No tracked keywords yet.");
  });

  it("Remove uses DELETE via request", async () => {
    const request = vi.fn(async () => ({ competitors: [] }));
    const { client } = makeClient([CONFIRMED], undefined, request);
    renderCard(client);
    await waitFor(() => screen.getByTestId("comp-remove-111"));
    fireEvent.click(screen.getByTestId("comp-remove-111"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/apps/a1/competitors/111", { method: "DELETE" }));
  });
});

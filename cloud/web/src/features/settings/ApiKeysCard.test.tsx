import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { ApiKeysCard } from "./ApiKeysCard.js";

function makeClient({ created }: { created?: unknown } = {}) {
  let listCall = 0;
  const get = vi.fn(async (path: string) => {
    if (path === "/account/api-keys") {
      listCall += 1;
      // empty before creation; one key after (the card invalidates + refetches)
      return listCall === 1
        ? { keys: [] }
        : { keys: [{ id: "k1", label: "Claude Code", prefix: "shipaso_1a2b3c4d…", createdAt: "2026-07-13", lastUsedAt: null }] };
    }
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async () =>
    created ?? { id: "k1", label: "Claude Code", prefix: "shipaso_1a2b3c4d…", createdAt: "2026-07-13", lastUsedAt: null, key: "shipaso_deadbeef".padEnd(56, "0") },
  );
  const request = vi.fn(async () => ({ revoked: true }));
  return { client: { get, post, request } as unknown as ApiClient, post, request };
}

function renderCard(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiKeysCard client={client} />
    </QueryClientProvider>,
  );
}

describe("<ApiKeysCard />", () => {
  it("generates a key, shows the raw value ONCE, then lists it", async () => {
    const { client, post } = makeClient();
    renderCard(client);
    fireEvent.change(screen.getByTestId("ak-label"), { target: { value: "Claude Code" } });
    fireEvent.click(screen.getByTestId("ak-create"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/account/api-keys", { label: "Claude Code" }));
    // the raw key is shown exactly once, right after creation
    expect(await screen.findByTestId("ak-fresh-value")).toHaveTextContent("shipaso_deadbeef");
    // and the new key appears in the list (by prefix, never the raw value)
    await waitFor(() => expect(screen.getByTestId("ak-k1")).toHaveTextContent("shipaso_1a2b3c4d…"));
  });

  it("revokes a key via DELETE", async () => {
    const { client, request } = makeClient();
    renderCard(client);
    // create so the list has a key to revoke
    fireEvent.click(screen.getByTestId("ak-create"));
    await waitFor(() => expect(screen.getByTestId("ak-revoke-k1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ak-revoke-k1"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/account/api-keys/k1", { method: "DELETE" }));
  });
});

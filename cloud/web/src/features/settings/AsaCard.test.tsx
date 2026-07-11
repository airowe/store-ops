import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { AsaCard } from "./AsaCard.js";

function makeClient(note = "Connected and verified. Popularity turns on once verified on this deployment.") {
  const post = vi.fn(async () => ({ credential: { id: "c9", kind: "asa", keyId: "K" }, popularityLive: false, note }));
  return { client: { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient, post };
}

function renderCard(client: ApiClient, hasAsaKey = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AsaCard client={client} hasAsaKey={hasAsaKey} />
    </QueryClientProvider>,
  );
}

describe("<AsaCard />", () => {
  it("renders nothing once an ASA key is connected (Stored keys manages it)", () => {
    const { client } = makeClient();
    const { container } = renderCard(client, true);
    expect(container.firstChild).toBeNull();
  });

  it("Connect is gated until all five fields are filled, then posts and shows Apple's note", async () => {
    const { client, post } = makeClient();
    renderCard(client);
    expect(screen.getByTestId("asa-connect")).toBeDisabled();
    fireEvent.change(screen.getByTestId("asa-client-id"), { target: { value: "SEARCHADS.abc" } });
    fireEvent.change(screen.getByTestId("asa-team-id"), { target: { value: "SEARCHADS.abc" } });
    fireEvent.change(screen.getByTestId("asa-key-id"), { target: { value: "key-1" } });
    fireEvent.change(screen.getByTestId("asa-org-id"), { target: { value: "77" } });
    fireEvent.change(screen.getByTestId("asa-private-key"), { target: { value: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----" } });
    expect(screen.getByTestId("asa-connect")).toBeEnabled();
    fireEvent.click(screen.getByTestId("asa-connect"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/account/asa-credential", {
        privateKey: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
        clientId: "SEARCHADS.abc",
        teamId: "SEARCHADS.abc",
        keyId: "key-1",
        orgId: "77",
      }),
    );
    expect(await screen.findByTestId("asa-note")).toHaveTextContent(/Popularity turns on/i);
  });
});

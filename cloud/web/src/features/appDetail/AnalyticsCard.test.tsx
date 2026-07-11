import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { AnalyticsCard } from "./AnalyticsCard.js";

const ASC_CRED = { id: "c1", appId: "a1", kind: "asc", keyId: "KID9", issuerId: "iss", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, kekVersion: 1 };

function makeClient({ credentials = [] as unknown[], enable, ingest }: { credentials?: unknown[]; enable?: unknown; ingest?: unknown } = {}) {
  const get = vi.fn(async (path: string) => {
    if (path === "/account/credentials") return { enabled: true, credentials };
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async (path: string) => {
    if (path.endsWith("/analytics/enable")) return enable ?? { state: "pending", message: "Analytics requested — ~1–2 days.", requestId: "R1", created: true };
    if (path.endsWith("/analytics/ingest")) return ingest ?? { state: "ingested", instances: 1, rowsPersisted: 3, days: 2 };
    throw new Error("unexpected POST " + path);
  });
  return { client: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
}

function renderCard(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AnalyticsCard client={client} appId="a1" />
    </QueryClientProvider>,
  );
}

describe("<AnalyticsCard />", () => {
  it("no saved key: enable is disabled until an Admin key is pasted", async () => {
    const { client } = makeClient();
    renderCard(client);
    await waitFor(() => expect(screen.getByTestId("an-enable")).toBeInTheDocument());
    expect(screen.getByTestId("an-enable")).toBeDisabled();
    fireEvent.change(screen.getByTestId("an-key-id"), { target: { value: "K" } });
    fireEvent.change(screen.getByTestId("an-issuer-id"), { target: { value: "I" } });
    fireEvent.change(screen.getByTestId("an-p8"), { target: { value: "P" } });
    expect(screen.getByTestId("an-enable")).toBeEnabled();
  });

  it("a saved key enables in one click (useStored) and shows the pending state", async () => {
    const { client, post } = makeClient({ credentials: [ASC_CRED] });
    renderCard(client);
    await waitFor(() => expect(screen.getByText(/Using your saved key \(KID9\)/)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("an-enable"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/apps/a1/analytics/enable", { useStored: true }));
    expect(await screen.findByTestId("an-state")).toHaveTextContent(/~1–2 days/);
  });

  it("a non-Admin key surfaces Apple's 'needs Admin' message verbatim — no ingest offered", async () => {
    const { client } = makeClient({ credentials: [ASC_CRED], enable: { state: "admin_required", message: "Your key needs the Admin role to read analytics." } });
    renderCard(client);
    await waitFor(() => screen.getByTestId("an-enable"));
    fireEvent.click(screen.getByTestId("an-enable"));
    expect(await screen.findByTestId("an-state")).toHaveTextContent("needs the Admin role");
    expect(screen.queryByTestId("an-ingest")).toBeNull();
  });

  it("once pending, 'Ingest now' appears and reports persisted counts", async () => {
    const { client, post } = makeClient({ credentials: [ASC_CRED] });
    renderCard(client);
    await waitFor(() => screen.getByTestId("an-enable"));
    fireEvent.click(screen.getByTestId("an-enable"));
    await waitFor(() => expect(screen.getByTestId("an-ingest")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("an-ingest"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/apps/a1/analytics/ingest", { useStored: true }));
    expect(await screen.findByTestId("an-ingest-result")).toHaveTextContent("Ingested 3 rows across 2 days.");
  });
});

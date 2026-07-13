import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { PlayDataSafetyCard } from "./PlayDataSafetyCard.js";

const CSV = "data_type,collected,shared\nLocation,true,false";

function makeClient({ credentials = [] as unknown[] } = {}) {
  const get = vi.fn(async (path: string) => {
    if (path === "/account/credentials") return { enabled: true, credentials };
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async (path: string) => {
    if (path.endsWith("/play-data-safety")) return { packageName: "com.foo.bar", pushed: true };
    throw new Error("unexpected POST " + path);
  });
  return { client: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
}

function renderCard(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PlayDataSafetyCard client={client} appId="a1" />
    </QueryClientProvider>,
  );
}

describe("<PlayDataSafetyCard />", () => {
  it("push stays disabled until package + CSV + service account + explicit confirm", async () => {
    const { client, post } = makeClient();
    renderCard(client);
    await waitFor(() => expect(screen.getByTestId("pds-push")).toBeDisabled());

    fireEvent.change(screen.getByTestId("pds-package"), { target: { value: "com.foo.bar" } });
    fireEvent.change(screen.getByTestId("pds-csv"), { target: { value: CSV } });
    fireEvent.change(screen.getByTestId("pds-sa"), { target: { value: '{"client_email":"x"}' } });
    // still disabled until the human ticks the confirm box (legal declaration)
    expect(screen.getByTestId("pds-push")).toBeDisabled();

    fireEvent.click(screen.getByTestId("pds-confirm"));
    expect(screen.getByTestId("pds-push")).toBeEnabled();

    fireEvent.click(screen.getByTestId("pds-push"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/a1/play-data-safety", {
        packageName: "com.foo.bar",
        safetyLabels: CSV,
        serviceAccount: '{"client_email":"x"}',
      }),
    );
    expect(await screen.findByTestId("pds-success")).toBeInTheDocument();
  });

  it("a saved Play key pushes with useStored (no service-account box)", async () => {
    const playCred = { id: "p1", appId: "a1", kind: "play", keyId: "svc@x", issuerId: "", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, kekVersion: 1 };
    const { client, post } = makeClient({ credentials: [playCred] });
    renderCard(client);
    await waitFor(() => screen.getByTestId("pds-push"));
    expect(screen.queryByTestId("pds-sa")).toBeNull();
    fireEvent.change(screen.getByTestId("pds-package"), { target: { value: "com.foo.bar" } });
    fireEvent.change(screen.getByTestId("pds-csv"), { target: { value: CSV } });
    fireEvent.click(screen.getByTestId("pds-confirm"));
    fireEvent.click(screen.getByTestId("pds-push"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/a1/play-data-safety", {
        packageName: "com.foo.bar",
        safetyLabels: CSV,
        useStored: true,
      }),
    );
  });
});

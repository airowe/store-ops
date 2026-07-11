import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { GithubCard } from "./GithubCard.js";

function makeClient(status: unknown) {
  const get = vi.fn(async (path: string) => {
    if (path === "/github/status") return status;
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async (_path: string, body: any) => ({ connected: !!body?.installation_id, repo: body?.repo ?? null }));
  return { client: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
}

function renderCard(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GithubCard client={client} />
    </QueryClientProvider>,
  );
}

describe("<GithubCard />", () => {
  it("inert when the GitHub App isn't configured on the deployment", async () => {
    const { client } = makeClient({ appConfigured: false, connected: false, repo: null });
    renderCard(client);
    await waitFor(() => expect(screen.getByTestId("gh-unconfigured")).toBeInTheDocument());
    expect(screen.queryByTestId("gh-connect")).toBeNull();
  });

  it("configured + not connected: Connect is gated on an installation id + owner/name repo", async () => {
    const { client, post } = makeClient({ appConfigured: true, connected: false, repo: null });
    renderCard(client);
    await waitFor(() => expect(screen.getByTestId("gh-connect")).toBeDisabled());
    fireEvent.change(screen.getByTestId("gh-installation"), { target: { value: "12345" } });
    fireEvent.change(screen.getByTestId("gh-repo"), { target: { value: "not-a-repo" } });
    expect(screen.getByTestId("gh-connect")).toBeDisabled(); // repo must be owner/name
    fireEvent.change(screen.getByTestId("gh-repo"), { target: { value: "airowe/store-ops" } });
    expect(screen.getByTestId("gh-connect")).toBeEnabled();
    fireEvent.click(screen.getByTestId("gh-connect"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/github/connect", { installation_id: "12345", repo: "airowe/store-ops" }));
  });

  it("connected: shows the linked repo and disconnects", async () => {
    const { client, post } = makeClient({ appConfigured: true, connected: true, repo: "airowe/store-ops" });
    renderCard(client);
    await waitFor(() => expect(screen.getByTestId("gh-connected")).toHaveTextContent("airowe/store-ops"));
    fireEvent.click(screen.getByTestId("gh-disconnect"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/github/connect", {}));
  });
});

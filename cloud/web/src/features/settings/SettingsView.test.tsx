import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { SettingsView } from "./SettingsView.js";

function makeClient() {
  const meData = { email: "me@x.com", push_run_ready: true, email_digest: "weekly", rank_cadence: "weekly" };
  const creds = {
    enabled: true,
    credentials: [
      { id: "c1", appId: null, kind: "asc", keyId: "KID123", issuerId: "iss", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, kekVersion: 1 },
    ],
  };
  const get = vi.fn(async (path: string) => {
    if (path === "/auth/me") return meData;
    if (path === "/account/credentials") return creds;
    if (path === "/github/status") return { appConfigured: false, connected: false, repo: null };
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async (path: string, body: any) => {
    if (path === "/account/notifications") {
      return { push_run_ready: body.push_run_ready ?? meData.push_run_ready, email_digest: body.email_digest ?? meData.email_digest };
    }
    if (path === "/account/rank-cadence") return { rank_cadence: body.cadence };
    if (path === "/agent/pause") return { paused: true };
    if (path === "/agent/resume") return { paused: false };
    if (path === "/auth/logout") return { ok: true };
    throw new Error("unexpected POST " + path);
  });
  const request = vi.fn(async () => ({ deleted: true, note: "removed" }));
  return { client: { get, post, request } as unknown as ApiClient, get, post, request };
}

function renderView(client: ApiClient, onSignedOut?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsView client={client} onSignedOut={onSignedOut} />
    </QueryClientProvider>,
  );
}

describe("<SettingsView />", () => {
  it("seeds from /auth/me and shows the honesty copy", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("push-toggle")).toHaveTextContent("On"));
    expect(screen.getByText(/never what the agent does/i)).toBeInTheDocument();
    expect(screen.getByText(/Data collection — not email frequency/i)).toBeInTheDocument();
  });

  it("toggling push OFF posts push_run_ready:false and flips the label", async () => {
    const { client, post } = makeClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("push-toggle")).toHaveTextContent("On"));
    fireEvent.click(screen.getByTestId("push-toggle"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/account/notifications", { push_run_ready: false }),
    );
    await waitFor(() => expect(screen.getByTestId("push-toggle")).toHaveTextContent("Off"));
  });

  it("switching cadence to Daily calls setRankCadence('daily')", async () => {
    const { client, post } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("cadence-daily"));
    fireEvent.click(screen.getByTestId("cadence-daily"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/account/rank-cadence", { cadence: "daily" }));
  });

  it("renders stored-key METADATA and deletes via DELETE", async () => {
    const { client, request } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("delete-asc"));
    expect(screen.getByText(/ASC · KID123/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("delete-asc"));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/account/credentials/asc", { method: "DELETE" }),
    );
  });

  it("pausing the autonomous sweep posts /agent/pause and flips to Paused", async () => {
    const { client, post } = makeClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("pause-toggle")).toHaveTextContent("Active"));
    expect(screen.getByText(/this changes what the agent does/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pause-toggle"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/agent/pause"));
    await waitFor(() => expect(screen.getByTestId("pause-toggle")).toHaveTextContent("Paused"));
  });

  it("sign out calls logout and notifies", async () => {
    const { client, post } = makeClient();
    const onSignedOut = vi.fn();
    renderView(client, onSignedOut);
    await waitFor(() => screen.getByTestId("sign-out"));
    fireEvent.click(screen.getByTestId("sign-out"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/auth/logout"));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });
});

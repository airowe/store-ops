import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { ConnectAscCard } from "./ConnectAscCard.js";

const ASC_CRED = {
  id: "c1",
  appId: "a1",
  kind: "asc",
  keyId: "KID123",
  issuerId: "iss",
  createdAt: "2026-07-01T00:00:00Z",
  lastUsedAt: null,
  kekVersion: 1,
};

function makeClient({ credentials = [] as unknown[], enabled = true } = {}) {
  const get = vi.fn(async (path: string) => {
    if (path === "/account/credentials") return { enabled, credentials };
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async (path: string) => {
    if (path === "/apps/a1/run-asc") {
      return { id: "run-new", status: "awaiting_approval", digest: "", ascRead: true };
    }
    throw new Error("unexpected POST " + path);
  });
  return { client: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
}

function renderCard(client: ApiClient, onRunStarted = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConnectAscCard client={client} appId="a1" onRunStarted={onRunStarted} />
    </QueryClientProvider>,
  );
  return onRunStarted;
}

describe("<ConnectAscCard />", () => {
  it("no stored key: submits the trio with store:true (default) and reports the new run", async () => {
    const { client, post } = makeClient();
    const onRunStarted = renderCard(client);
    await waitFor(() => expect(screen.getByTestId("asc-key-id")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("asc-key-id"), { target: { value: "KID1" } });
    fireEvent.change(screen.getByTestId("asc-issuer-id"), { target: { value: "ISS1" } });
    fireEvent.change(screen.getByTestId("asc-p8"), { target: { value: "-----BEGIN PRIVATE KEY-----" } });
    fireEvent.click(screen.getByTestId("asc-connect"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/a1/run-asc", {
        p8: "-----BEGIN PRIVATE KEY-----",
        keyId: "KID1",
        issuerId: "ISS1",
        store: true,
      }),
    );
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith("run-new"));
  });

  it("unchecking 'save key' sends store:false — the key stays request-only", async () => {
    const { client, post } = makeClient();
    renderCard(client);
    await waitFor(() => screen.getByTestId("asc-key-id"));
    fireEvent.change(screen.getByTestId("asc-key-id"), { target: { value: "K" } });
    fireEvent.change(screen.getByTestId("asc-issuer-id"), { target: { value: "I" } });
    fireEvent.change(screen.getByTestId("asc-p8"), { target: { value: "P" } });
    fireEvent.click(screen.getByTestId("asc-store"));
    fireEvent.click(screen.getByTestId("asc-connect"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/a1/run-asc", {
        p8: "P", keyId: "K", issuerId: "I", store: false,
      }),
    );
  });

  it("stored key present: offers the one-click keyed audit via useStored", async () => {
    const { client, post } = makeClient({ credentials: [ASC_CRED] });
    const onRunStarted = renderCard(client);
    await waitFor(() => expect(screen.getByTestId("asc-run-stored")).toBeInTheDocument());
    expect(screen.getByText(/KID123/)).toBeInTheDocument();
    expect(screen.queryByTestId("asc-p8")).toBeNull(); // no re-paste
    fireEvent.click(screen.getByTestId("asc-run-stored"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/a1/run-asc", { useStored: true }),
    );
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith("run-new"));
  });

  it("no stored key: shows how-to-get-your-key guidance with an Apple deep link", async () => {
    const { client } = makeClient();
    renderCard(client);
    await waitFor(() => screen.getByTestId("asc-key-id"));
    const help = screen.getByTestId("asc-key-help");
    expect(help).toBeInTheDocument();
    // mentions the self-serve Individual-key path (no admin role needed)
    expect(help.textContent).toMatch(/individual/i);
    // deep-links to Apple's key page, opening in a new tab safely
    const link = screen.getByTestId("asc-key-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("appstoreconnect.apple.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("stored key present: the how-to guidance is gone (already connected)", async () => {
    const { client } = makeClient({ credentials: [ASC_CRED] });
    renderCard(client);
    await waitFor(() => screen.getByTestId("asc-run-stored"));
    expect(screen.queryByTestId("asc-key-help")).toBeNull();
  });

  it("storage disabled on this deployment: form still works, save option absent", async () => {
    const { client, post } = makeClient({ enabled: false });
    renderCard(client);
    await waitFor(() => screen.getByTestId("asc-key-id"));
    expect(screen.queryByTestId("asc-store")).toBeNull();
    fireEvent.change(screen.getByTestId("asc-key-id"), { target: { value: "K" } });
    fireEvent.change(screen.getByTestId("asc-issuer-id"), { target: { value: "I" } });
    fireEvent.change(screen.getByTestId("asc-p8"), { target: { value: "P" } });
    fireEvent.click(screen.getByTestId("asc-connect"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/a1/run-asc", { p8: "P", keyId: "K", issuerId: "I" }),
    );
  });

  it("surfaces a failed keyed run honestly", async () => {
    const { client, post } = makeClient({ credentials: [ASC_CRED] });
    post.mockRejectedValueOnce(new Error("Apple rejected the credential (401/403)."));
    renderCard(client);
    await waitFor(() => screen.getByTestId("asc-run-stored"));
    fireEvent.click(screen.getByTestId("asc-run-stored"));
    await waitFor(() =>
      expect(screen.getByTestId("asc-error")).toHaveTextContent(/Apple rejected the credential/),
    );
  });
});

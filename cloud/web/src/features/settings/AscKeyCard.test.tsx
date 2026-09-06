import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { AscKeyCard } from "./AscKeyCard.js";

function makeClient(postImpl?: (path: string, body: unknown) => Promise<unknown>) {
  const post = vi.fn(postImpl ?? (async () => ({ ok: true, credential: { id: "c9", appId: null, kind: "asc", keyId: "NC235A8728" } })));
  return { client: { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient, post };
}

function renderCard(client: ApiClient, hasAccountKey = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AscKeyCard client={client} hasAccountKey={hasAccountKey} />
    </QueryClientProvider>,
  );
}

describe("<AscKeyCard />", () => {
  it("shows the stored key as metadata only when one exists", () => {
    renderCard(makeClient().client, true);
    expect(screen.getByTestId("asc-key-status-pill")).toHaveTextContent("Verified");
    expect(screen.getByTestId("asc-key-meta")).toHaveTextContent(/Account-wide/);
    expect(screen.queryByTestId("asc-p8")).not.toBeInTheDocument();
  });

  it("stays disabled until all three fields are filled, then POSTs the trio and clears the form", async () => {
    const { client, post } = makeClient();
    renderCard(client);
    fireEvent.click(screen.getByTestId("asc-key-reveal"));
    expect(screen.getByTestId("asc-key-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("asc-key-id"), { target: { value: "NC235A8728" } });
    fireEvent.change(screen.getByTestId("asc-issuer-id"), { target: { value: "166b49fe" } });
    fireEvent.change(screen.getByTestId("asc-p8"), { target: { value: "-----BEGIN PRIVATE KEY-----\nx" } });
    expect(screen.getByTestId("asc-key-save")).toBeEnabled();
    fireEvent.click(screen.getByTestId("asc-key-save"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/account/credentials/asc", { p8: "-----BEGIN PRIVATE KEY-----\nx", keyId: "NC235A8728", issuerId: "166b49fe" }),
    );
    await waitFor(() => expect((screen.getByTestId("asc-p8") as HTMLTextAreaElement).value).toBe(""));
  });

  it("shows the server's refusal verbatim and keeps nothing stored", async () => {
    const { client } = makeClient(async () => {
      throw new Error("App Store Connect rejected this key on a read (HTTP 401); nothing was saved");
    });
    renderCard(client);
    fireEvent.click(screen.getByTestId("asc-key-reveal"));
    fireEvent.change(screen.getByTestId("asc-key-id"), { target: { value: "K" } });
    fireEvent.change(screen.getByTestId("asc-issuer-id"), { target: { value: "I" } });
    fireEvent.change(screen.getByTestId("asc-p8"), { target: { value: "p8" } });
    fireEvent.click(screen.getByTestId("asc-key-save"));
    expect(await screen.findByTestId("asc-key-error")).toHaveTextContent(/nothing was saved/);
    expect(screen.getByTestId("asc-key-status-pill")).not.toHaveTextContent("Verified");
  });
});

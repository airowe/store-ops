import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { LaunchSignup } from "./LaunchSignup.js";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("<LaunchSignup />", () => {
  it("posts the email to /subscribe and confirms", async () => {
    const post = vi.fn(async () => ({ ok: true }));
    const client = { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
    wrap(<LaunchSignup client={client} />);
    fireEvent.change(screen.getByTestId("launch-email"), { target: { value: "me@x.com" } });
    fireEvent.click(screen.getByTestId("launch-submit"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/subscribe", { email: "me@x.com" }));
    await waitFor(() => expect(screen.getByTestId("launch-done")).toBeVisible());
  });

  it("won't submit an invalid email", () => {
    const post = vi.fn();
    const client = { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
    wrap(<LaunchSignup client={client} />);
    fireEvent.change(screen.getByTestId("launch-email"), { target: { value: "not-an-email" } });
    expect(screen.getByTestId("launch-submit")).toBeDisabled();
  });

  it("still confirms honestly on a network error (server is idempotent + best-effort)", async () => {
    // The server records best-effort and never reveals failure; the UI shouldn't
    // scare a launch-list signup with a red error. On error we still thank them.
    const post = vi.fn(async () => {
      throw new Error("network");
    });
    const client = { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
    wrap(<LaunchSignup client={client} />);
    fireEvent.change(screen.getByTestId("launch-email"), { target: { value: "me@x.com" } });
    fireEvent.click(screen.getByTestId("launch-submit"));
    await waitFor(() => expect(screen.getByTestId("launch-done")).toBeVisible());
  });
});

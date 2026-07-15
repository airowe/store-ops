import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { ListingAudit } from "./ListingAudit.js";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function clientReturning(result: unknown): ApiClient {
  const post = vi.fn(async () => result);
  return { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
}

describe("<ListingAudit />", () => {
  it("audits a query and renders the real grade + summary", async () => {
    const client = clientReturning({
      preview: {
        appName: "Weatherly",
        auditGrade: "B",
        leadKeyword: "weather",
        leadRank: 12,
        keywordsChecked: 20,
        inTop10: 4,
        sample: [{ keyword: "weather", rank: 12 }, { keyword: "radar", rank: null }],
      },
    });
    wrap(<ListingAudit client={client} onSignIn={vi.fn()} />);
    fireEvent.change(screen.getByTestId("preview-query"), { target: { value: "weatherly" } });
    fireEvent.click(screen.getByTestId("preview-search"));
    await waitFor(() => expect(screen.getByTestId("preview-grade")).toHaveTextContent("B"));
    expect(screen.getByTestId("preview-summary")).toHaveTextContent("#12");
    expect(screen.getByTestId("preview-sample")).toHaveTextContent("—"); // null rank never fabricated
  });

  it("surfaces the server's message on a no-match (404-as-throw)", async () => {
    const post = vi.fn(async () => { throw new Error("no app found for zzz"); });
    const client = { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
    wrap(<ListingAudit client={client} onSignIn={vi.fn()} />);
    fireEvent.change(screen.getByTestId("preview-query"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByTestId("preview-search"));
    await waitFor(() => expect(screen.getByTestId("preview-note")).toHaveTextContent("no app found for zzz"));
  });

  it("calls onSignIn from the result's sign-in-to-run button", async () => {
    const onSignIn = vi.fn();
    const client = clientReturning({
      preview: { appName: "X", auditGrade: "A", leadKeyword: "k", leadRank: 1, keywordsChecked: 1, inTop10: 1, sample: [] },
    });
    wrap(<ListingAudit client={client} onSignIn={onSignIn} />);
    fireEvent.change(screen.getByTestId("preview-query"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("preview-search"));
    await waitFor(() => screen.getByTestId("preview-signin"));
    fireEvent.click(screen.getByTestId("preview-signin"));
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});

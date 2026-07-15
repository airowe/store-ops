import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { LandingView } from "./LandingView.js";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("<LandingView />", () => {
  it("renders the hero, the inline audit input, and the how-it-works steps", async () => {
    const client = { get: vi.fn(async () => ({ appsWithWins: 0, totalWins: 0, bestImprovement: 0, medianImprovement: 0 })), post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<LandingView client={client} onSignIn={vi.fn()} />);
    expect(screen.getByTestId("landing-hero")).toBeVisible();
    expect(screen.getByTestId("preview-query")).toBeVisible(); // the inline audit
    expect(screen.getByTestId("how-it-works")).toHaveTextContent("Audit");
    expect(screen.getByTestId("how-it-works")).toHaveTextContent("Approve");
    expect(screen.getByTestId("how-it-works")).toHaveTextContent("Run");
  });

  it("shows real proof stats when the aggregate has wins", async () => {
    const client = { get: vi.fn(async () => ({ appsWithWins: 3, totalWins: 17, bestImprovement: 42, medianImprovement: 12 })), post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<LandingView client={client} onSignIn={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("stat-total wins")).toHaveTextContent("17"));
    expect(screen.getByTestId("stat-best improvement")).toHaveTextContent("42 ranks");
  });

  it("shows the honest empty line — not a fake number — when proof is empty", async () => {
    const client = { get: vi.fn(async () => ({ appsWithWins: 0, totalWins: 0, bestImprovement: 0, medianImprovement: 0 })), post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<LandingView client={client} onSignIn={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("proof-empty")).toBeVisible());
    expect(screen.queryByTestId("stat-total wins")).toBeNull();
  });

  it("shows the honest empty line when proof 401s for a logged-out visitor", async () => {
    const client = { get: vi.fn(async () => { throw new Error("401"); }), post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<LandingView client={client} onSignIn={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("proof-empty")).toBeVisible());
  });

  it("wires the secondary sign-in link", () => {
    const onSignIn = vi.fn();
    const client = { get: vi.fn(async () => ({ appsWithWins: 0, totalWins: 0, bestImprovement: 0, medianImprovement: 0 })), post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<LandingView client={client} onSignIn={onSignIn} />);
    fireEvent.click(screen.getByTestId("landing-signin"));
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});

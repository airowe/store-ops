import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { LoginView } from "./LoginView.js";
import { ProofView } from "./ProofView.js";
import { PreviewView } from "./PreviewView.js";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("<LoginView />", () => {
  it("requests a magic link and confirms it was sent", async () => {
    const post = vi.fn(async () => ({ sent: true }));
    const client = { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
    wrap(<LoginView client={client} />);
    fireEvent.change(screen.getByTestId("email"), { target: { value: "me@x.com" } });
    fireEvent.click(screen.getByTestId("send"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/auth/request", { email: "me@x.com" }));
    await waitFor(() => expect(screen.getByTestId("sent")).toHaveTextContent("me@x.com"));
  });

  it("won't send for an invalid email", () => {
    const post = vi.fn();
    const client = { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
    wrap(<LoginView client={client} />);
    fireEvent.change(screen.getByTestId("email"), { target: { value: "not-an-email" } });
    expect(screen.getByTestId("send")).toBeDisabled();
  });
});

describe("<ProofView />", () => {
  it("renders the measured aggregates (a real 0 stays 0)", async () => {
    const get = vi.fn(async () => ({ appsWithWins: 3, totalWins: 0, bestImprovement: 42, medianImprovement: 12 }));
    const client = { get, post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    wrap(<ProofView client={client} />);
    await waitFor(() => expect(screen.getByTestId("stat-total wins")).toHaveTextContent("0"));
    expect(screen.getByTestId("stat-best improvement")).toHaveTextContent("42 ranks");
  });
});

describe("<PreviewView />", () => {
  it("audits an app and gates signup at value (sign-in only to run)", async () => {
    const post = vi.fn(async (path: string, body: any) => {
      if (body.query) return { needsChoice: true, candidates: [{ bundle_id: "com.x.y", name: "XY" }] };
      if (body.bundle_id) return { bundleId: body.bundle_id, preview: { grade: "C", summary: "Two quick wins.", findings: ["Add a subtitle"] } };
      throw new Error("unexpected");
    });
    const client = { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
    const onSignIn = vi.fn();
    wrap(<PreviewView client={client} onSignIn={onSignIn} />);
    fireEvent.change(screen.getByTestId("preview-query"), { target: { value: "xy" } });
    fireEvent.click(screen.getByTestId("preview-search"));
    await waitFor(() => screen.getByTestId("pcand-com.x.y"));
    fireEvent.click(screen.getByTestId("pcand-com.x.y"));
    await waitFor(() => expect(screen.getByTestId("preview-result")).toBeInTheDocument());
    expect(screen.getByTestId("preview-grade")).toHaveTextContent("C");
    fireEvent.click(screen.getByTestId("preview-signin"));
    expect(onSignIn).toHaveBeenCalled();
  });
});

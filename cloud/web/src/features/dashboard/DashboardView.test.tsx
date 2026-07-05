import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { DashboardView } from "./DashboardView.js";

function client(apps: unknown[], over: Partial<Record<"post", any>> = {}) {
  const get = vi.fn(async (path: string) => {
    if (path === "/apps") return { apps };
    throw new Error("unexpected GET " + path);
  });
  const post = over.post ?? vi.fn(async () => ({ candidates: [] }));
  return { c: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
}

function renderView(c: ApiClient, onOpen = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DashboardView client={c} onOpen={onOpen} />
    </QueryClientProvider>,
  );
}

const app = {
  id: "a1", name: "Acme", bundle_id: "com.acme.app",
  latest_run: null, rank_summary: null, findings_summary: null,
};

describe("<DashboardView />", () => {
  it("renders the app grid from /apps", async () => {
    const { c } = client([app]);
    renderView(c);
    await waitFor(() => expect(screen.getByTestId("app-card-a1")).toBeInTheDocument());
  });

  it("shows the honest empty state when no apps are connected", async () => {
    const { c } = client([]);
    renderView(c);
    await waitFor(() => expect(screen.getByTestId("empty")).toBeInTheDocument());
    expect(screen.getByText(/No apps connected yet/i)).toBeInTheDocument();
  });

  it("connect search resolves candidates; clicking one connects and opens it", async () => {
    const post = vi.fn(async (path: string, body: any) => {
      if (path === "/resolve") return { candidates: [{ bundle_id: "com.x.y", name: "XY" }] };
      if (path === "/apps") return { id: "new1", name: body.name, bundleId: body.bundle_id };
      throw new Error("unexpected POST " + path);
    });
    const { c } = client([], { post });
    const onOpen = vi.fn();
    renderView(c, onOpen);

    await waitFor(() => screen.getByTestId("connect-input"));
    fireEvent.change(screen.getByTestId("connect-input"), { target: { value: "xy" } });
    fireEvent.click(screen.getByTestId("connect-search"));
    await waitFor(() => screen.getByTestId("cand-com.x.y"));
    fireEvent.click(screen.getByTestId("cand-com.x.y"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/apps", { bundle_id: "com.x.y", name: "XY" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("new1"));
  });
});

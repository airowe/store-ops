import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { ApiError } from "@shipaso/api";
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
  it("a logged-out visitor is asked to sign in, not told to 'try again'", async () => {
    // /apps 401s when there's no session. The old code lumped that in with every
    // other failure and said "Couldn't load your apps. Try again." — untrue, and
    // useless advice: retrying fails identically forever.
    const get = vi.fn(async () => {
      throw new ApiError(401, "unauthorized");
    });
    const c = { get, post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    renderView(c);

    await waitFor(() => expect(screen.getByTestId("signed-out")).toBeInTheDocument());
    expect(screen.getByTestId("signed-out-signin")).toHaveAttribute("href", "/login");
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
  });

  it("never renders 'no apps' while the query is still pending", async () => {
    // The bug this pins: TanStack v5's isLoading === isPending && isFetching, so
    // it goes FALSE during a retry backoff. Guarding on isLoading left a window
    // with no data and no error, and the component fell through to the success
    // render — showing a logged-out visitor "No apps connected yet", a lie.
    // A never-settling query keeps us in exactly that state.
    const get = vi.fn(() => new Promise(() => {})); // never resolves
    const c = { get, post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    renderView(c);

    expect(await screen.findByText(/loading your apps/i)).toBeInTheDocument();
    expect(screen.queryByText(/no apps connected yet/i)).not.toBeInTheDocument();
  });

  it("a real failure (not a 401) still says try again", async () => {
    // A 500 keeps the default retry policy (unlike a 401, which never retries),
    // so this mock fails every time — as a genuinely broken server would.
    const get = vi.fn(async () => {
      throw new ApiError(500, "boom");
    });
    const c = { get, post: vi.fn(), request: vi.fn() } as unknown as ApiClient;
    renderView(c);

    // 3 retries with exponential backoff before it settles into the error state.
    await waitFor(() => expect(screen.getByText(/try again/i)).toBeInTheDocument(), { timeout: 15000 });
    expect(screen.queryByTestId("signed-out")).not.toBeInTheDocument();
  }, 20000);

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

  it("offers Approve-all when >1 run is pending, and reports the count", async () => {
    const pending = (id: string) => ({ ...app, id, latest_run: { status: "awaiting_approval", created_at: "2026-07-01T00:00:00Z" } });
    const post = vi.fn(async (path: string) => {
      if (path === "/runs/approve-all") return { approved: ["r1", "r2"], approvedCount: 2, skipped: [] };
      return { candidates: [] };
    });
    const { c } = client([pending("a1"), pending("a2")], { post });
    renderView(c);
    await waitFor(() => expect(screen.getByTestId("approve-all-card")).toBeInTheDocument());
    expect(screen.getByText(/never ships anything/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("approve-all"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/runs/approve-all"));
    expect(await screen.findByTestId("approve-all-result")).toHaveTextContent("Approved 2 runs.");
  });

  it("hides Approve-all when fewer than 2 runs are pending", async () => {
    const { c } = client([{ ...app, latest_run: { status: "awaiting_approval", created_at: "2026-07-01T00:00:00Z" } }]);
    renderView(c);
    await waitFor(() => screen.getByTestId("app-card-a1"));
    expect(screen.queryByTestId("approve-all-card")).toBeNull();
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

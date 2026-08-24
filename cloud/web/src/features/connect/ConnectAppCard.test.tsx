import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { ConnectAppCard } from "./ConnectAppCard.js";

function client(post: any) {
  return { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
}

function renderCard(c: ApiClient, onConnected = () => {}, heading?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConnectAppCard client={c} onConnected={onConnected} heading={heading} />
    </QueryClientProvider>,
  );
}

describe("<ConnectAppCard />", () => {
  it("searches, then connects the chosen candidate and reports the new id", async () => {
    const post = vi.fn(async (path: string, body: any) => {
      if (path === "/resolve") return { candidates: [{ bundle_id: "com.x.y", name: "XY" }] };
      if (path === "/apps") return { id: "new1", name: body.name, bundleId: body.bundle_id };
      throw new Error("unexpected POST " + path);
    });
    const onConnected = vi.fn();
    renderCard(client(post), onConnected);

    fireEvent.change(screen.getByTestId("connect-input"), { target: { value: "xy" } });
    fireEvent.click(screen.getByTestId("connect-search"));
    await waitFor(() => screen.getByTestId("cand-com.x.y"));
    fireEvent.click(screen.getByTestId("cand-com.x.y"));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/apps", { bundle_id: "com.x.y", name: "XY" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("new1", "XY"));
  });

  it("re-offers the pick list when the connect comes back ambiguous", async () => {
    const post = vi.fn(async (path: string) => {
      if (path === "/resolve") return { candidates: [{ bundle_id: "com.x.y", name: "XY" }] };
      if (path === "/apps") return { needsChoice: true, candidates: [{ bundle_id: "com.a.b", name: "AB" }] };
      throw new Error("unexpected POST " + path);
    });
    const onConnected = vi.fn();
    renderCard(client(post), onConnected);

    fireEvent.change(screen.getByTestId("connect-input"), { target: { value: "xy" } });
    fireEvent.click(screen.getByTestId("connect-search"));
    await waitFor(() => screen.getByTestId("cand-com.x.y"));
    fireEvent.click(screen.getByTestId("cand-com.x.y"));

    await waitFor(() => screen.getByTestId("cand-com.a.b"));
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("says so when the search matches nothing, rather than showing an empty card", async () => {
    const post = vi.fn(async () => ({ candidates: [] }));
    renderCard(client(post));

    fireEvent.change(screen.getByTestId("connect-input"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByTestId("connect-search"));

    await waitFor(() => expect(screen.getByText("No matches.")).toBeInTheDocument());
  });

  it("will not search on an empty query", () => {
    const post = vi.fn();
    renderCard(client(post));
    expect(screen.getByTestId("connect-search")).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it("takes a caller-supplied heading, defaulting to 'Connect an app'", () => {
    const { unmount } = renderCard(client(vi.fn()));
    expect(screen.getByText("Connect an app")).toBeInTheDocument();
    unmount();
    renderCard(client(vi.fn()), () => {}, "Which app?");
    expect(screen.getByText("Which app?")).toBeInTheDocument();
  });
});

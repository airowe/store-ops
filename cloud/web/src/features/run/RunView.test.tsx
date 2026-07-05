import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { RunView } from "./RunView.js";

function runDetail(status: string, pushCommands: unknown[] = []) {
  return {
    id: "run1",
    app_id: "a1",
    status,
    created_at: "2026-07-04T00:00:00Z",
    approval: null,
    result: {
      currentCopy: { name: "Old name", subtitle: "old sub" },
      proposedCopy: { name: "New name", subtitle: "new sub" },
      pushCommands,
    },
  };
}

/** Fake client: GET returns the current run; POST approve/reject flips status. */
function makeClient() {
  let state = runDetail("awaiting_approval");
  const get = vi.fn(async () => state);
  const post = vi.fn(async (path: string) => {
    if (path.endsWith("/approve")) {
      state = runDetail("approved", [{ store: "appstore", tool: "asc", description: "push name", command: "fastlane deliver" }]);
    } else if (path.endsWith("/reject")) {
      state = runDetail("rejected");
    }
    return state;
  });
  return { client: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
}

function renderView(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RunView client={client} id="run1" />
    </QueryClientProvider>,
  );
}

describe("<RunView /> — the money screen", () => {
  it("pending: shows the diff + Approve/Reject, and NO handoff commands yet", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("approve")).toBeInTheDocument());
    expect(screen.getByTestId("diff-name")).toBeInTheDocument();
    expect(screen.queryByTestId("handoff")).toBeNull(); // commands withheld until approval
  });

  it("HONESTY: approval reveals the handoff and reads 'Approved · ready to push', never 'Shipped'", async () => {
    const { client, post } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("approve"));
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/runs/run1/approve", { decision: "approve" }));
    await waitFor(() => expect(screen.getByTestId("handoff")).toBeInTheDocument());
    const status = screen.getByTestId("run-status");
    expect(status).toHaveTextContent("Approved · ready to push");
    expect(status).not.toHaveTextContent(/^Shipped$/);
    // the handoff is a copy target, explicitly not shipped
    expect(screen.getByText(/never pushes to a live store/i)).toBeInTheDocument();
  });

  it("reject: status reads Rejected, no handoff", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("reject"));
    fireEvent.click(screen.getByTestId("reject"));
    await waitFor(() => expect(screen.getByTestId("run-status")).toHaveTextContent("Rejected"));
    expect(screen.queryByTestId("handoff")).toBeNull();
  });
});

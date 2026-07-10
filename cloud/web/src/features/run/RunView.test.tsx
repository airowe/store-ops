import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { RunView } from "./RunView.js";

function runDetail(status: string, pushCommands: unknown[] = [], extra: Record<string, unknown> = {}) {
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
      ...extra,
    },
  };
}

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

/**
 * Fake client: path-aware GET (run, credentials); POST approve/reject returns
 * the SLIM decision shape the real server sends — {id,status,proposedCopy?,
 * pushCommands} with NO `result`/`currentCopy`. (A prior fake returned a full
 * RunDetail here, which hid the #177 crash: replacing the cache with the real
 * slim response dropped `result` and threw on `r.currentCopy`.)
 */
function makeClient({
  credentials = [] as unknown[],
  pushResult = { ok: true, versionId: "v1", localizationId: "l1", fieldsPushed: ["name", "subtitle"] } as unknown,
  extra = {} as Record<string, unknown>,
} = {}) {
  const state = runDetail("awaiting_approval", [], extra);
  const get = vi.fn(async (path: string) => {
    if (path === "/runs/run1") return state;
    if (path === "/account/credentials") return { enabled: true, credentials };
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async (path: string) => {
    if (path.endsWith("/approve")) {
      return {
        id: "run1",
        status: "approved",
        note: "Approved. Hand the metadata to your build pipeline.",
        proposedCopy: { name: "New name", subtitle: "new sub" },
        pushCommands: [{ store: "appstore", tool: "asc", description: "push name", command: "fastlane deliver" }],
      };
    }
    if (path === "/runs/run1/asc/push") return pushResult;
    return { id: "run1", status: "rejected", pushCommands: [] };
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
    // regression: the slim decision must MERGE, not replace — the diff (fed by
    // currentCopy, absent from the decision) must survive approval, not crash.
    expect(screen.getByTestId("diff-name")).toBeInTheDocument();
    const status = screen.getByTestId("run-status");
    expect(status).toHaveTextContent("Approved · ready to push");
    expect(status).not.toHaveTextContent(/^Shipped$/);
    // nothing ships without an explicit human action
    expect(screen.getByText(/nothing ships without your explicit action/i)).toBeInTheDocument();
  });

  it("reject: status reads Rejected, no handoff", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("reject"));
    fireEvent.click(screen.getByTestId("reject"));
    await waitFor(() => expect(screen.getByTestId("run-status")).toHaveTextContent("Rejected"));
    expect(screen.queryByTestId("handoff")).toBeNull();
  });

  it("renders the listing audit findings + locks served on the run", async () => {
    const { client } = makeClient({
      extra: {
        findings: [
          {
            id: "subtitle_missing", surface: "subtitle", severity: "critical", impact: "ranking",
            title: "No subtitle", detail: "Unused ranked field.", fix: "Add one.",
          },
        ],
        findingsSummary: { label: "1 fix available · 1 critical", critical: 1 },
        locks: [{ surface: "keywords", label: "We can't see your keyword field", unlockCopy: "Unlock to improve it" }],
      },
    });
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("findings-card")).toBeInTheDocument());
    expect(screen.getByText("No subtitle")).toBeInTheDocument();
    expect(screen.getByTestId("locks")).toHaveTextContent("We can't see your keyword field");
  });

  it("approved + stored ASC key: one-click push posts to asc/push and reports Apple's result", async () => {
    const { client, post } = makeClient({ credentials: [ASC_CRED] });
    renderView(client);
    await waitFor(() => screen.getByTestId("approve"));
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => expect(screen.getByTestId("asc-push")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("asc-push"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/runs/run1/asc/push", {}));
    const result = await screen.findByTestId("push-result");
    expect(result).toHaveTextContent(/name, subtitle/);
    expect(result).toHaveTextContent(/staged/i);
  });

  it("push failure surfaces Apple's reason verbatim — never a silent failure", async () => {
    const { client } = makeClient({
      credentials: [ASC_CRED],
      pushResult: { ok: false, reason: "no editable version found" },
    });
    renderView(client);
    await waitFor(() => screen.getByTestId("approve"));
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => screen.getByTestId("asc-push"));
    fireEvent.click(screen.getByTestId("asc-push"));
    const result = await screen.findByTestId("push-result");
    expect(result).toHaveTextContent("no editable version found");
  });

  it("approved with NO stored key: no push button; the handoff stays the path", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("approve"));
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => expect(screen.getByTestId("handoff")).toBeInTheDocument());
    expect(screen.queryByTestId("asc-push")).toBeNull();
  });
});

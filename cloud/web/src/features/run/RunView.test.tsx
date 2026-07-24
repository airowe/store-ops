import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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
  createVersionResult = { ok: true, versionId: "v9", versionString: "1.2.0", state: "PREPARE_FOR_SUBMISSION" } as unknown,
  github = { appConfigured: true, connected: false, repo: null } as unknown,
  prResult = { ok: true, url: "https://github.com/o/r/pull/7", number: 7, branch: "shipaso/run1" } as unknown,
  extra = {} as Record<string, unknown>,
  status = "awaiting_approval" as string,
} = {}) {
  const state = runDetail(status, [], extra);
  const get = vi.fn(async (path: string) => {
    if (path === "/runs/run1") return state;
    if (path === "/account/credentials") return { enabled: true, credentials };
    if (path === "/github/status") return github;
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
    if (path === "/runs/run1/asc/create-version") return createVersionResult;
    if (path === "/runs/run1/github/pr") return prResult;
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

beforeAll(() => {
  // jsdom lacks IntersectionObserver — provide a no-op so SectionRail mounts.
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    class { observe() {} disconnect() {} unobserve() {} };
});

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

  it("superseded: reads as replaced by a newer run, NOT actionable (no Approve/Reject)", async () => {
    const { client } = makeClient({ status: "superseded" });
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("run-status")).toHaveTextContent("Superseded by a newer run"));
    // a superseded run is a dead iteration — never offer approve/reject on it
    expect(screen.queryByTestId("approve")).toBeNull();
    expect(screen.queryByTestId("reject")).toBeNull();
  });

  it("renders the listing audit findings + collapses locks into one connect CTA", async () => {
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
    // under master-detail, "changes" is the default section — select Audit first.
    await waitFor(() => expect(screen.getByTestId("section-rail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Audit" }));
    expect(screen.getByTestId("findings-card")).toBeInTheDocument();
    expect(screen.getByText("No subtitle")).toBeInTheDocument();
    // one connect CTA, not a per-surface wall of "we can't see …" sentences
    expect(screen.getByTestId("asc-unlock-cta")).toHaveTextContent("Unlock your full audit");
    expect(screen.getByTestId("findings-card")).not.toHaveTextContent("We can't see your keyword field");
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

  it("a refused push offers Create-draft-version (no curl) and reports Apple's result", async () => {
    const { client, post } = makeClient({
      credentials: [ASC_CRED],
      pushResult: { ok: false, reason: "no editable version found" },
    });
    renderView(client);
    await waitFor(() => screen.getByTestId("approve"));
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => screen.getByTestId("asc-push"));
    fireEvent.click(screen.getByTestId("asc-push"));
    // the dead-end fix appears exactly when the push was refused
    await waitFor(() => expect(screen.getByTestId("create-version")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("cv-version"), { target: { value: "1.2.0" } });
    fireEvent.click(screen.getByTestId("cv-create"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/runs/run1/asc/create-version", { versionString: "1.2.0" }));
    expect(await screen.findByTestId("cv-result")).toHaveTextContent("Created draft 1.2.0");
  });

  it("no Create-version affordance before a push is refused", async () => {
    const { client } = makeClient({ credentials: [ASC_CRED] });
    renderView(client);
    await waitFor(() => screen.getByTestId("approve"));
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => screen.getByTestId("asc-push"));
    expect(screen.queryByTestId("create-version")).toBeNull();
  });

  it("approved + GitHub connected: offers Open-PR and links the opened PR", async () => {
    const { client, post } = makeClient({ github: { appConfigured: true, connected: true, repo: "o/r" } });
    renderView(client);
    await waitFor(() => screen.getByTestId("approve"));
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => expect(screen.getByTestId("github-pr-card")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("github-pr"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/runs/run1/github/pr"));
    const link = await screen.findByTestId("github-pr-result");
    expect(link).toHaveTextContent("Opened PR #7");
  });

  it("no Open-PR card when no repo is connected", async () => {
    const { client } = makeClient({ github: { appConfigured: true, connected: false, repo: null } });
    renderView(client);
    await waitFor(() => screen.getByTestId("approve"));
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => screen.getByTestId("handoff"));
    expect(screen.queryByTestId("github-pr-card")).toBeNull();
  });

  it("approved with NO stored key: no push button; the handoff stays the path", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("approve"));
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => expect(screen.getByTestId("handoff")).toBeInTheDocument());
    expect(screen.queryByTestId("asc-push")).toBeNull();
  });

  it("shows the sticky decision bar with Approve/Reject on an open run", async () => {
    const { client } = makeClient();
    renderView(client);
    expect(await screen.findByTestId("decision-bar")).toBeInTheDocument();
    // buttons still carry their original testids + wiring (unchanged)
    expect(screen.getByTestId("approve")).toBeInTheDocument();
    expect(screen.getByTestId("reject")).toBeInTheDocument();
  });

  it("renders the decision summary and a section rail on an open run", async () => {
    const { client } = makeClient();
    renderView(client);
    expect(await screen.findByTestId("decision-summary")).toBeInTheDocument();
    expect(screen.getByTestId("section-rail")).toBeInTheDocument();
  });

  it("LAYOUT: a terminal run stays single-column (no run-shell), a pending run gets the master-detail shell", async () => {
    // Terminal run: no shell is rendered — the linear render stays as-is.
    const { client: approvedClient } = makeClient({ status: "approved" });
    const { container: approvedContainer } = renderView(approvedClient);
    await waitFor(() => expect(screen.getByTestId("run-status")).toBeInTheDocument());
    expect(approvedContainer.querySelector(".run-shell")).toBeNull();

    // Pending run: the rail + detail pane render inside .run-shell.
    const { client: pendingClient } = makeClient();
    const { container: pendingContainer } = renderView(pendingClient);
    await waitFor(() => expect(screen.getByTestId("approve")).toBeInTheDocument());
    expect(pendingContainer.querySelector(".run-shell")).not.toBeNull();
  });
});

describe("<RunView /> — run shell (pending)", () => {
  it("renders the status bar with the live app name", async () => {
    const { client } = makeClient({
      extra: { audit: { liveName: "Heathen" }, coverage: { coverageScore: 95.6, fieldFill: [], distinctTerms: 0, waste: [] } },
    });
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("status-bar")).toBeInTheDocument());
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Heathen");
    expect(screen.getByTestId("sb-coverage")).toHaveTextContent("95.6");
  });

  it("groups a critical/warn finding's Audit item under Needs you", async () => {
    const { client } = makeClient({
      extra: {
        findings: [
          { id: "f1", surface: "screenshots", severity: "warn", impact: "conversion",
            title: "Only 3 screenshots", detail: "d", fix: "add more" },
        ],
      },
    });
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("section-rail")).toBeInTheDocument());
    const rail = screen.getByTestId("section-rail");
    expect(rail).toHaveTextContent("Needs you");
    expect(within(rail).getByRole("button", { name: "Audit" })).toBeInTheDocument();
  });

  it("shows only the selected section, and swaps on rail click", async () => {
    const { client } = makeClient({
      extra: {
        coverage: { coverageScore: 90, fieldFill: [], distinctTerms: 0, waste: [] },
        findings: [
          { id: "f1", surface: "screenshots", severity: "warn", impact: "conversion",
            title: "Only 3 screenshots", detail: "d", fix: "add more" },
        ],
      },
    });
    renderView(client);
    // default section is "changes" — the diff is visible, the coverage card is not
    await waitFor(() => expect(screen.getByTestId("diff-name")).toBeInTheDocument());
    expect(screen.queryByTestId("coverage-card")).toBeNull();
    // click Metadata → coverage shows, diff hides
    fireEvent.click(screen.getByRole("button", { name: "Metadata" }));
    expect(screen.getByTestId("coverage-card")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-name")).toBeNull();
  });

  it("still renders the decision bar and Approve/Reject on a pending run", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("decision-bar")).toBeInTheDocument());
    expect(screen.getByTestId("approve")).toBeInTheDocument();
    expect(screen.getByTestId("reject")).toBeInTheDocument();
  });
});

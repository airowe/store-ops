/**
 * ADR-001 at the button.
 *
 * RunView.test.tsx injects `trustGesture` so it can exercise what happens AFTER
 * the gate. This file deliberately does NOT: it renders the real component with
 * its real gesture check and clicks the way a script does — which is the only
 * way anything reachable from JavaScript can click.
 *
 * That makes the assertion below a measurement rather than a belief. jsdom's
 * `fireEvent.click` and `element.click()` both produce `isTrusted === false`,
 * exactly as an agent's scripted click would, so this test IS the attack.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunView } from "./RunView.js";

const RUN = {
  id: "run1",
  app_id: "app1",
  status: "awaiting_approval",
  country: "US",
  created_at: "2026-08-01T00:00:00Z",
  approval: null,
  result: {
    currentCopy: { name: "Old", subtitle: "old sub", keywords: "a" },
    proposedCopy: { name: "New", subtitle: "new sub", keywords: "a,b" },
    pushCommands: [],
    findings: [],
  },
};

function renderRun() {
  const post = vi.fn(async () => ({ nonce: "n", expiresInSeconds: 60 }));
  const client = {
    get: vi.fn(async (path: string) => {
      if (path === "/runs/run1") return RUN;
      if (path === "/account/credentials") return { enabled: true, credentials: [] };
      if (path === "/github/status") return { connected: false };
      throw new Error("unexpected GET " + path);
    }),
    post,
    request: vi.fn(),
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RunView client={client as never} id="run1" />
    </QueryClientProvider>,
  );
  return post;
}

describe("RunView approval — the real gesture check", () => {
  it("a SCRIPTED click never approves, and never even mints a nonce", async () => {
    const post = renderRun();
    await waitFor(() => expect(screen.getByTestId("approve")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("approve"));
    screen.getByTestId("approve").click();

    // Both clicks are untrusted, so neither reaches the network at all. If this
    // ever passes with calls recorded, the client-side contract has regressed.
    await waitFor(() => expect(post).not.toHaveBeenCalled());
  });

  it("rejecting still works from a scripted click — only APPROVING needs the gesture", async () => {
    const post = renderRun();
    await waitFor(() => expect(screen.getByTestId("reject")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("reject"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/runs/run1/reject", { decision: "reject" }));
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { ExecutionsCard } from "./ExecutionsCard.js";

const row = (step: string, status: "done" | "skipped" | "failed", detail: string) => ({ id: step, run_id: "run1", step, status, detail, created_at: "" });

function makeClient(executions: unknown[], status = "approved") {
  const get = vi.fn(async (path: string) => {
    if (path === "/runs/run1/executions") return { runId: "run1", status, executions };
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async () => ({ runId: "run1", ran: true, shipped: true, executions: [] }));
  return { client: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
}

function renderCard(client: ApiClient, status = "approved") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExecutionsCard client={client} runId="run1" status={status} />
    </QueryClientProvider>,
  );
}

describe("<ExecutionsCard />", () => {
  it("renders the ledger with each step's state and detail, and no Execute on an attempted run", async () => {
    renderCard(
      makeClient([
        row("version", "done", "using 1.0.1 (PREPARE_FOR_SUBMISSION)"),
        row("metadata", "done", "pushed subtitle, keywords to en-US"),
        row("screenshots", "skipped", "no rendered screenshot exists server-side"),
      ]).client,
      "shipped",
    );
    expect(await screen.findByTestId("exec-metadata")).toHaveTextContent(/done/);
    expect(screen.getByTestId("exec-metadata")).toHaveTextContent(/pushed subtitle, keywords/);
    expect(screen.getByTestId("exec-screenshots")).toHaveTextContent(/skipped/);
    expect(screen.getByTestId("exec-screenshots")).toHaveTextContent(/no rendered screenshot/);
    expect(screen.queryByTestId("execute-now")).not.toBeInTheDocument();
  });

  it("an approved run with no rows offers Execute now and POSTs /execute", async () => {
    const { client, post } = makeClient([]);
    renderCard(client);
    expect(await screen.findByTestId("executions-empty")).toHaveTextContent(/Nothing has been pushed/);
    fireEvent.click(screen.getByTestId("execute-now"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/runs/run1/execute"));
  });

  it("a quarantined run (approved before the switch) offers Execute now; a failed one does not", async () => {
    const { client } = makeClient([row("gate", "skipped", "approved before autopilot was turned on; POST /runs/:id/execute to run it now")]);
    renderCard(client);
    expect(await screen.findByTestId("execute-now")).toBeInTheDocument();

    const failed = makeClient([row("version", "done", "using 1.0.1"), row("metadata", "failed", "App Store Connect rejected the update (409)")]);
    renderCard(failed.client);
    await screen.findByTestId("exec-metadata");
    expect(screen.getAllByTestId("execute-now")).toHaveLength(1);
  });

  it("says plainly when the ledger cannot be loaded, and never invents a step", async () => {
    const get = vi.fn(async () => {
      throw new Error("500");
    });
    renderCard({ get, post: vi.fn(), request: vi.fn() } as unknown as ApiClient);
    expect(await screen.findByTestId("executions-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("executions-list")).not.toBeInTheDocument();
  });

  it("always states what is never pushed from here", async () => {
    renderCard(makeClient([]).client, "shipped");
    expect(await screen.findByText(/Screenshots and experiments are never pushed from here/)).toBeInTheDocument();
  });
});

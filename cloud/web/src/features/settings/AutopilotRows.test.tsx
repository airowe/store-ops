import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { AutopilotRows } from "./AutopilotRows.js";

function makeClient() {
  const request = vi.fn(async (path: string, init: { body?: { optIn?: boolean; execute?: boolean } }) => {
    if (path === "/account/asc-writes") return { asc_write_opt_in: init.body!.optIn };
    if (path === "/account/autopilot") return { autopilot_execute: init.body!.execute, quarantined: init.body!.execute ? 32 : 0 };
    throw new Error("unexpected " + path);
  });
  return { client: { get: vi.fn(), post: vi.fn(), request } as unknown as ApiClient, request };
}

function renderRows(client: ApiClient, state: { ascWrites: boolean; autopilot: boolean }, onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <AutopilotRows client={client} ascWrites={state.ascWrites} autopilot={state.autopilot} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { ...r, onChange };
}

describe("<AutopilotRows />", () => {
  it("the execute switch is disabled until write consent is on, and says so", () => {
    const { client } = makeClient();
    renderRows(client, { ascWrites: false, autopilot: false });
    expect(screen.getByTestId("autopilot-toggle")).toBeDisabled();
    expect(screen.getByText(/Needs the switch above/)).toBeInTheDocument();
    expect(screen.getByText(/every store write is a command you run yourself/)).toBeInTheDocument();
  });

  it("turning consent on PATCHes /account/asc-writes and reports the new value", async () => {
    const { client, request } = makeClient();
    const { onChange } = renderRows(client, { ascWrites: false, autopilot: false });
    fireEvent.click(screen.getByTestId("asc-writes-toggle"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/account/asc-writes", { method: "PATCH", body: { optIn: true } }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ascWrites: true }));
  });

  it("turning autopilot on PATCHes /account/autopilot and shows the quarantine count, never a push", async () => {
    const { client, request } = makeClient();
    const { onChange } = renderRows(client, { ascWrites: true, autopilot: false });
    fireEvent.click(screen.getByTestId("autopilot-toggle"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/account/autopilot", { method: "PATCH", body: { execute: true } }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ autopilot: true }));
    expect(await screen.findByTestId("autopilot-quarantined")).toHaveTextContent(/32 runs were approved before this switch existed/);
    expect(screen.getByTestId("autopilot-quarantined")).toHaveTextContent(/stay untouched/);
  });

  it("turning consent off also reports autopilot off — the server refuses the pair the other way round", async () => {
    const { client } = makeClient();
    const { onChange } = renderRows(client, { ascWrites: true, autopilot: true });
    fireEvent.click(screen.getByTestId("asc-writes-toggle"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ascWrites: false, autopilot: false }));
  });

  it("the on-state copy never claims a submission or a live version", () => {
    const { client } = makeClient();
    renderRows(client, { ascWrites: true, autopilot: true });
    const text = screen.getByTestId("autopilot-rows").textContent ?? "";
    expect(text).toMatch(/Never a live version, never a submission/);
    expect(text).toMatch(/Screenshots and experiments still need you/);
  });
});

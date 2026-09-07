import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient, PlanTier } from "@shipaso/api";
import { PlanCard } from "./PlanCard.js";

const UNTIL = "2026-12-31T23:59:59.000Z";

function makeClient(post = vi.fn(async () => ({ tier: "startup", until: UNTIL, pass: "shipaton-2026" }))) {
  return { client: { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient, post };
}

function renderCard(
  client: ApiClient,
  state: { tier: PlanTier; planStatus?: string | null; planUntil?: string | null },
  onClaimed = vi.fn(),
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PlanCard client={client} tier={state.tier} planStatus={state.planStatus ?? null} planUntil={state.planUntil ?? null} onClaimed={onClaimed} />
    </QueryClientProvider>,
  );
  return { onClaimed };
}

describe("<PlanCard />", () => {
  it("a free account sees Free, no end date, and the claim form", () => {
    renderCard(makeClient().client, { tier: "free" });
    expect(screen.getByTestId("plan-tier")).toHaveTextContent("Free");
    expect(screen.getByTestId("plan-detail")).not.toHaveTextContent(/until|Renews/);
    expect(screen.getByTestId("plan-claim")).toBeInTheDocument();
  });

  it("claiming POSTs the code and reports the grant to the parent", async () => {
    const { client, post } = makeClient();
    const { onClaimed } = renderCard(client, { tier: "free" });
    fireEvent.change(screen.getByTestId("plan-code"), { target: { value: "shipaton-26" } });
    fireEvent.click(screen.getByTestId("plan-claim-submit"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/billing/claim", { code: "shipaton-26" }));
    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith({ tier: "startup", until: UNTIL, pass: "shipaton-2026" }));
  });

  it("the submit button is inert on an empty code", () => {
    renderCard(makeClient().client, { tier: "free" });
    expect(screen.getByTestId("plan-claim-submit")).toBeDisabled();
  });

  it("prints the server's refusal verbatim", async () => {
    const post = vi.fn(async () => {
      throw new Error("that code is not a Shipaton Pass");
    });
    renderCard(makeClient(post as never).client, { tier: "free" });
    fireEvent.change(screen.getByTestId("plan-code"), { target: { value: "NOPE" } });
    fireEvent.click(screen.getByTestId("plan-claim-submit"));
    expect(await screen.findByTestId("plan-claim-error")).toHaveTextContent("that code is not a Shipaton Pass");
  });

  it("a claimed pass shows its name and end date, and the form is gone", () => {
    renderCard(makeClient().client, { tier: "startup", planStatus: "comped:shipaton-2026", planUntil: UNTIL });
    expect(screen.getByTestId("plan-tier")).toHaveTextContent("Startup");
    expect(screen.getByTestId("plan-detail")).toHaveTextContent("Shipaton Pass until 2026-12-31");
    expect(screen.queryByTestId("plan-claim")).toBeNull();
  });

  it("a paid Startup or Scale plan never sees the form", () => {
    renderCard(makeClient().client, { tier: "scale", planStatus: "active", planUntil: "2026-10-01T00:00:00Z" });
    expect(screen.getByTestId("plan-detail")).toHaveTextContent("Renews 2026-10-01");
    expect(screen.queryByTestId("plan-claim")).toBeNull();
  });

  it("an expired pass says so and offers the form again only if still claimable", () => {
    renderCard(makeClient().client, { tier: "free", planStatus: "expired:comped:shipaton-2026", planUntil: UNTIL });
    expect(screen.getByTestId("plan-detail")).toHaveTextContent("The pass ended on 2026-12-31");
  });
});

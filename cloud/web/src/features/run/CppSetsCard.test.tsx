import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient, CppSetsInputs, CppSetsResult } from "@shipaso/api";
import { CppSetsCard } from "./CppSetsCard.js";

const inputs: CppSetsInputs = {
  appName: "Weatherly",
  keywords: ["weather radar", "weather map", "trip forecast", "trip planner"],
  auditGrade: "C",
  findings: ["Only 3 screenshots — plan for 6"],
};

const okResult: CppSetsResult = {
  ok: true,
  intentsMeasured: 2,
  sets: [
    {
      intent: { label: "trip", keywords: ["trip forecast", "trip planner"] },
      plan: {
        narrative: "Lead with the forecast timeline.",
        shots: [{ sourceScreen: "timeline", headline: "Plan your trip", templateId: "headline-top" }],
        label: "draft — machine-planned, review before shipping",
        degraded: false,
      },
    },
    {
      intent: { label: "weather", keywords: ["weather radar", "weather map"] },
      plan: {
        narrative: "Lead with the map.",
        shots: [{ sourceScreen: "MISSING", missingReason: "no radar screen captured", headline: "", templateId: "duo", needsReview: true }],
        label: "draft — machine-planned, review before shipping",
        degraded: false,
      },
    },
  ],
};

function renderWith(result: CppSetsResult) {
  const post = vi.fn(async (path: string) => {
    if (path === "/cpp/sets") return result;
    throw new Error("unexpected POST " + path);
  });
  const client = { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CppSetsCard client={client} inputs={inputs} />
    </QueryClientProvider>,
  );
  return { post };
}

describe("<CppSetsCard />", () => {
  it("generates and renders one set per intent with its evidence keywords", async () => {
    const { post } = renderWith(okResult);
    fireEvent.click(screen.getByTestId("cpp-sets-btn"));
    await waitFor(() => expect(screen.getByTestId("cpp-set-trip")).toBeInTheDocument());
    expect(screen.getByTestId("cpp-set-weather")).toBeInTheDocument();
    // evidence: the intent's keywords are shown
    expect(screen.getByTestId("cpp-set-trip")).toHaveTextContent("trip forecast");
    expect(post).toHaveBeenCalledWith("/cpp/sets", inputs);
  });

  it("shows each set's plan narrative + a MISSING/needs-review flag", async () => {
    renderWith(okResult);
    fireEvent.click(screen.getByTestId("cpp-sets-btn"));
    await waitFor(() => expect(screen.getByText("Lead with the forecast timeline.")).toBeInTheDocument());
    expect(screen.getByText(/no radar screen captured/)).toBeInTheDocument();
    expect(screen.getByTestId("cpp-review-weather-0")).toBeInTheDocument();
  });

  it("shows the sparse-data refusal when ok:false", async () => {
    renderWith({ ok: false, reason: "not enough measured keywords to propose CPPs — track more first." });
    fireEvent.click(screen.getByTestId("cpp-sets-btn"));
    await waitFor(() => expect(screen.getByTestId("cpp-refusal")).toHaveTextContent("not enough measured keywords"));
  });
});

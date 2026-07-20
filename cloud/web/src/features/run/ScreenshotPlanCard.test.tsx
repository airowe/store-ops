import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient, ScreenshotPlan, ScreenshotPlanInputs } from "@shipaso/api";
import { ScreenshotPlanCard } from "./ScreenshotPlanCard.js";

const inputs: ScreenshotPlanInputs = {
  appName: "Weatherly",
  audit: { grade: "C", recommendedCount: 6, findings: ["Add a 6th shot"] },
};

const basePlan: ScreenshotPlan = {
  narrative: "Lead with the benefit, then proof.",
  shots: [
    { sourceScreen: "home", headline: "Track your rank", templateId: "headline-top" },
    { sourceScreen: "MISSING", missingReason: "no settings screen captured", headline: "", templateId: "duo", needsReview: true },
  ],
  label: "draft — machine-planned, review before shipping",
  degraded: false,
};

function renderWithPlan(plan: ScreenshotPlan) {
  const post = vi.fn(async (path: string) => {
    if (path === "/plan/screenshots") return plan;
    throw new Error("unexpected POST " + path);
  });
  const client = { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient;
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ScreenshotPlanCard client={client} inputs={inputs} />
    </QueryClientProvider>,
  );
  return { post };
}

describe("<ScreenshotPlanCard />", () => {
  it("POSTs the inputs and shows narrative + a shot headline", async () => {
    const { post } = renderWithPlan(basePlan);
    fireEvent.click(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("plan-narrative")).toHaveTextContent("Lead with the benefit"));
    expect(screen.getByText("Track your rank")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/plan/screenshots", inputs);
  });

  it("flags a MISSING shot with its reason and a needs-review badge", async () => {
    renderWithPlan(basePlan);
    fireEvent.click(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("shot-missing-1")).toHaveTextContent("no settings screen captured"));
    expect(screen.getByTestId("shot-review-1")).toBeInTheDocument();
  });

  it("shows the verbatim draft label", async () => {
    renderWithPlan(basePlan);
    fireEvent.click(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("plan-label")).toHaveTextContent("draft — machine-planned, review before shipping"),
    );
  });

  it("shows a degraded notice when the fallback shaped the plan", async () => {
    renderWithPlan({ ...basePlan, degraded: true });
    fireEvent.click(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("plan-degraded")).toBeInTheDocument());
  });
});

/**
 * ScreenshotPlanCard (mobile, #153 ShipShots) — honesty invariants under test:
 *   • plans on press (POST /plan/screenshots) and shows narrative + shot headline,
 *   • a MISSING shot shows its reason + a needs-review badge (never a fake screen),
 *   • the verbatim draft label is shown,
 *   • the degraded (deterministic-fallback) notice is shown when set.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ApiClient } from "../api/client.js";
import type { ScreenshotPlan, ScreenshotPlanInputs } from "../types/api.js";
import { ScreenshotPlanCard } from "./ScreenshotPlanCard.js";

const inputs: ScreenshotPlanInputs = {
  appName: "Weatherly",
  audit: { grade: "C", recommendedCount: 6, findings: ["Add a 6th shot"] },
};

function fakeClient(plan: ScreenshotPlan): { client: ApiClient; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const client = {
    get: async () => ({}),
    post: async (_p: string, body?: unknown) => {
      bodies.push(body);
      return plan;
    },
    request: async () => ({}),
  } as unknown as ApiClient;
  return { client, bodies };
}

const basePlan: ScreenshotPlan = {
  narrative: "Lead with the benefit, then proof.",
  shots: [
    { sourceScreen: "home", headline: "Track your rank", templateId: "headline-top" },
    { sourceScreen: "MISSING", missingReason: "no settings screen captured", headline: "", templateId: "duo", needsReview: true },
  ],
  label: "draft — machine-planned, review before shipping",
  degraded: false,
};

describe("ScreenshotPlanCard (mobile)", () => {
  it("plans on press and shows the narrative + a shot headline, sending inputs", async () => {
    const { client, bodies } = fakeClient(basePlan);
    render(<ScreenshotPlanCard client={client} inputs={inputs} />);
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("plan-narrative")).toBeTruthy());
    expect(screen.getByText("Track your rank")).toBeTruthy();
    expect(bodies[0]).toEqual(inputs);
  });

  it("flags a MISSING shot with its reason + a needs-review badge", async () => {
    const { client } = fakeClient(basePlan);
    render(<ScreenshotPlanCard client={client} inputs={inputs} />);
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("shot-missing-1")).toBeTruthy());
    expect(screen.getByTestId("shot-review-1")).toBeTruthy();
  });

  it("shows the verbatim draft label", async () => {
    const { client } = fakeClient(basePlan);
    render(<ScreenshotPlanCard client={client} inputs={inputs} />);
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByText("draft — machine-planned, review before shipping")).toBeTruthy());
  });

  it("shows a degraded notice when the fallback shaped the plan", async () => {
    const { client } = fakeClient({ ...basePlan, degraded: true });
    render(<ScreenshotPlanCard client={client} inputs={inputs} />);
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("plan-degraded")).toBeTruthy());
  });
});

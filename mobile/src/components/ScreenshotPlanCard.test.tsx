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
import { useColorScheme } from "react-native";
import { ThemeProvider, lightPalette, palette } from "../theme/index.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
const mockColorScheme = useColorScheme as unknown as jest.Mock;
beforeEach(() => mockColorScheme.mockReturnValue("dark"));
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

describe("ScreenshotPlanCard theming", () => {
  it("renders the needs-review badge in the LIGHT warn inside a light provider", async () => {
    mockColorScheme.mockReturnValue("light");
    const { client } = fakeClient(basePlan);
    render(
      <ThemeProvider>
        <ScreenshotPlanCard client={client} inputs={inputs} />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(screen.getByTestId("shot-review-1")).toBeTruthy());
    expect(screen.getByTestId("shot-review-1")).toHaveStyle({ color: lightPalette.warn });
    expect(lightPalette.warn).not.toBe(palette.warn);
  });
});

describe("frame style choice", () => {
  const CATALOG = {
    version: 1,
    auto: { id: "auto", name: "Let ShipASO pick", sell: "Planner assigns per shot." },
    templates: [
      {
        id: "spotlight",
        name: "Spotlight",
        sell: "One oversized claim.",
        slots: { headline: { fx: 0.09, fy: 0.1, fw: 0.82, fh: 0.2, align: "center" } },
        deviceFrame: { fx: 0.08, fy: 0.4, fw: 0.84, fh: 0.55 },
      },
    ],
  };

  function catalogClient(plan: ScreenshotPlan): { client: ApiClient; bodies: unknown[] } {
    const bodies: unknown[] = [];
    const client = {
      get: async () => CATALOG,
      post: async (_p: string, body?: unknown) => {
        bodies.push(body);
        return plan;
      },
      request: async () => ({}),
    } as unknown as ApiClient;
    return { client, bodies };
  }

  it("a picked frame is sent as templatePreference; auto sends none", async () => {
    const { client, bodies } = catalogClient(basePlan);
    render(<ScreenshotPlanCard client={client} inputs={inputs} />);
    await waitFor(() => expect(screen.getByTestId("frame-spotlight")).toBeTruthy());

    fireEvent.press(screen.getByTestId("frame-spotlight"));
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]).toEqual({ ...inputs, templatePreference: "spotlight" });

    fireEvent.press(screen.getByTestId("frame-auto"));
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));
    await waitFor(() => expect(bodies.length).toBe(2));
    expect(bodies[1]).toEqual(inputs); // "auto" = no lock on the wire
  });
});

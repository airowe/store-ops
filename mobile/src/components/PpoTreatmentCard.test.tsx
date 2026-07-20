/**
 * PpoTreatmentCard (#182 Phase 3) — the honesty invariants:
 *   • it's a BRIEF (steps the user runs in ASC), not an automated experiment;
 *   • the evidence is a CITED public PPO result, never a claim about your numbers;
 *   • the run-length/confidence guidance renders verbatim (no early verdict);
 *   • the ASC deep link only appears when the server knew the app id.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import type { PpoTreatmentPlan } from "../types/api.js";
import { PpoTreatmentCard } from "./PpoTreatmentCard.js";

const PLAN: PpoTreatmentPlan = {
  headline: "Run a free A/B test: an outcome-led screenshot treatment",
  steps: ["Duplicate your current screenshots.", "Rewrite the first caption around the outcome."],
  evidence: "Public Product Page Optimization tests have measured large conversion swings.",
  guidance: "Let the test run up to ~90 days and reach Apple's confidence threshold before you read it.",
  ascUrl: "https://appstoreconnect.apple.com/apps/12345/distribution",
};

beforeEach(() => jest.clearAllMocks());

describe("PpoTreatmentCard", () => {
  it("renders the headline, every step, the cited evidence, and the verbatim guidance", () => {
    render(<PpoTreatmentCard plan={PLAN} />);
    expect(screen.getByTestId("ppo-treatment-card")).toBeTruthy();
    expect(screen.getByText(/Run a free A\/B test/)).toBeTruthy();
    // each step renders, numbered
    expect(screen.getByText(/Duplicate your current screenshots/)).toBeTruthy();
    expect(screen.getByText(/Rewrite the first caption/)).toBeTruthy();
    // the evidence is framed as public/cited, not a promise about the user's numbers
    expect(screen.getByTestId("ppo-evidence")).toHaveTextContent(/Public Product Page Optimization/);
    // guidance verbatim — nobody reads an early result as a verdict
    expect(screen.getByTestId("ppo-guidance")).toHaveTextContent(/90 days/);
  });

  it("frames it as a brief the user runs themselves (write lane isn't built)", () => {
    render(<PpoTreatmentCard plan={PLAN} />);
    // honesty: it's a brief/recommendation, run in App Store Connect — not automated.
    expect(screen.getByTestId("ppo-treatment-card")).toHaveTextContent(/App Store Connect/i);
  });

  it("opens the ASC deep link when the app id is known", async () => {
    render(<PpoTreatmentCard plan={PLAN} />);
    fireEvent.press(screen.getByTestId("ppo-asc-link"));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(PLAN.ascUrl));
  });

  it("omits the deep link when the app id was unknown", () => {
    const { ascUrl, ...noUrl } = PLAN;
    render(<PpoTreatmentCard plan={noUrl} />);
    expect(screen.queryByTestId("ppo-asc-link")).toBeNull();
  });
});

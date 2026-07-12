import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PpoTreatmentPlan } from "@shipaso/api";
import { PpoTreatmentCard } from "./PpoTreatmentCard.js";

const plan: PpoTreatmentPlan = {
  headline: "Run a free A/B test: an outcome-led screenshot treatment",
  steps: ["Duplicate your current screenshots.", "Rewrite the first caption around the outcome."],
  evidence: "Public Product Page Optimization tests have measured large conversion swings.",
  guidance: "Let the test run up to ~90 days and reach Apple's confidence threshold before you read it.",
  ascUrl: "https://appstoreconnect.apple.com/apps/12345/distribution",
};

describe("<PpoTreatmentCard />", () => {
  it("renders the headline, ordered steps, cited evidence, and guidance", () => {
    render(<PpoTreatmentCard plan={plan} />);
    expect(screen.getByTestId("ppo-treatment-card")).toHaveTextContent("Run a free A/B test");
    const steps = screen.getByTestId("ppo-steps");
    expect(steps.querySelectorAll("li")).toHaveLength(2);
    expect(steps).toHaveTextContent("Rewrite the first caption");
    expect(screen.getByTestId("ppo-evidence")).toHaveTextContent("Public Product Page Optimization");
    expect(screen.getByTestId("ppo-guidance")).toHaveTextContent("90 days");
  });

  it("renders the ASC deep link when present", () => {
    render(<PpoTreatmentCard plan={plan} />);
    const link = screen.getByTestId("ppo-asc-link");
    expect(link).toHaveAttribute("href", "https://appstoreconnect.apple.com/apps/12345/distribution");
  });

  it("omits the deep link when the app id was unknown", () => {
    const { ascUrl, ...noUrl } = plan;
    render(<PpoTreatmentCard plan={noUrl} />);
    expect(screen.queryByTestId("ppo-asc-link")).not.toBeInTheDocument();
  });
});

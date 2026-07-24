/**
 * "/onboarding" — guided setup stepper (design 1a, chosen direction). Both
 * "Continue" (done) and "Skip" land on the dashboard: onboarding → Dashboard is
 * the wired flow, and skipping just gets there sooner. Presentation-only; the
 * collected answers stay local until a real persistence hook exists.
 */
import { useNavigate } from "@tanstack/react-router";
import { OnboardingView } from "../features/onboarding/OnboardingView.js";

export function OnboardingRoute() {
  const navigate = useNavigate();
  const toDashboard = () => void navigate({ to: "/dashboard" });
  return <OnboardingView onDone={toDashboard} onSkip={toDashboard} />;
}

/**
 * "/onboarding" — guided setup stepper (design 1a, chosen direction). Both
 * "Continue" (done) and "Skip" land on the dashboard: onboarding → Dashboard is
 * the wired flow, and skipping just gets there sooner.
 *
 * The route owns the connected app's id: step 2 creates the app, and step 3
 * needs that id to read and confirm its rivals against the real endpoints.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { client } from "../api.js";
import { OnboardingView } from "../features/onboarding/OnboardingView.js";

export function OnboardingRoute() {
  const navigate = useNavigate();
  const [appId, setAppId] = useState<string | null>(null);
  const toDashboard = () => void navigate({ to: "/dashboard" });
  return (
    <OnboardingView
      client={client}
      appId={appId}
      onAppConnected={setAppId}
      onDone={toDashboard}
      onSkip={toDashboard}
    />
  );
}

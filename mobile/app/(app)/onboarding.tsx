/**
 * "/(app)/onboarding" — the guided setup stepper. Both Continue and Skip land on
 * the dashboard: onboarding → dashboard is the wired flow, and skipping just
 * gets there sooner. Collected answers stay local until a persistence hook
 * exists (mirrors the web route).
 */
import React from "react";
import { useRouter } from "expo-router";
import { OnboardingScreen } from "../../src/onboarding/OnboardingScreen.js";

export default function Onboarding() {
  const router = useRouter();
  const toDashboard = () => router.replace("/(app)");
  return <OnboardingScreen onDone={toDashboard} onSkip={toDashboard} />;
}

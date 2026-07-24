/**
 * Onboarding model — the pure state behind the guided setup stepper (design 1a).
 * Replaces the old form-wall with one decision at a time: prior answers stay
 * visible, the live audit runs inline (it's the hook, never behind a wall of
 * questions). Kept free of React so the step math and the rival-chip edits are
 * unit-testable on their own; OnboardingView is a thin render over this.
 */

/** The store a user optimizes for first. */
export type Store = "app-store" | "google-play";

/** The four setup steps, in order. `rivals` is the one interactive step (1a). */
export const STEPS = ["store", "app", "rivals", "connect"] as const;
export type Step = (typeof STEPS)[number];

/** Everything the stepper has collected so far. Prior answers stay visible. */
export type OnboardingState = {
  /** Index into STEPS of the active (expanded) step. */
  stepIndex: number;
  /** Chosen store (step 1). */
  store: Store | null;
  /** Connected app name + honest audit grade (step 2). Grade is never faked. */
  app: { name: string; grade: string | null } | null;
  /** Confirmed rivals — only these feed runs (step 3). */
  rivals: string[];
  /** Suggested-from-keywords rivals not yet confirmed. */
  suggested: string[];
};

/** The progress bar: one segment per step, filled up to and including active. */
export function progressState(stepIndex: number, total: number = STEPS.length): boolean[] {
  return Array.from({ length: total }, (_, i) => i <= stepIndex);
}

/** Human label for the store choice ("App Store" / "Google Play"). */
export function storeLabel(store: Store): string {
  return store === "app-store" ? "App Store" : "Google Play";
}

/** Confirm a suggested rival: move it from `suggested` into `rivals` (idempotent). */
export function addRival(state: OnboardingState, rival: string): OnboardingState {
  const name = rival.trim();
  if (!name || state.rivals.includes(name)) return state;
  return {
    ...state,
    rivals: [...state.rivals, name],
    suggested: state.suggested.filter((s) => s !== name),
  };
}

/** Remove a confirmed rival. Does not re-suggest it — the user said no. */
export function removeRival(state: OnboardingState, rival: string): OnboardingState {
  if (!state.rivals.includes(rival)) return state;
  return { ...state, rivals: state.rivals.filter((r) => r !== rival) };
}

/** The sample state the design renders: step 3, App Store + Cal AI (A−). */
export function sampleState(): OnboardingState {
  return {
    stepIndex: STEPS.indexOf("rivals"),
    store: "app-store",
    app: { name: "Cal AI", grade: "A−" },
    rivals: ["MyFitnessPal", "Lose It!"],
    suggested: ["Lifesum", "Yazio", "Noom"],
  };
}

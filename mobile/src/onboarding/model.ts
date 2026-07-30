/**
 * Onboarding model — the pure state behind the mobile guided setup. Mirrors the
 * web stepper's rules (one decision per screen, prior answers stay visible, the
 * live audit ran inline) so both surfaces behave identically. Framework-free so
 * the step math and rival edits unit-test without React Native.
 */

/** The store a user optimizes for first. */
export type Store = "app-store" | "google-play";

/** The four setup steps, in order. */
export const STEPS = ["store", "app", "rivals", "connect"] as const;
export type Step = (typeof STEPS)[number];

export type OnboardingState = {
  /** Index into STEPS of the active screen. */
  stepIndex: number;
  store: Store | null;
  /** Connected app + its honest audit grade (null when unmeasured). */
  app: { name: string; grade: string | null } | null;
  /** Confirmed rivals — only these feed runs. */
  rivals: string[];
  /** Suggested-from-keywords rivals not yet confirmed. */
  suggested: string[];
};

/** One segment per step, filled up to and including the active one. */
export function progressState(stepIndex: number, total: number = STEPS.length): boolean[] {
  return Array.from({ length: total }, (_, i) => i <= stepIndex);
}

/** Human label for a store choice. */
export function storeLabel(store: Store): string {
  return store === "app-store" ? "App Store" : "Google Play";
}

/** Confirm a suggestion: move it into `rivals` (idempotent, trims input). */
export function addRival(state: OnboardingState, rival: string): OnboardingState {
  const name = rival.trim();
  if (!name || state.rivals.includes(name)) return state;
  return {
    ...state,
    rivals: [...state.rivals, name],
    suggested: state.suggested.filter((s) => s !== name),
  };
}

/** Remove a confirmed rival. Never re-suggests it — the user said no. */
export function removeRival(state: OnboardingState, rival: string): OnboardingState {
  if (!state.rivals.includes(rival)) return state;
  return { ...state, rivals: state.rivals.filter((r) => r !== rival) };
}

/** Record the store choice and advance to the next step. */
export function chooseStore(state: OnboardingState, store: Store): OnboardingState {
  return { ...state, store, stepIndex: Math.min(state.stepIndex + 1, STEPS.length - 1) };
}

/**
 * The collapsed "prior answers" chips pinned at the top of later steps — only
 * answers actually given, with the app's grade appended when it was measured.
 */
export function answerChips(state: OnboardingState): string[] {
  const chips: string[] = [];
  if (state.store) chips.push(storeLabel(state.store));
  if (state.app) chips.push(state.app.grade ? `${state.app.name} · ${state.app.grade}` : state.app.name);
  return chips;
}

/** A fresh flow, at step 1 with nothing answered. */
export function initialState(): OnboardingState {
  return { stepIndex: 0, store: null, app: null, rivals: [], suggested: [] };
}

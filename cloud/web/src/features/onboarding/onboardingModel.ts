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
  /**
   * The connected app (step 2). Name only: POST /apps returns
   * { id, name, bundleId } and carries NO grade — a grade exists only once the
   * run that connecting triggers has completed. types.ts:649 records what
   * happens when a type claims a field the server never sends: every read is
   * undefined and the UI renders empty, silently.
   */
  app: { name: string } | null;
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

/**
 * Record the store choice (step 1) and open the app step.
 *
 * App Store is the only real option today: POST /apps has no store parameter
 * and resolves via iTunes (a Play URL is parsed only to mine a bundle id, which
 * is then looked up on iTunes). The view renders Google Play disabled rather
 * than offering a choice that would silently connect the wrong listing.
 */
export function chooseStore(state: OnboardingState, store: Store): OnboardingState {
  return { ...state, store, stepIndex: Math.max(state.stepIndex, STEPS.indexOf("app")) };
}

/**
 * Record the connected app (step 2). Name only — see the `app` field on
 * OnboardingState for why there is no grade here.
 *
 * Advances to the LAST step, not to "rivals": once an app is connected, both
 * remaining steps (rivals and the optional key) are on screen together, so the
 * progress bar must show the user at the end rather than reading "Step 3 of 4"
 * forever with a segment that never fills.
 */
export function setApp(state: OnboardingState, app: { name: string }): OnboardingState {
  return { ...state, app, stepIndex: Math.max(state.stepIndex, STEPS.length - 1) };
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

/**
 * The starting state for a real user: nothing answered, nothing invented.
 *
 * Replaces sampleState(), which seeded a fabricated app ("Cal AI") and a
 * fabricated audit grade ("A−") and rendered them as the user's own result.
 * Measured-or-nothing: an unanswered step renders empty, never a plausible
 * sample. Fixtures for tests belong in tests.
 */
export function emptyState(): OnboardingState {
  return { stepIndex: 0, store: null, app: null, rivals: [], suggested: [] };
}

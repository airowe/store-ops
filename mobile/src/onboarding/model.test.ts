import {
  STEPS,
  addRival,
  removeRival,
  progressState,
  storeLabel,
  chooseStore,
  answerChips,
  initialState,
  type OnboardingState,
} from "./model";

const midFlow = (): OnboardingState => ({
  stepIndex: 2,
  store: "app-store",
  app: { name: "Cal AI", grade: "A−" },
  rivals: ["MyFitnessPal"],
  suggested: ["Lifesum", "Yazio"],
});

describe("onboarding model", () => {
  describe("progressState", () => {
    it("fills every segment up to and including the active step", () => {
      expect(progressState(2, 4)).toEqual([true, true, true, false]);
    });
    it("defaults to the number of STEPS", () => {
      expect(progressState(0)).toHaveLength(STEPS.length);
    });
  });

  describe("storeLabel", () => {
    it.each([
      ["app-store", "App Store"],
      ["google-play", "Google Play"],
    ] as const)("labels %s as %s", (store, label) => {
      expect(storeLabel(store)).toBe(label);
    });
  });

  describe("chooseStore", () => {
    it("records the choice and advances one step", () => {
      const next = chooseStore(initialState(), "google-play");
      expect(next.store).toBe("google-play");
      expect(next.stepIndex).toBe(1);
    });
    it("never advances past the last step", () => {
      const last = { ...initialState(), stepIndex: STEPS.length - 1 };
      expect(chooseStore(last, "app-store").stepIndex).toBe(STEPS.length - 1);
    });
  });

  describe("addRival", () => {
    it("promotes a suggestion and drops it from the suggestions", () => {
      const next = addRival(midFlow(), "Lifesum");
      expect(next.rivals).toContain("Lifesum");
      expect(next.suggested).not.toContain("Lifesum");
    });
    it("trims and de-duplicates", () => {
      expect(addRival(midFlow(), "  Yazio  ").rivals).toContain("Yazio");
      expect(addRival(midFlow(), "MyFitnessPal").rivals).toEqual(["MyFitnessPal"]);
    });
    it("returns the same reference on a no-op", () => {
      const s = midFlow();
      expect(addRival(s, "MyFitnessPal")).toBe(s);
      expect(addRival(s, "   ")).toBe(s);
    });
  });

  describe("removeRival", () => {
    it("removes a confirmed rival without re-suggesting it", () => {
      const next = removeRival(midFlow(), "MyFitnessPal");
      expect(next.rivals).toEqual([]);
      expect(next.suggested).toEqual(midFlow().suggested);
    });
    it("returns the same reference for an unknown rival", () => {
      const s = midFlow();
      expect(removeRival(s, "Ghost")).toBe(s);
    });
  });

  describe("answerChips", () => {
    it("pins only the answers actually given, with the measured grade", () => {
      expect(answerChips(midFlow())).toEqual(["App Store", "Cal AI · A−"]);
    });
    it("omits the grade when the audit did not measure one", () => {
      const s = { ...midFlow(), app: { name: "Cal AI", grade: null } };
      expect(answerChips(s)).toEqual(["App Store", "Cal AI"]);
    });
    it("is empty at the start — nothing answered, nothing pinned", () => {
      expect(answerChips(initialState())).toEqual([]);
    });
  });
});

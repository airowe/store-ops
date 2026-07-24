import { describe, it, expect } from "vitest";
import {
  STEPS,
  addRival,
  removeRival,
  progressState,
  storeLabel,
  sampleState,
  type OnboardingState,
} from "./onboardingModel.js";

const base = (): OnboardingState => ({
  stepIndex: 2,
  store: "app-store",
  app: { name: "Cal AI", grade: "A−" },
  rivals: ["MyFitnessPal"],
  suggested: ["Lifesum", "Yazio"],
});

describe("onboardingModel", () => {
  describe("progressState", () => {
    it("fills every segment up to and including the active step", () => {
      // active = index 2 of 4 → [filled, filled, filled, empty]
      expect(progressState(2, 4)).toEqual([true, true, true, false]);
    });
    it("defaults total to the number of STEPS", () => {
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

  describe("addRival", () => {
    it("promotes a suggestion into confirmed rivals and drops it from suggestions", () => {
      const next = addRival(base(), "Lifesum");
      expect(next.rivals).toContain("Lifesum");
      expect(next.suggested).not.toContain("Lifesum");
    });
    it("trims whitespace before adding", () => {
      expect(addRival(base(), "  Noom  ").rivals).toContain("Noom");
    });
    it("is idempotent — a rival already confirmed is not duplicated", () => {
      expect(addRival(base(), "MyFitnessPal").rivals).toEqual(["MyFitnessPal"]);
    });
    it("returns the same reference when nothing changes (no-op add)", () => {
      const s = base();
      expect(addRival(s, "MyFitnessPal")).toBe(s);
      expect(addRival(s, "   ")).toBe(s);
    });
  });

  describe("removeRival", () => {
    it("removes a confirmed rival", () => {
      expect(removeRival(base(), "MyFitnessPal").rivals).toEqual([]);
    });
    it("does not re-suggest a removed rival (the user said no)", () => {
      const next = removeRival(base(), "MyFitnessPal");
      expect(next.suggested).toEqual(base().suggested);
    });
    it("returns the same reference for an unknown rival", () => {
      const s = base();
      expect(removeRival(s, "Ghost")).toBe(s);
    });
  });

  describe("sampleState", () => {
    it("matches the design: step 3 (rivals), App Store, Cal AI graded A−", () => {
      const s = sampleState();
      expect(STEPS[s.stepIndex]).toBe("rivals");
      expect(s.store).toBe("app-store");
      expect(s.app).toEqual({ name: "Cal AI", grade: "A−" });
      expect(s.rivals).toEqual(["MyFitnessPal", "Lose It!"]);
    });
  });
});

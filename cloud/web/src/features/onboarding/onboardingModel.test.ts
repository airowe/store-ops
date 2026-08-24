import { describe, it, expect } from "vitest";
import {
  STEPS,
  addRival,
  removeRival,
  progressState,
  storeLabel,
  emptyState,
  chooseStore,
  setApp,
  type OnboardingState,
} from "./onboardingModel.js";

const base = (): OnboardingState => ({
  stepIndex: 2,
  store: "app-store",
  app: { name: "Cal AI" },
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

  // The default state a real user starts from. This replaced sampleState(),
  // which seeded a fabricated app ("Cal AI") and a fabricated audit grade
  // ("A−") and rendered them as the user's OWN result — a measured-or-nothing
  // violation that shipped because the old test asserted the fake values were
  // present rather than that nothing was invented.
  describe("chooseStore", () => {
    it("records the store and advances to the app step", () => {
      const s = chooseStore(emptyState(), "app-store");
      expect(s.store).toBe("app-store");
      expect(STEPS[s.stepIndex]).toBe("app");
    });
    it("never walks the stepper backwards", () => {
      const s = chooseStore({ ...emptyState(), stepIndex: 2 }, "app-store");
      expect(s.stepIndex).toBe(2);
    });
  });

  describe("setApp", () => {
    it("records the app name and advances to rivals", () => {
      const s = setApp(chooseStore(emptyState(), "app-store"), { name: "Acme" });
      expect(s.app).toEqual({ name: "Acme" });
      expect(STEPS[s.stepIndex]).toBe("rivals");
    });
  });

  describe("emptyState", () => {
    it("invents no app, no grade, no store, and no rivals", () => {
      const s = emptyState();
      expect(s.app).toBeNull();
      expect(s.store).toBeNull();
      expect(s.rivals).toEqual([]);
      expect(s.suggested).toEqual([]);
      expect(STEPS[s.stepIndex]).toBe("store");
    });
  });
});

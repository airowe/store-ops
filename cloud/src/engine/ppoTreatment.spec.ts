import { describe, expect, it } from "vitest";
import { buildPpoTreatmentPlan } from "./ppoTreatment.js";
import type { AscExperimentsResult } from "./ascExperiments.js";

const read = (experiments: AscExperimentsResult["experiments"]): AscExperimentsResult => ({
  experiments,
  read: true,
});

describe("buildPpoTreatmentPlan", () => {
  it("returns null when there's no experiments read (keyless run)", () => {
    expect(buildPpoTreatmentPlan({})).toBeNull();
    expect(buildPpoTreatmentPlan({ experiments: undefined })).toBeNull();
  });

  it("returns null on a DEGRADED read — never proposes off an unconfirmed state", () => {
    expect(buildPpoTreatmentPlan({ experiments: { experiments: [], read: false } })).toBeNull();
  });

  it("returns null when a test is already running (don't distract from the live one)", () => {
    const running = read([{ id: "e1", started: true, state: "ACCEPTED" }]);
    expect(buildPpoTreatmentPlan({ experiments: running })).toBeNull();
  });

  it("proposes an outcome-led treatment when read OK and nothing is running", () => {
    const plan = buildPpoTreatmentPlan({ experiments: read([]) });
    expect(plan).not.toBeNull();
    expect(plan!.headline).toMatch(/outcome-led/i);
    // the first-screenshot step is the load-bearing one
    expect(plan!.steps.join(" ")).toMatch(/first screenshot/i);
    // cited public result, never our own metric
    expect(plan!.evidence).toMatch(/public Product Page Optimization/i);
    // the don't-judge-early guidance is always present
    expect(plan!.guidance).toMatch(/90 days/);
    expect(plan!.guidance).toMatch(/confidence/i);
  });

  it("proposes even when tests ran before but none is running now", () => {
    const plan = buildPpoTreatmentPlan({ experiments: read([{ id: "old", started: true, state: "COMPLETED" }]) });
    expect(plan).not.toBeNull();
  });

  it("names the MEASURED rating in the social-proof step when we read one", () => {
    const plan = buildPpoTreatmentPlan({ experiments: read([]), ratingAverage: 4.62 });
    expect(plan!.steps.join(" ")).toContain("4.6★");
  });

  it("falls back to a generic social-proof step when no rating was read (never a fabricated star)", () => {
    const plan = buildPpoTreatmentPlan({ experiments: read([]), ratingAverage: null });
    const steps = plan!.steps.join(" ");
    expect(steps).toMatch(/social-proof slide/i);
    expect(steps).not.toMatch(/★/);
  });

  it("includes an ASC deep link only when the trackId is known", () => {
    expect(buildPpoTreatmentPlan({ experiments: read([]), trackId: "12345" })!.ascUrl).toBe(
      "https://appstoreconnect.apple.com/apps/12345/distribution",
    );
    expect(buildPpoTreatmentPlan({ experiments: read([]) })!.ascUrl).toBeUndefined();
  });
});

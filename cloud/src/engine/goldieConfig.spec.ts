import { describe, expect, it } from "vitest";
import { goldieConfig, renderGoldieConfigTs, type GoldieConfigInput } from "./goldieConfig.js";
import { PLAN_DRAFT_LABEL, type ScreenshotPlan } from "./screenshotPlanner.js";

const plan = (over: Partial<ScreenshotPlan> = {}): ScreenshotPlan => ({
  narrative: "Lead with the calm, prove it with the streak.",
  label: PLAN_DRAFT_LABEL,
  degraded: false,
  shots: [
    { sourceScreen: "home", headline: "Calm without the woo", subline: "Secular meditation, five minutes a day.", templateId: "spotlight", accent: "#34d399" },
    { sourceScreen: "streak", headline: "See the streak hold", templateId: "editorial" },
    { sourceScreen: "MISSING", missingReason: "no captured screen shows the reminder settings", headline: "Reminders that respect you", templateId: "spotlight" },
    { sourceScreen: "library", headline: "The best meditation app", templateId: "editorial", needsReview: true, headlineIssue: "unmeasured claim: best" },
  ],
  ...over,
});

const input = (over: Partial<GoldieConfigInput> = {}): GoldieConfigInput => ({
  runId: "run_123",
  generatedAt: "2026-09-05T20:00:00.000Z",
  appName: "Heathen",
  bundleId: "app.airowe.clarity",
  subtitle: "Secular meditation",
  description: "Meditation without the spiritual layer.",
  locales: ["en-US", "de-DE"],
  localizedSubtitles: { "de-DE": "Weltliche Meditation" },
  plan: plan(),
  palette: ["#07090e", "#34d399"],
  ...over,
});

describe("goldieConfig — the diagnosis half, in goldie's shape", () => {
  it("one screenshot scene per sourced shot, in plan order, with flow names the developer records", () => {
    const c = goldieConfig(input());
    expect(c.scenes.map((s) => s.id)).toEqual(["home", "streak", "library"]);
    expect(c.scenes.map((s) => s.flow)).toEqual(["store-01-home", "store-02-streak", "store-03-library"]);
    expect(c.scenes[0]!.headline).toEqual({ "en-US": "Calm without the woo" });
    expect(c.scenes[0]!.subhead).toEqual({ "en-US": "Secular meditation, five minutes a day." });
    expect(c.scenes[1]!.subhead).toBeUndefined();
  });

  it("a MISSING shot becomes no scene; it is listed as skipped with the reason", () => {
    const c = goldieConfig(input());
    expect(c.skipped).toEqual([{ headline: "Reminders that respect you", reason: "no captured screen shows the reminder settings" }]);
  });

  it("a headline the lint flagged is kept and carries its issue for review, never dropped", () => {
    const c = goldieConfig(input());
    const lib = c.scenes.find((s) => s.id === "library")!;
    expect(lib.headline["en-US"]).toBe("The best meditation app");
    expect(lib.review).toBe("unmeasured claim: best");
  });

  it("store fields come from the run's copy; nothing cosmetic is invented", () => {
    const c = goldieConfig(input());
    expect(c.store.name).toBe("Heathen");
    expect(c.store.subtitle).toEqual({ "en-US": "Secular meditation", "de-DE": "Weltliche Meditation" });
    expect(c.store.description).toEqual({ "en-US": "Meditation without the spiritual layer." });
    expect("rating" in c.store).toBe(false);
    expect("ratingCount" in c.store).toBe(false);
    expect("ageRating" in c.store).toBe(false);
  });

  it("locales are the storefront first, then the localized ones; theme background only from a real palette", () => {
    expect(goldieConfig(input()).locales).toEqual(["en-US", "de-DE"]);
    expect(goldieConfig(input()).theme.background).toBe("#07090e");
    expect(goldieConfig(input({ palette: [] })).theme.background).toBeUndefined();
  });

  it("carries the draft label and the planner's degraded flag through", () => {
    expect(goldieConfig(input()).label).toBe(PLAN_DRAFT_LABEL);
    expect(goldieConfig(input({ plan: plan({ degraded: true }) })).degraded).toBe(true);
  });

  it("a plan with nothing sourced yields no scenes and says so, not a fabricated scene", () => {
    const c = goldieConfig(input({ plan: plan({ shots: [{ sourceScreen: "MISSING", missingReason: "no captures", headline: "x", templateId: "spotlight" }] }) }));
    expect(c.scenes).toEqual([]);
    expect(c.skipped).toHaveLength(1);
  });
});

describe("renderGoldieConfigTs — the file the developer drops in", () => {
  const ts = renderGoldieConfigTs(goldieConfig(input()));

  it("is a goldie config module with the paths left for the developer to fill", () => {
    expect(ts).toContain('import type { GoldieConfig } from "goldie/config"');
    expect(ts).toContain("const config: GoldieConfig = {");
    expect(ts).toContain("export default config;");
    expect(ts).toContain("FILL IN");
    expect(ts).toMatch(/appPath: `\$\{APP_ROOT\}/);
    expect(ts).toContain('bundleId: "app.airowe.clarity"');
  });

  it("states provenance and the draft caveat at the top", () => {
    expect(ts).toContain("run_123");
    expect(ts).toContain("2026-09-05");
    expect(ts).toContain(PLAN_DRAFT_LABEL);
  });

  it("renders every scene, marks the reviewed one, and comments the skipped one", () => {
    expect(ts).toContain('flow: "store-01-home"');
    expect(ts).toContain('"en-US": "Calm without the woo"');
    expect(ts).toContain("REVIEW: unmeasured claim: best");
    expect(ts).toContain("Skipped: no captured screen shows the reminder settings");
  });

  it("escapes quotes and backslashes in copy so the file always parses", () => {
    const hostile = renderGoldieConfigTs(
      goldieConfig(input({ plan: plan({ shots: [{ sourceScreen: "home", headline: 'Say "hi" \\ now', templateId: "spotlight" }] }) })),
    );
    expect(hostile).toContain('"en-US": "Say \\"hi\\" \\\\ now"');
    expect(hostile).not.toContain('"Say "hi"');
  });

  it("never emits a rating or an age rating", () => {
    expect(ts).not.toMatch(/rating:/);
    expect(ts).not.toMatch(/ageRating/);
  });
});

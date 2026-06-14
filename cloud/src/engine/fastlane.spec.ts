import { describe, expect, it } from "vitest";
import { buildFastlaneBundle, fastlaneReadme } from "./fastlane.js";
import type { CopyFields } from "./optimize.js";

const fullCopy: CopyFields = {
  name: "Calm · Calm Tracker",
  subtitle: "Habit Tracker",
  keywords: "moodjournal,dailyplanner,focustimer,budgetapp",
  promo: "New: Calm Tracker just got faster.",
  description: "The calmest way to build habits.",
};

const minimalCopy: CopyFields = {
  name: "Calm",
  subtitle: "Habit Tracker",
  keywords: "moodjournal,dailyplanner",
};

function asMap(files: { path: string; content: string }[]) {
  return Object.fromEntries(files.map((f) => [f.path, f.content]));
}

describe("buildFastlaneBundle — fastlane/metadata tree from proposed copy", () => {
  it("writes the App Store deliver files under the given locale", () => {
    const m = asMap(buildFastlaneBundle(fullCopy, { locale: "en-US" }).files);
    expect(m["fastlane/metadata/en-US/name.txt"]).toBe(fullCopy.name);
    expect(m["fastlane/metadata/en-US/subtitle.txt"]).toBe(fullCopy.subtitle);
    expect(m["fastlane/metadata/en-US/keywords.txt"]).toBe(fullCopy.keywords);
    expect(m["fastlane/metadata/en-US/promotional_text.txt"]).toBe(fullCopy.promo);
    expect(m["fastlane/metadata/en-US/description.txt"]).toBe(fullCopy.description);
  });

  it("writes the Google Play supply files under metadata/android/<locale>", () => {
    const m = asMap(buildFastlaneBundle(fullCopy, { locale: "en-US" }).files);
    // Play has no keyword field; title + short/full description only.
    expect(m["fastlane/metadata/android/en-US/title.txt"]).toBe(fullCopy.name);
    expect(m["fastlane/metadata/android/en-US/short_description.txt"]).toBe(fullCopy.subtitle);
    expect(m["fastlane/metadata/android/en-US/full_description.txt"]).toBe(fullCopy.description);
    // and NO keyword file on the Play side
    expect(m["fastlane/metadata/android/en-US/keywords.txt"]).toBeUndefined();
  });

  it("defaults the locale to en-US when none is given", () => {
    const m = asMap(buildFastlaneBundle(minimalCopy).files);
    expect(m["fastlane/metadata/en-US/name.txt"]).toBe(minimalCopy.name);
  });

  it("omits optional files when promo/description are absent", () => {
    const m = asMap(buildFastlaneBundle(minimalCopy, { locale: "en-US" }).files);
    expect(m["fastlane/metadata/en-US/promotional_text.txt"]).toBeUndefined();
    expect(m["fastlane/metadata/en-US/description.txt"]).toBeUndefined();
    // Play full_description also absent (it maps from description)
    expect(m["fastlane/metadata/android/en-US/full_description.txt"]).toBeUndefined();
    // but the required files are always present
    expect(m["fastlane/metadata/en-US/name.txt"]).toBe(minimalCopy.name);
    expect(m["fastlane/metadata/android/en-US/title.txt"]).toBe(minimalCopy.name);
  });

  it("file contents have no trailing newline (deliver reads the file verbatim)", () => {
    const m = asMap(buildFastlaneBundle(fullCopy, { locale: "en-US" }).files);
    // a stray newline becomes part of the App Store name — must not happen
    expect(m["fastlane/metadata/en-US/name.txt"]!.endsWith("\n")).toBe(false);
    expect(m["fastlane/metadata/en-US/keywords.txt"]!.endsWith("\n")).toBe(false);
  });

  it("includes a README explaining how CI consumes the tree", () => {
    const bundle = buildFastlaneBundle(fullCopy, { locale: "en-US" });
    const m = asMap(bundle.files);
    const readme = m["fastlane/metadata/SHIPASO_README.md"];
    expect(readme).toBeDefined();
    expect(readme!.toLowerCase()).toContain("deliver");
    expect(readme!.toLowerCase()).toContain("supply");
  });

  it("supports non-US locales", () => {
    const m = asMap(buildFastlaneBundle(fullCopy, { locale: "de-DE" }).files);
    expect(m["fastlane/metadata/de-DE/name.txt"]).toBe(fullCopy.name);
    expect(m["fastlane/metadata/android/de-DE/title.txt"]).toBe(fullCopy.name);
  });
});

describe("fastlaneReadme", () => {
  it("names the exact commands CI would run", () => {
    const r = fastlaneReadme("en-US");
    expect(r).toContain("fastlane deliver");
    expect(r).toContain("fastlane supply");
    // makes clear ShipASO does not hold credentials
    expect(r.toLowerCase()).toContain("credential");
  });
});

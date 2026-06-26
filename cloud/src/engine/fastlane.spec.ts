import { describe, expect, it } from "vitest";
import { buildFastlaneBundle, fastlaneReadme } from "./fastlane.js";
import type { CopyFields } from "./optimize.js";

const fullCopy: CopyFields = {
  name: "Calm · Calm Tracker",
  subtitle: "Habit Tracker",
  keywords: "moodjournal,dailyplanner,focustimer,budgetapp",
  promo: "New: Calm Tracker just got faster.",
  description: "The calmest way to build habits.",
  whatsNew: "Added offline streaks. Fixed a sync crash.",
};

const minimalCopy: CopyFields = {
  name: "Calm",
  subtitle: "Habit Tracker",
  keywords: "moodjournal,dailyplanner",
};

function asMap(files: { path: string; content: string }[]) {
  return Object.fromEntries(files.map((f) => [f.path, f.content]));
}

describe("buildFastlaneBundle — empty fields are NOT written (the #29 fix)", () => {
  it("omits a metadata file for an empty field (so deliver can't WIPE the live value)", () => {
    // #30 leaves subtitle/keywords empty when ASC wasn't read — the handoff must
    // then NOT emit subtitle.txt/keywords.txt, or `fastlane deliver` would blank
    // the live subtitle/keyword field on App Store Connect.
    const noSubKw: CopyFields = { name: "Heathen", subtitle: "", keywords: "", description: "A meditation app." };
    const m = asMap(buildFastlaneBundle(noSubKw).files);
    expect("fastlane/metadata/en-US/subtitle.txt" in m).toBe(false);
    expect("fastlane/metadata/en-US/keywords.txt" in m).toBe(false);
    // non-empty fields are still written
    expect(m["fastlane/metadata/en-US/name.txt"]).toBe("Heathen");
    expect(m["fastlane/metadata/en-US/description.txt"]).toBe("A meditation app.");
  });

  it("the bundle README warns that committing it overwrites existing metadata", () => {
    const readme = fastlaneReadme("en-US");
    expect(readme.toLowerCase()).toContain("overwrite");
  });
});

describe("buildFastlaneBundle — fastlane/metadata tree from proposed copy", () => {
  it("writes the App Store deliver files under the given locale", () => {
    const m = asMap(buildFastlaneBundle(fullCopy, { locale: "en-US" }).files);
    expect(m["fastlane/metadata/en-US/name.txt"]).toBe(fullCopy.name);
    expect(m["fastlane/metadata/en-US/subtitle.txt"]).toBe(fullCopy.subtitle);
    expect(m["fastlane/metadata/en-US/keywords.txt"]).toBe(fullCopy.keywords);
    expect(m["fastlane/metadata/en-US/promotional_text.txt"]).toBe(fullCopy.promo);
    expect(m["fastlane/metadata/en-US/description.txt"]).toBe(fullCopy.description);
    expect(m["fastlane/metadata/en-US/release_notes.txt"]).toBe(fullCopy.whatsNew); // (#46)
  });

  it("emits NO Google Play (android) files — ShipASO is iOS-only", () => {
    // ShipASO does not connect to Google Play, runs no Play audit, and Play
    // indexes copy differently. Emitting metadata/android/* derived from iOS copy
    // would present an unsupported store as supported — so no android tree is
    // written until real Play support exists (PRD-05).
    const m = asMap(buildFastlaneBundle(fullCopy, { locale: "en-US" }).files);
    const androidFiles = Object.keys(m).filter((p) => p.includes("/metadata/android/"));
    expect(androidFiles).toEqual([]);
  });

  it("defaults the locale to en-US when none is given", () => {
    const m = asMap(buildFastlaneBundle(minimalCopy).files);
    expect(m["fastlane/metadata/en-US/name.txt"]).toBe(minimalCopy.name);
  });

  it("omits optional files when promo/description are absent", () => {
    const m = asMap(buildFastlaneBundle(minimalCopy, { locale: "en-US" }).files);
    expect(m["fastlane/metadata/en-US/promotional_text.txt"]).toBeUndefined();
    expect(m["fastlane/metadata/en-US/description.txt"]).toBeUndefined();
    expect(m["fastlane/metadata/en-US/release_notes.txt"]).toBeUndefined(); // (#46)
    // but the required iOS files are always present
    expect(m["fastlane/metadata/en-US/name.txt"]).toBe(minimalCopy.name);
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
    // iOS-only: the README must NOT reference Google Play / supply
    expect(readme!.toLowerCase()).not.toContain("supply");
    expect(readme!.toLowerCase()).not.toContain("google play");
  });

  it("supports non-US locales", () => {
    const m = asMap(buildFastlaneBundle(fullCopy, { locale: "de-DE" }).files);
    expect(m["fastlane/metadata/de-DE/name.txt"]).toBe(fullCopy.name);
  });
});

describe("fastlaneReadme", () => {
  it("names the exact commands CI would run", () => {
    const r = fastlaneReadme("en-US");
    expect(r).toContain("fastlane deliver");
    // iOS-only: no Google Play / supply command
    expect(r).not.toContain("fastlane supply");
    // makes clear ShipASO does not hold credentials
    expect(r.toLowerCase()).toContain("credential");
  });
});

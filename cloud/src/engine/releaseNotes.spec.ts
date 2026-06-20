import { describe, expect, it } from "vitest";
import { humanizeReleaseNotes, RELEASE_NOTES_LIMIT } from "./releaseNotes.js";

// ── humanizeReleaseNotes: a PURE re-tone of the What's New copy ───────────────
//
// The contract is deterministic and HONEST: it improves the TONE/readability of
// whatever text is there, and NEVER invents feature content. If the user pasted
// no real specifics (or only boilerplate), it must say so via flags so the UI can
// nudge for real changelog detail rather than fabricating "New: dark mode".

describe("humanizeReleaseNotes — pure, deterministic, never invents content", () => {
  it("is deterministic: same input → identical output", () => {
    const input = "We fixed some bugs.\nWe improved performance.";
    const a = humanizeReleaseNotes({ current: input });
    const b = humanizeReleaseNotes({ current: input });
    expect(a).toEqual(b);
  });

  it("flags the classic boilerplate and needsRealContent without inventing features", () => {
    const r = humanizeReleaseNotes({ current: "Bug fixes and performance improvements" });
    expect(r.isBoilerplate).toBe(true);
    expect(r.needsRealContent).toBe(true);
    // It must NOT manufacture a specific feature out of nothing.
    expect(r.humanized.toLowerCase()).not.toContain("dark mode");
    expect(r.humanized.toLowerCase()).not.toContain("new feature");
    // The boilerplate nudge stays honest: no claim of new functionality.
    expect(r.humanized).not.toMatch(/\bnew\b/i);
  });

  it("recognises boilerplate regardless of case/punctuation/whitespace", () => {
    for (const variant of [
      "bug fixes and performance improvements.",
      "  Bug   fixes   and   performance   improvements  ",
      "Bugfixes and performance improvements",
    ]) {
      expect(humanizeReleaseNotes({ current: variant }).isBoilerplate).toBe(true);
    }
  });

  it("treats empty / whitespace-only input as needing real content (no fabrication)", () => {
    for (const empty of ["", "   ", "\n\n"]) {
      const r = humanizeReleaseNotes({ current: empty });
      expect(r.needsRealContent).toBe(true);
      expect(r.isBoilerplate).toBe(true);
      expect(r.humanized).not.toBe("");
    }
  });

  it("preserves real changelog content — never drops the user's specifics", () => {
    const r = humanizeReleaseNotes({
      current: "Added offline mode. Fixed a crash when opening the settings screen.",
    });
    expect(r.isBoilerplate).toBe(false);
    expect(r.needsRealContent).toBe(false);
    // The concrete facts the user wrote must survive the re-tone.
    expect(r.humanized.toLowerCase()).toContain("offline");
    expect(r.humanized.toLowerCase()).toContain("settings");
  });

  it("warms stiff phrasing without adding facts", () => {
    const r = humanizeReleaseNotes({ current: "We have implemented a new export option." });
    // "We have implemented" → a warmer, plainer verb; the fact (export) survives.
    expect(r.humanized.toLowerCase()).toContain("export");
    expect(r.humanized).not.toContain("We have implemented");
  });

  it("normalises whitespace and collapses blank lines", () => {
    const r = humanizeReleaseNotes({ current: "Added search.\n\n\n\nFixed sync.   " });
    expect(r.humanized).not.toMatch(/\n{3,}/);
    expect(r.humanized).not.toMatch(/[ \t]+\n/);
    expect(r.humanized.endsWith(" ")).toBe(false);
  });

  it("never exceeds the App Store What's New limit", () => {
    const long = "Added a thing. ".repeat(1000);
    const r = humanizeReleaseNotes({ current: long });
    expect(r.humanized.length).toBeLessThanOrEqual(RELEASE_NOTES_LIMIT);
  });

  it("does not echo the app voice as invented copy (voice is tone-only context)", () => {
    const r = humanizeReleaseNotes({
      current: "Fixed a sync bug.",
      voice: { name: "Calm", subtitle: "Sleep & meditation" },
    });
    // Voice must not be spliced into the notes as if it were a shipped change.
    expect(r.humanized.toLowerCase()).not.toContain("sleep & meditation");
    expect(r.humanized.toLowerCase()).toContain("sync");
  });

  it("reports whether the text actually changed (so the UI can skip a no-op diff)", () => {
    const already = "Added offline mode.";
    const r = humanizeReleaseNotes({ current: already });
    expect(typeof r.changed).toBe("boolean");
    // and a guaranteed-stiff input must register as changed
    expect(humanizeReleaseNotes({ current: "We have added X." }).changed).toBe(true);
  });
});

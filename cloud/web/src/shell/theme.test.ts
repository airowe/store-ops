/**
 * Theme preference resolution (#362).
 *
 * The web app shipped with a two-state preference — "light" or "dark" — and a
 * boot script that only read that key. There was no way to express "follow my
 * system", and an ABSENT preference meant dark rather than "ask the OS", so a
 * machine set to Light rendered a dark app until someone found the toggle.
 *
 * Mobile already solved this (`mobile/src/theme/ThemeProvider.tsx` #353) with a
 * three-state `system | light | dark` preference defaulting to `system`. This
 * mirrors that model so the two surfaces agree.
 *
 * Pure on purpose: the interesting cases (absent key, junk value, explicit
 * choice beating the OS, live OS change) are all logic, and testing them
 * through a rendered component would prove less while breaking more often.
 */
import { describe, expect, it } from "vitest";
import { readMode, resolveScheme, type ThemeMode } from "./theme.js";

describe("resolveScheme", () => {
  it.each([
    ["light", "dark", "light"],
    ["light", "light", "light"],
    ["dark", "light", "dark"],
    ["dark", "dark", "dark"],
  ] as const)("an explicit %s preference wins over an OS set to %s", (mode, os, want) => {
    expect(resolveScheme(mode, os)).toBe(want);
  });

  it.each([
    ["light", "light"],
    ["dark", "dark"],
  ] as const)("mode 'system' follows the OS (%s)", (os, want) => {
    expect(resolveScheme("system", os)).toBe(want);
  });

  // The OS value is unavailable in older browsers and in some headless
  // contexts. Dark is the brand default, so that is the honest fallback —
  // but ONLY when we genuinely could not read a preference.
  it.each([[null], [undefined]] as const)("falls back to dark when the OS scheme is %s", (os) => {
    expect(resolveScheme("system", os)).toBe("dark");
  });
});

describe("readMode", () => {
  it("reads a stored explicit preference", () => {
    expect(readMode("light")).toBe("light");
    expect(readMode("dark")).toBe("dark");
    expect(readMode("system")).toBe("system");
  });

  /**
   * The heart of #362. Absent previously meant dark; it now means "follow the
   * OS", which is what changes the default for everyone who never touched the
   * toggle. Junk values (a hand-edited key, or a value written by a future
   * version) degrade to the same safe default rather than to dark.
   */
  it.each([[null], [undefined], [""], ["Light"], ["auto"], ["{}"]] as const)(
    "treats %s as 'system', not as dark",
    (stored) => {
      expect(readMode(stored)).toBe("system");
    },
  );
});

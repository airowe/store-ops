/**
 * The pre-paint theme script must agree with `shell/theme.ts` (#362).
 *
 * index.html carries an inline copy of the resolution logic because it has to
 * run before first paint — deferring to the bundle would paint one frame of the
 * wrong theme. That copy is real duplication, and duplication drifts: the whole
 * bug in #362 was a boot script that read the stored key and stopped there.
 *
 * These assert the inline script's BEHAVIOUR by executing it, rather than
 * matching its source text, so reformatting is free but a logic change fails.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveScheme, readMode, type ThemeMode } from "./theme.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "..", "index.html"), "utf8");

/** The contents of the first inline <script> in <head>. */
function bootScript(): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no inline boot script found in index.html");
  return m[1]!;
}

/**
 * Run the boot script against a fake localStorage + matchMedia, and report the
 * `data-theme` it set.
 */
function runBoot(stored: string | null, osIsLight: boolean): string | null {
  document.documentElement.removeAttribute("data-theme");
  // Stub the global directly: this environment's `localStorage` is not backed
  // by `Storage.prototype`, so spying on the prototype silently does nothing
  // and every case would read null (i.e. pass for the wrong reason).
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k === "store-ops:theme" ? stored : null),
    setItem: () => {},
  });
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("light") ? osIsLight : !osIsLight,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  // eslint-disable-next-line no-new-func -- executing the shipped script is the point
  new Function(bootScript())();
  return document.documentElement.getAttribute("data-theme");
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

describe("index.html pre-paint theme script (#362)", () => {
  it("is inline in <head>, so it cannot paint the wrong theme first", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain("prefers-color-scheme: light");
    // A deferred/module script would run after first paint.
    expect(bootScript()).not.toMatch(/\b(defer|async)\b/);
  });

  it.each([
    ["absent + OS light", null, true, "light"],
    ["absent + OS dark", null, false, "dark"],
    ["'system' + OS light", "system", true, "light"],
    ["'system' + OS dark", "system", false, "dark"],
    ["explicit light beats OS dark", "light", false, "light"],
    ["explicit dark beats OS light", "dark", true, "dark"],
    ["junk value follows the OS", "auto", true, "light"],
  ] as const)("%s → %s", (_label, stored, osIsLight, want) => {
    expect(runBoot(stored, osIsLight)).toBe(want);
  });

  /**
   * The real guard: for every input, the shipped inline script and the tested
   * module must reach the same answer. If someone edits one, this fails.
   */
  it.each([null, "system", "light", "dark", "auto", ""] as const)(
    "agrees with shell/theme.ts for stored=%s",
    (stored) => {
      for (const osIsLight of [true, false]) {
        const mode: ThemeMode = readMode(stored);
        const expected = resolveScheme(mode, osIsLight ? "light" : "dark");
        expect(runBoot(stored, osIsLight)).toBe(expected);
      }
    },
  );
});

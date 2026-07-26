import { describe, it, expect } from "vitest";
import { chromeFor, activeNav, NAV_ITEMS } from "./shellChrome.js";

describe("shellChrome", () => {
  describe("chromeFor", () => {
    it.each([
      ["/dashboard", "railed"],
      ["/settings", "railed"],
      ["/apps/abc", "railed"],
      ["/apps/abc/war-room", "railed"],
      ["/runs/xyz", "railed"],
      ["/runs", "railed"],
      ["/keywords", "railed"],
      ["/competitors", "railed"],
    ] as const)("gives the app rail to authed route %s", (path, chrome) => {
      expect(chromeFor(path)).toBe(chrome);
    });

    it.each([
      ["/", "plain"],
      ["/login", "plain"],
      ["/preview", "plain"],
      ["/proof", "plain"],
      ["/privacy", "plain"],
      ["/broadcast", "plain"],
      ["/_shell/health", "plain"],
    ] as const)("keeps public/marketing route %s on the centered column", (path, chrome) => {
      expect(chromeFor(path)).toBe(chrome);
    });

    it("normalizes a trailing slash", () => {
      expect(chromeFor("/dashboard/")).toBe("railed");
    });

    it("does not rail the bare /apps connect endpoint", () => {
      expect(chromeFor("/apps")).toBe("plain");
    });
  });

  describe("activeNav", () => {
    it.each([
      ["/dashboard", "overview"],
      ["/settings", "settings"],
      ["/runs/xyz", "runs"],
      ["/apps/abc", "apps"],
      ["/runs", "runs"],
      ["/keywords", "keywords"],
      ["/competitors", "competitors"],
    ] as const)("highlights %s → %s", (path, key) => {
      expect(activeNav(path)).toBe(key);
    });

    it("returns null off the rail", () => {
      expect(activeNav("/")).toBeNull();
    });

    it("every active key maps to a real nav item", () => {
      const keys = new Set(NAV_ITEMS.map((n) => n.key));
      for (const p of ["/dashboard", "/settings", "/runs/x", "/apps/y", "/keywords", "/competitors"]) {
        const k = activeNav(p);
        expect(k && keys.has(k)).toBe(true);
      }
    });
  });
});

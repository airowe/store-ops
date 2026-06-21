import { describe, it, expect } from "vitest";
// The pure logic lives in plain ESM (scripts/freshness.mjs) so the Node-20 CI
// runner imports it without a TS loader — same rationale as stampAssets.spec.ts.
// app.js mirrors these two functions inline; this is the tested source of truth.
import { bundleRefFromHtml, isStale } from "../../scripts/freshness.mjs";

/**
 * SPA freshness (#54): a tab left open across a deploy keeps running the OLD
 * app.<hash>.js until a full reload. We detect that by re-fetching the always-
 * no-cache /index.html and comparing the app bundle it references against the
 * bundle the browser actually executed (document.currentScript.src). These two
 * pure functions are the comparison core; the honesty rule is baked in — any
 * uncertainty (unknown self URL, parse failure, un-hashed dev bundle) returns
 * "not stale" so we NEVER nag on a guess.
 */

// Named hash constants — no unexplained literals. These mirror the real shapes
// observed in #54 (app.fa044e53….js was the stale tab; app.919d95b3….js shipped).
const OLD = "fa044e53";
const NEW = "919d95b3";

describe("bundleRefFromHtml", () => {
  // The realistic 3-script shape the dashboard ships (index.html:38-40), here in
  // its STAMPED (deployed dist/) form where app.js is content-hashed.
  function stampedHtml(appName: string): string {
    return [
      "<!doctype html><html><head>",
      '<link rel="stylesheet" href="styles.css" />',
      "</head><body>",
      '<script src="config.js"></script>',
      '<script src="mock.js"></script>',
      `<script src="${appName}"></script>`,
      "</body></html>",
    ].join("\n");
  }

  it("extracts the hashed app bundle from realistic stamped HTML", () => {
    expect(bundleRefFromHtml(stampedHtml(`app.${NEW}.js`))).toBe(`app.${NEW}.js`);
  });

  it("extracts the bare app.js from un-hashed (local/public) HTML", () => {
    expect(bundleRefFromHtml(stampedHtml("app.js"))).toBe("app.js");
  });

  it("returns null when no app bundle is referenced", () => {
    const html = [
      "<!doctype html><html><head></head><body>",
      '<script src="config.js"></script>',
      '<script src="mock.js"></script>',
      "</body></html>",
    ].join("\n");
    expect(bundleRefFromHtml(html)).toBeNull();
  });

  it("ignores config.js / mock.js / styles.css (only matches the app.* bundle)", () => {
    // config.js + mock.js appear BEFORE app.<hash>.js — the matcher must skip
    // them and not return "config.js".
    const ref = bundleRefFromHtml(stampedHtml(`app.${NEW}.js`));
    expect(ref).not.toBe("config.js");
    expect(ref).not.toBe("mock.js");
    expect(ref).not.toBe("styles.css");
    expect(ref).toBe(`app.${NEW}.js`);
  });

  it("returns null for empty / non-HTML input", () => {
    expect(bundleRefFromHtml("")).toBeNull();
  });
});

describe("isStale", () => {
  it.each([
    {
      name: "old running bundle vs newer live ref → stale",
      self: `https://app.shipaso.com/app.${OLD}.js`,
      live: `app.${NEW}.js`,
      expected: true,
    },
    {
      name: "same hashed name on both sides → not stale (no deploy)",
      self: `https://app.shipaso.com/app.${NEW}.js`,
      live: `app.${NEW}.js`,
      expected: false,
    },
    {
      name: "origin/relative independence: compares basenames only → stale",
      self: `https://app.shipaso.com/app.${OLD}.js`,
      live: `app.${NEW}.js`,
      expected: true,
    },
  ])("$name", ({ self, live, expected }) => {
    expect(isStale(self, live)).toBe(expected);
  });

  it("empty selfScriptUrl (unknown self) → not stale (never nag on uncertainty)", () => {
    expect(isStale("", `app.${NEW}.js`)).toBe(false);
  });

  it("null liveBundleRef (fetch/parse failed) → not stale (never nag on uncertainty)", () => {
    expect(isStale(`https://app.shipaso.com/app.${OLD}.js`, null)).toBe(false);
  });

  it("running bundle is bare app.js (local/E2E) → not stale (feature dormant in dev)", () => {
    expect(isStale("http://127.0.0.1:8793/app.js", `app.${NEW}.js`)).toBe(false);
  });

  it("self URL with query/hash still compares basenames cleanly", () => {
    expect(isStale(`https://app.shipaso.com/app.${OLD}.js?v=1`, `app.${NEW}.js`)).toBe(true);
  });
});

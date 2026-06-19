import { describe, it, expect } from "vitest";
// The pure logic lives in plain ESM (scripts/stampAssets.mjs) so the Node-20 CI
// runner can import it without a TS loader — importing a .ts there broke the
// first deploy. The spec imports the SAME .mjs the build script uses (typed via
// scripts/stampAssets.d.ts).
import { contentHash, stampAssets, type AssetFile } from "../../scripts/stampAssets.mjs";

/**
 * Cache-busting for the static Pages dashboard. The source `public/` ships
 * un-hashed filenames (app.js, mock.js, …) with no build step, so a returning
 * browser keeps the OLD bundle after a deploy — that stale bundle is what made
 * a "Mangia" preview audit the wrong app (#40). `stampAssets` content-hashes
 * each referenced asset, renames it to `name.<hash>.ext`, and rewrites the HTML
 * references so a deploy always invalidates the client bundle.
 */

const HTML = [
  '<!doctype html><html><head>',
  '<link rel="stylesheet" href="styles.css" />',
  "</head><body>",
  '<script src="config.js"></script>',
  '<script src="mock.js"></script>',
  '<script src="app.js"></script>',
  "</body></html>",
].join("\n");

function asset(name: string, body: string): AssetFile {
  return { name, body: new TextEncoder().encode(body) };
}

describe("contentHash", () => {
  it("is deterministic for identical bytes", () => {
    const a = contentHash(new TextEncoder().encode("hello world"));
    const b = contentHash(new TextEncoder().encode("hello world"));
    expect(a).toBe(b);
  });

  it("changes when a single byte changes", () => {
    const a = contentHash(new TextEncoder().encode("app v1"));
    const b = contentHash(new TextEncoder().encode("app v2"));
    expect(a).not.toBe(b);
  });

  it("is a short, url-safe hex slug", () => {
    const h = contentHash(new TextEncoder().encode("anything"));
    expect(h).toMatch(/^[0-9a-f]{8,}$/);
  });
});

describe("stampAssets", () => {
  const assets = [
    asset("styles.css", "body{}"),
    asset("config.js", "window.STORE_OPS={}"),
    asset("mock.js", "/* mock */"),
    asset("app.js", "/* app */"),
  ];

  it("renames every referenced asset to name.<hash>.ext", () => {
    const out = stampAssets(HTML, assets);
    for (const f of out.assets) {
      expect(f.name).toMatch(/^[a-z]+\.[0-9a-f]{8,}\.(js|css)$/);
    }
    // one stamped file per input asset
    expect(out.assets).toHaveLength(assets.length);
  });

  it("rewrites the HTML references to the hashed names", () => {
    const out = stampAssets(HTML, assets);
    // No bare references remain.
    expect(out.html).not.toMatch(/href="styles\.css"/);
    expect(out.html).not.toMatch(/src="app\.js"/);
    // Each hashed name appears exactly where its bare name was.
    for (const f of out.assets) {
      expect(out.html).toContain(f.name);
    }
  });

  it("preserves load order (config → mock → app)", () => {
    const out = stampAssets(HTML, assets);
    const cfg = out.assets.find((f) => f.name.startsWith("config."))!.name;
    const mock = out.assets.find((f) => f.name.startsWith("mock."))!.name;
    const app = out.assets.find((f) => f.name.startsWith("app."))!.name;
    expect(out.html.indexOf(cfg)).toBeLessThan(out.html.indexOf(mock));
    expect(out.html.indexOf(mock)).toBeLessThan(out.html.indexOf(app));
  });

  it("carries the original bytes onto the stamped file unchanged", () => {
    const out = stampAssets(HTML, assets);
    const app = out.assets.find((f) => f.name.startsWith("app."))!;
    expect(new TextDecoder().decode(app.body)).toBe("/* app */");
  });

  it("a changed asset body yields a different stamped name (cache-bust)", () => {
    const v1 = stampAssets(HTML, assets);
    const changed = assets.map((a) =>
      a.name === "app.js" ? asset("app.js", "/* app v2 */") : a,
    );
    const v2 = stampAssets(HTML, changed);
    const app1 = v1.assets.find((f) => f.name.startsWith("app."))!.name;
    const app2 = v2.assets.find((f) => f.name.startsWith("app."))!.name;
    expect(app1).not.toBe(app2);
    // unchanged assets keep a stable hash across deploys
    const css1 = v1.assets.find((f) => f.name.startsWith("styles."))!.name;
    const css2 = v2.assets.find((f) => f.name.startsWith("styles."))!.name;
    expect(css1).toBe(css2);
  });

  it("ignores assets not referenced in the HTML", () => {
    const withExtra = [...assets, asset("unused.js", "/* nobody imports me */")];
    const out = stampAssets(HTML, withExtra);
    // unused.js is not in the HTML, so it is not stamped/emitted
    expect(out.assets.find((f) => f.name.startsWith("unused."))).toBeUndefined();
    expect(out.assets).toHaveLength(assets.length);
  });

  it("leaves data: and remote (https) references untouched", () => {
    const html = [
      '<link rel="icon" href="data:image/svg+xml,%3Csvg/%3E" />',
      '<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet" />',
      '<script src="app.js"></script>',
    ].join("\n");
    const out = stampAssets(html, [asset("app.js", "/* app */")]);
    expect(out.html).toContain("data:image/svg+xml");
    expect(out.html).toContain("https://fonts.googleapis.com/css2?family=X");
  });
});

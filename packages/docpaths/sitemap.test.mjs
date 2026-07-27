import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The sitemap must list exactly the pages that exist.
 *
 * Both directions matter, for different reasons:
 *   • a page NOT listed is invisible to the crawlers the sitemap exists to
 *     serve — the whole point of the file,
 *   • a listed page that does NOT exist sends every crawler to a 404, which is
 *     a wrong statement about our own site.
 *
 * The site is four hand-written pages, so the sitemap is hand-maintained; this
 * test is what makes that safe.
 */
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const landing = join(repoRoot, "docs/landing");
const sitemap = readFileSync(join(landing, "sitemap.xml"), "utf8");

/** Page paths the sitemap claims, as filenames ("" for the root). */
const listed = new Set(
  [...sitemap.matchAll(/<loc>https:\/\/shipaso\.com\/([^<]*)<\/loc>/g)].map((m) => m[1]),
);

/** HTML pages actually present, excluding 404 (deliberately noindex). */
const present = readdirSync(landing).filter(
  (f) => f.endsWith(".html") && f !== "404.html" && f !== "index.html",
);

test("every HTML page on disk is listed in the sitemap", () => {
  for (const page of present) {
    assert.ok(listed.has(page), `${page} exists but is missing from sitemap.xml`);
  }
});

test("the root is listed", () => {
  assert.ok(listed.has(""), "sitemap.xml must list https://shipaso.com/");
});

test("every listed page actually exists (no crawler sent to a 404)", () => {
  const onDisk = new Set(readdirSync(landing));
  for (const entry of listed) {
    if (entry === "") continue; // the root maps to index.html
    assert.ok(onDisk.has(entry), `sitemap.xml lists ${entry}, which is not in docs/landing/`);
  }
});

/**
 * 404.html carries <meta name="robots" content="noindex">, so listing it would
 * contradict the page itself.
 */
test("the 404 page is not advertised", () => {
  assert.ok(!listed.has("404.html"), "404.html must not appear in the sitemap");
  const notFound = readFileSync(join(landing, "404.html"), "utf8");
  assert.match(notFound, /name="robots"\s+content="noindex"/);
});

/**
 * The namespace has to be sitemaps.org — PLURAL. I typed the singular first and
 * it parses as perfectly valid XML, so nothing catches it locally; Google
 * simply rejects the sitemap. A silent no-op is the worst failure mode for a
 * file whose entire job is being read by someone else's crawler.
 */
test("the sitemap uses the canonical sitemaps.org namespace", () => {
  assert.match(
    sitemap,
    /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/,
    "namespace must be sitemaps.org (plural) or crawlers reject the file",
  );
});

/** robots.txt promises the sitemap; that promise must resolve. */
test("robots.txt points at a sitemap that exists", () => {
  const robots = readFileSync(join(landing, "robots.txt"), "utf8");
  const m = robots.match(/^Sitemap:\s*https:\/\/shipaso\.com\/(\S+)/m);
  assert.ok(m, "robots.txt should declare a Sitemap:");
  assert.ok(
    readdirSync(landing).includes(m[1]),
    `robots.txt points at ${m[1]}, which is not in docs/landing/`,
  );
});

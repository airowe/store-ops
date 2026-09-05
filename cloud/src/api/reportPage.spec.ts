import { describe, expect, it } from "vitest";
import { describeReport, renderReportErrorPage, renderReportPage, reportPagePath } from "./reportPage.js";
import type { AppPreview } from "../engine/preview.js";
import type { AuditCard } from "../engine/auditCard.js";

/**
 * The server-rendered report page (loop 2, criteria 1–3). Pure renderer.
 */

const FULL: AppPreview = {
  appName: "Acme — Habit Tracker",
  auditGrade: "B",
  leadKeyword: "habit tracker",
  leadRank: 7,
  keywordsChecked: 10,
  inTop10: 2,
  sample: [
    { keyword: "habit tracker", rank: 7 },
    { keyword: "streaks", rank: 41 },
    { keyword: "productivity", rank: null },
  ],
  breakdown: [
    { field: "title", max: 25, score: 20, state: "measured", note: "9/30 chars used." },
    { field: "subtitle", max: 20, score: 8, state: "measured", note: "Generic — no target keyword." },
    { field: "screenshots", max: 25, score: null, state: "unreadable", note: "Not visible on the public page." },
    { field: "description", max: 15, score: 12, state: "measured", note: "Leads with the benefit." },
  ],
  score: 67,
  fieldsMeasured: 3,
  fieldsTotal: 4,
};

const OPTS = { canonicalOrigin: "https://shipaso.com" };
const page = (p: AppPreview, country = "us") =>
  renderReportPage({ appId: "123456789", bundleId: "com.acme.app", country, preview: p }, OPTS);

describe("reportPagePath", () => {
  it("omits the default country and encodes the rest", () => {
    expect(reportPagePath("123", "us")).toBe("/r/123");
    expect(reportPagePath("123", "US")).toBe("/r/123");
    expect(reportPagePath("123", "gb")).toBe("/r/123?country=gb");
    expect(reportPagePath("../x", "us")).toBe("/r/..%2Fx");
  });
});

describe("the page carries what a crawler and an unfurler need (criterion 1)", () => {
  const html = page(FULL);

  it("has a per-app title, description, canonical, and Open Graph tags", () => {
    expect(html).toContain("<title>Acme — Habit Tracker — ASO report | ShipASO</title>");
    expect(html).toMatch(/<meta name="description" content="Acme — Habit Tracker ASO report: scores 67\/100 on 3 of 4 readable listing fields; ranks #7 for &quot;habit tracker&quot;; 2 of 10 checked keywords in the App Store top 10\./);
    expect(html).toContain('<link rel="canonical" href="https://shipaso.com/r/123456789">');
    expect(html).toContain('<meta property="og:url" content="https://shipaso.com/r/123456789">');
    expect(html).toContain('<meta property="og:title" content="Acme — Habit Tracker — ASO report | ShipASO">');
    expect(html).toContain('content="https://shipaso.com/og/card.png"');
  });

  it("renders the breakdown and the measured ranks in the markup itself", () => {
    expect(html).toContain("9/30 chars used.");
    expect(html).toContain("20/25");
    expect(html).toContain("habit tracker");
    expect(html).toContain("#7");
    expect(html).toContain("#41");
  });

  it("respects the canonical origin option, with a trailing slash tolerated", () => {
    const h = renderReportPage(
      { appId: "1", bundleId: "b", country: "gb", preview: FULL },
      { canonicalOrigin: "https://api.shipaso.com/" },
    );
    expect(h).toContain('href="https://api.shipaso.com/r/1?country=gb"');
  });
});

describe("measured-or-nothing in the markup (criterion 2)", () => {
  const NULLS: AppPreview = {
    ...FULL,
    appName: "",
    auditGrade: null,
    leadKeyword: null,
    leadRank: null,
    keywordsChecked: 0,
    inTop10: 0,
    sample: [{ keyword: "anything", rank: null }],
    breakdown: [{ field: "screenshots", max: 25, score: null, state: "unreadable", note: "Not visible." }],
    score: null,
    fieldsMeasured: 0,
    fieldsTotal: 1,
  };

  it("never prints null, undefined, NaN, or a fabricated score", () => {
    const html = page(NULLS);
    expect(html).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
    expect(html).not.toContain("0/25");
    expect(html).not.toContain("#null");
    expect(html).toContain('<span class="num">—</span>');
    expect(html).toContain("— not in top 200");
    expect(html).toContain('<div class="fpts">—</div>');
  });

  it("builds the description only from measured clauses", () => {
    const d = describeReport(NULLS, "com.acme.app");
    expect(d).not.toMatch(/scores|ranks #|top 10/);
    expect(d).toContain("measured, per-field");
    const partial = describeReport({ ...NULLS, keywordsChecked: 5, inTop10: 0 }, "X");
    expect(partial).toContain("0 of 5 checked keywords");
    expect(partial).not.toMatch(/scores|ranks #/);
  });

  it("falls back to the bundle id as the name, never an empty title", () => {
    expect(page(NULLS)).toContain("<title>com.acme.app — ASO report | ShipASO</title>");
  });

  it("renders the thin-read caveat exactly when fewer than half the fields were readable", () => {
    expect(page({ ...FULL, fieldsMeasured: 1, fieldsTotal: 4 })).toContain("Heads up: only <b>1 of 4</b>");
    expect(page({ ...FULL, fieldsMeasured: 2, fieldsTotal: 4 })).not.toContain("Heads up");
    expect(page({ ...FULL, fieldsMeasured: 3, fieldsTotal: 4 })).not.toContain("Heads up");
  });
});

describe("untrusted text is escaped (criterion 3)", () => {
  it("neutralises script tags and quotes in the name, bundle id, notes, and keywords", () => {
    const hostile: AppPreview = {
      ...FULL,
      appName: `<script>alert("x")</script>`,
      breakdown: [{ field: "title", max: 25, score: 20, state: "measured", note: `"><img src=x onerror=alert(1)>` }],
      sample: [{ keyword: "<b>bold</b>", rank: 3 }],
    };
    const html = renderReportPage({ appId: "1", bundleId: "</title><script>", country: "us", preview: hostile }, OPTS);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    // the description meta attribute cannot be broken out of
    expect(html).not.toMatch(/content="[^"]*"><img/);
  });
});

describe("the audit card section (#437)", () => {
  const card: AuditCard = {
    identity: {
      name: "Acme — Habit Tracker",
      developer: { state: "measured", value: "Acme Labs", asOf: "2026-09-05T12:00:00.000Z", source: "App Store" },
      iconUrl: "https://example.com/icon.png",
      released: { state: "measured", value: "2024-03-01T00:00:00Z", asOf: "2026-09-05T12:00:00.000Z", source: "App Store" },
      lastUpdated: { state: "unavailable", reason: "Last-update date not readable from the public listing." },
    },
    chips: {
      category: { state: "measured", value: "Productivity", asOf: "2026-09-05T12:00:00.000Z", source: "App Store" },
      price: { state: "measured", value: "Free", asOf: "2026-09-05T12:00:00.000Z", source: "App Store" },
    },
    hero: {
      downloads: { state: "unavailable", reason: "Apple reports downloads only to the app's own developer." },
      proceeds: { state: "pending", reason: "Requested — Apple takes 1–2 days to generate it." },
    },
    tiles: {
      rating: { state: "measured", value: { avg: 4.6, count: 1283 }, asOf: "2026-09-05T12:00:00.000Z", source: "App Store" },
      size: { state: "absent" },
    },
    aso: {
      headline: "Found for 2 of 3 keywords tested. Best rank #7 for “habit tracker”.",
      score: { state: "measured", value: 67, asOf: "2026-09-05T12:00:00.000Z", source: "ShipASO listing audit" },
      grade: "B",
      rankSummary: {
        state: "measured",
        value: { tested: 3, found: 2, best: { keyword: "habit tracker", rank: 7 } },
        asOf: "2026-09-05T12:00:00.000Z",
        source: "ShipASO rank check · US · top 200",
      },
      topFindings: [
        { id: "subtitle_generic", surface: "subtitle", severity: "warn", impact: "ranking", title: "Subtitle carries no target keyword", detail: "d", fix: "Lead with “habit tracker”.", evidence: "e" },
      ],
    },
    screenshots: ["https://example.com/1.png", "https://example.com/2.png"],
    measuredAt: "2026-09-05T12:00:00.000Z",
    country: "US",
  };
  const withCard = () => renderReportPage({ appId: "123456789", bundleId: "com.acme.app", country: "us", preview: FULL, card }, OPTS);

  it("renders the card with the finding as its headline and the top fix", () => {
    const html = withCard();
    expect(html).toContain('id="card"');
    expect(html).toContain("Found for 2 of 3 keywords tested. Best rank #7 for “habit tracker”.");
    expect(html).toContain("Lead with “habit tracker”.");
    expect(html).toContain("Acme Labs");
    expect(html).toContain("4.6");
    expect(html).toContain("1,283");
  });

  it("renders an unavailable hero tile as — with its reason, never a number", () => {
    const html = withCard();
    expect(html).toContain("Apple reports downloads only to the app&#39;s own developer.");
    expect(html).not.toMatch(/Downloads[^<]*<[^>]*>\s*\d/);
  });

  it("renders a pending tile as requested, distinct from zero", () => {
    const html = withCard();
    expect(html).toContain("Requested — Apple takes 1–2 days to generate it.");
    expect(html).not.toContain(">0<");
  });

  it("renders an absent tile as — with no reason text", () => {
    expect(withCard()).toMatch(/Size<\/div><div class="cv none">—<\/div>/);
  });

  it("stamps the card with the measurement date and country", () => {
    const html = withCard();
    expect(html).toContain("Measured 2026-09-05");
    expect(html).toContain("· US ·");
  });

  it("renders no card section when the data has none", () => {
    expect(page(FULL)).not.toContain('id="card"');
  });

  it("escapes hostile card text", () => {
    const hostile: AuditCard = { ...card, aso: { ...card.aso, headline: `<script>alert(1)</script>` } };
    const html = renderReportPage({ appId: "1", bundleId: "b", country: "us", preview: FULL, card: hostile }, OPTS);
    expect(html).not.toContain("<script>alert(1)");
  });
});

describe("error pages (criterion 4)", () => {
  it("carry the message, the status, and a noindex", () => {
    const html = renderReportErrorPage(503, "Couldn’t reach the App Store just now — please try again in a moment.");
    expect(html).toContain("503");
    expect(html).toContain("please try again in a moment");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(renderReportErrorPage(400, "appId must be a numeric App Store id")).toContain("numeric App Store id");
  });
});

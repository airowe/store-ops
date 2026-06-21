import { describe, expect, it } from "vitest";
import {
  type AuditFindingsInput,
  type Finding,
  type FindingImpact,
  type FindingSeverity,
  auditFindings,
  scoreFinding,
  summarizeFindings,
} from "./auditFindings.js";
import type { AscSnapshot } from "./ascRead.js";
import type { Audit } from "./agent.js";
import type { ShotScore, Grade } from "./screenshotScore.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function shot(over: Partial<ShotScore> = {}): ShotScore {
  return {
    app: "demo",
    iphoneCount: 6,
    ipadCount: 2,
    score: 90,
    grade: "A",
    findings: [],
    aspectHint: "tall phone",
    screenshotUrls: [],
    ipadScreenshotUrls: [],
    ...over,
  };
}

function audit(screenshots: ShotScore | null = shot()): Audit {
  return { app: "demo", bundleId: "com.demo.app", screenshots, liveName: "Demo" };
}

/** snapshot.locales is typed LiveListingCopy[] but the reader returns rows that
 *  carry a `locale` tag (LocaleListingCopy). This helper builds those rows and
 *  casts to the snapshot's array type so fixtures read naturally. */
type LocaleRow = { locale: string; name?: string; subtitle?: string; keywords?: string };
function locales(rows: LocaleRow[]): AscSnapshot["locales"] {
  return rows as unknown as AscSnapshot["locales"];
}

/** A "healthy" snapshot — every surface read, no problems → no negative findings.
 *  Used as the silent baseline; per-rule tests mutate ONE surface. */
function healthySnapshot(): AscSnapshot {
  return {
    screenshots: { iphoneScreenshots: [], ipadScreenshots: [], dataReliable: true },
    previews: { devices: [{ previewType: "APP_IPHONE_67", count: 1, urls: ["u"], assetState: ["COMPLETE"] }] },
    appInfo: {
      locales: [{ locale: "en-US", name: "Demo", privacyPolicyUrl: "https://demo.app/privacy" }],
      primaryCategory: { id: "PRODUCTIVITY", name: "Productivity" },
      secondaryCategory: { id: "UTILITIES", name: "Utilities" },
    },
    versionState: {
      current: { id: "V1", versionString: "1.2.0", appStoreState: "READY_FOR_SALE" },
      all: [
        { id: "V1", versionString: "1.2.0", appStoreState: "READY_FOR_SALE" },
        { id: "V2", versionString: "1.3.0", appStoreState: "PREPARE_FOR_SUBMISSION" },
      ],
    },
    pricing: {
      iaps: [{ id: "iap1", name: "Pro", productId: "p", state: "ACTIVE", promoted: true } as never],
      pricing: { priceTier: "0.00 USD", baseTerritoryPrice: 0, baseTerritory: "USA" },
    },
    ageRating: { ageRating: "FOUR_PLUS" },
    customProductPages: { pages: [{ id: "c1", name: "Holiday", state: "VISIBLE" }] },
    locales: locales([
      { locale: "en-US", name: "Demo", subtitle: "Do it", keywords: "a,b,c" },
      { locale: "fr-FR", name: "Demo", subtitle: "Fais-le", keywords: "d,e,f" },
    ]),
    errors: [],
  };
}

function input(over: Partial<AuditFindingsInput> = {}): AuditFindingsInput {
  return {
    snapshot: healthySnapshot(),
    audit: audit(),
    ranks: [],
    appName: "Demo",
    hasAscKey: true,
    ...over,
  };
}

/** Run the engine and return the set of finding ids that fired. */
function ids(input: AuditFindingsInput): string[] {
  return auditFindings(input).map((f) => f.id);
}

function byId(findings: Finding[], id: string): Finding | undefined {
  return findings.find((f) => f.id === id);
}

// ── Baseline: the healthy snapshot fires only context/good findings ──────────

describe("healthy baseline", () => {
  it("emits no negative (critical/warn) findings", () => {
    const findings = auditFindings(input());
    const negatives = findings.filter((f) => f.severity === "critical" || f.severity === "warn");
    expect(negatives).toEqual([]);
  });
});

// ── Table-driven: each rule fires on its trigger, stays silent otherwise ─────

type RuleCase = {
  id: string;
  severity: FindingSeverity;
  impact: FindingImpact;
  surface: string;
  /** mutate a healthy input so THIS rule fires. */
  trigger: (base: AuditFindingsInput) => AuditFindingsInput;
};

const RULES: RuleCase[] = [
  // screenshots
  {
    id: "screenshots_grade_low",
    severity: "critical",
    impact: "conversion",
    surface: "screenshots",
    trigger: (b) => ({ ...b, audit: audit(shot({ grade: "F", score: 10 })) }),
  },
  {
    id: "screenshots_thin",
    severity: "warn",
    impact: "conversion",
    surface: "screenshots",
    trigger: (b) => ({ ...b, audit: audit(shot({ iphoneCount: 2 })) }),
  },
  {
    id: "screenshots_no_ipad",
    severity: "info",
    impact: "conversion",
    surface: "screenshots",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.screenshots = {
        iphoneScreenshots: [],
        ipadScreenshots: [{ device: "APP_IPAD_PRO_129", count: 0, screenshots: [] }],
        dataReliable: true,
      };
      return { ...b, snapshot: snap, audit: audit(shot({ ipadCount: 0 })) };
    },
  },
  {
    id: "screenshots_unknown",
    severity: "info",
    impact: "conversion",
    surface: "screenshots",
    trigger: (b) => ({ ...b, audit: audit(shot({ grade: "?" as Grade, score: null })) }),
  },
  // previews
  {
    id: "preview_missing",
    severity: "warn",
    impact: "conversion",
    surface: "previews",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.previews = { devices: [] };
      return { ...b, snapshot: snap };
    },
  },
  {
    id: "preview_thin_coverage",
    severity: "info",
    impact: "conversion",
    surface: "previews",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.previews = {
        devices: [{ previewType: "APP_IPHONE_61", count: 1, urls: ["u"], assetState: ["COMPLETE"] }],
      };
      return { ...b, snapshot: snap };
    },
  },
  {
    id: "preview_error_state",
    severity: "warn",
    impact: "conversion",
    surface: "previews",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.previews = {
        devices: [{ previewType: "APP_IPHONE_67", count: 1, urls: ["u"], assetState: ["PROCESSING"] }],
      };
      return { ...b, snapshot: snap };
    },
  },
  // appInfo
  {
    id: "privacy_policy_missing",
    severity: "critical",
    impact: "completeness",
    surface: "appInfo",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.appInfo!.locales = [{ locale: "en-US", name: "Demo" }];
      return { ...b, snapshot: snap };
    },
  },
  {
    id: "secondary_category_missing",
    severity: "warn",
    impact: "ranking",
    surface: "appInfo",
    trigger: (b) => {
      const snap = healthySnapshot();
      delete snap.appInfo!.secondaryCategory;
      return { ...b, snapshot: snap };
    },
  },
  {
    id: "primary_category_context",
    severity: "info",
    impact: "ranking",
    surface: "appInfo",
    // fires whenever appInfo read (healthy already triggers it)
    trigger: (b) => b,
  },
  {
    id: "appinfo_name_mismatch",
    severity: "info",
    impact: "completeness",
    surface: "appInfo",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.appInfo!.locales = [
        { locale: "en-US", name: "Demo Listing", privacyPolicyUrl: "https://demo.app/privacy" },
      ];
      snap.locales = locales([{ locale: "en-US", name: "Demo Version", subtitle: "x", keywords: "y" }]);
      return { ...b, snapshot: snap };
    },
  },
  // versionState
  {
    id: "version_in_review",
    severity: "info",
    impact: "completeness",
    surface: "versionState",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.versionState!.current.appStoreState = "IN_REVIEW";
      return { ...b, snapshot: snap };
    },
  },
  {
    id: "version_no_draft",
    severity: "info",
    impact: "completeness",
    surface: "versionState",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.versionState!.all = [
        { id: "V1", versionString: "1.2.0", appStoreState: "READY_FOR_SALE" },
      ];
      return { ...b, snapshot: snap };
    },
  },
  {
    id: "version_context",
    severity: "info",
    impact: "completeness",
    surface: "versionState",
    trigger: (b) => b, // always (if read)
  },
  // pricing
  {
    id: "iap_not_promoted",
    severity: "info",
    impact: "conversion",
    surface: "pricing",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.pricing!.iaps = [{ id: "iap1", name: "Pro", state: "ACTIVE" }];
      return { ...b, snapshot: snap };
    },
  },
  {
    id: "pricing_context",
    severity: "info",
    impact: "conversion",
    surface: "pricing",
    trigger: (b) => b, // always (if read)
  },
  // ageRating — #71-A3: an unparsed/empty rating is "unconfirmed" (info), NOT a
  // false "not declared — can block submission" warning.
  {
    id: "age_rating_unconfirmed",
    severity: "info",
    impact: "completeness",
    surface: "ageRating",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.ageRating = {};
      return { ...b, snapshot: snap };
    },
  },
  {
    id: "age_rating_context",
    severity: "info",
    impact: "completeness",
    surface: "ageRating",
    trigger: (b) => b, // declared in healthy
  },
  // customProductPages
  {
    id: "cpp_none",
    severity: "info",
    impact: "conversion",
    surface: "customProductPages",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.customProductPages = { pages: [] };
      return { ...b, snapshot: snap };
    },
  },
  {
    id: "cpp_present",
    severity: "good",
    impact: "conversion",
    surface: "customProductPages",
    trigger: (b) => b, // healthy has one page
  },
  // locales
  {
    id: "locale_single",
    severity: "warn",
    impact: "ranking",
    surface: "locales",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.locales = locales([{ locale: "en-US", name: "Demo", subtitle: "Do it", keywords: "a,b" }]);
      return { ...b, snapshot: snap };
    },
  },
  {
    id: "locale_incomplete",
    severity: "warn",
    impact: "ranking",
    surface: "locales",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.locales = locales([
        { locale: "en-US", name: "Demo", subtitle: "Do it", keywords: "a,b" },
        { locale: "fr-FR", name: "Demo", subtitle: "", keywords: "" },
      ]);
      return { ...b, snapshot: snap };
    },
  },
  // meta
  {
    id: "asc_unlock",
    severity: "info",
    impact: "completeness",
    surface: "meta",
    trigger: (b) => ({ ...b, hasAscKey: false, snapshot: undefined }),
  },
];

describe.each(RULES)("rule $id", (rule) => {
  it("fires on its trigger with the spec'd severity/impact/surface", () => {
    const findings = auditFindings(rule.trigger(input()));
    const f = byId(findings, rule.id);
    expect(f, `expected ${rule.id} to fire`).toBeDefined();
    expect(f!.severity).toBe(rule.severity);
    expect(f!.impact).toBe(rule.impact);
    expect(f!.surface).toBe(rule.surface);
    expect(f!.title.length).toBeGreaterThan(0);
    expect(f!.fix.length).toBeGreaterThan(0);
    expect(f!.detail.length).toBeGreaterThan(0);
  });
});

// Each rule that is NOT "always-on" must stay silent on the healthy baseline.
const ALWAYS_ON = new Set([
  "primary_category_context",
  "version_context",
  "pricing_context",
  "age_rating_context",
  "cpp_present",
]);

describe.each(RULES.filter((r) => !ALWAYS_ON.has(r.id)))("rule $id stays silent", (rule) => {
  it("does not fire on the healthy baseline", () => {
    expect(ids(input())).not.toContain(rule.id);
  });
});

// ── Don't over-assert: pricing + age-rating cap below critical ───────────────

describe("severity caps (the #41 trap)", () => {
  it("never emits a critical pricing finding", () => {
    const snap = healthySnapshot();
    snap.pricing!.iaps = [];
    const findings = auditFindings(input({ snapshot: snap }));
    for (const f of findings.filter((x) => x.surface === "pricing")) {
      expect(["info", "warn", "good"]).toContain(f.severity);
    }
  });
  it("age-rating findings never exceed warn", () => {
    const snap = healthySnapshot();
    snap.ageRating = {};
    const findings = auditFindings(input({ snapshot: snap }));
    for (const f of findings.filter((x) => x.surface === "ageRating")) {
      expect(["info", "warn"]).toContain(f.severity);
      expect(f.severity).not.toBe("critical");
    }
  });
});

// #71-A1: an UNKNOWN price (baseTerritoryPrice null — we couldn't read it) must
// NEVER be asserted as "paid". A free app whose price read came back null was
// being labeled "paid" — fabricated-as-measured. Unknown is "unknown", not paid.
describe("pricing label honesty (#71)", () => {
  const pricingTitle = (price: number | null): string | undefined => {
    const snap = healthySnapshot();
    snap.pricing!.iaps = [];
    snap.pricing!.pricing = { priceTier: null, baseTerritoryPrice: price, baseTerritory: "USA" };
    const f = auditFindings(input({ snapshot: snap })).find((x) => x.id === "pricing_context");
    return f?.title;
  };

  it("labels a 0 price as 'free'", () => {
    expect(pricingTitle(0)).toBe("free");
  });

  it("labels a positive price as 'paid'", () => {
    expect(pricingTitle(2.99)).toBe("paid");
  });

  it("never labels an UNKNOWN (null) price as 'paid'", () => {
    const title = pricingTitle(null);
    expect(title).not.toBe("paid");
    // Either omitted entirely, or an explicit "unknown" — never a false "paid".
    if (title !== undefined) expect(title).toMatch(/unknown/i);
  });
});

// ── Sort order ───────────────────────────────────────────────────────────────

describe("sort order", () => {
  it("orders by severity weight descending", () => {
    // Build an input that fires a critical, a warn, and infos.
    const snap = healthySnapshot();
    snap.appInfo!.locales = [{ locale: "en-US", name: "Demo" }]; // privacy crit
    snap.previews = { devices: [] }; // preview warn
    const findings = auditFindings(input({ snapshot: snap, audit: audit(shot({ grade: "F" })) }));
    const weights = findings.map((f) => scoreFinding(f.severity, f.impact));
    const sorted = [...weights].sort((a, b) => b - a);
    expect(weights).toEqual(sorted);
  });

  it("a critical completeness finding precedes a warn conversion one", () => {
    const snap = healthySnapshot();
    snap.appInfo!.locales = [{ locale: "en-US", name: "Demo" }]; // privacy_policy_missing (crit/comp)
    snap.previews = { devices: [] }; // preview_missing (warn/conv)
    const findings = auditFindings(input({ snapshot: snap }));
    const ci = findings.findIndex((f) => f.id === "privacy_policy_missing");
    const wi = findings.findIndex((f) => f.id === "preview_missing");
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(wi).toBeGreaterThanOrEqual(0);
    expect(ci).toBeLessThan(wi);
  });

  it("within equal severity, completeness/trust outranks conversion outranks ranking", () => {
    // secondary_category_missing (warn/ranking) vs preview_missing (warn/conversion)
    const snap = healthySnapshot();
    delete snap.appInfo!.secondaryCategory;
    snap.previews = { devices: [] };
    const findings = auditFindings(input({ snapshot: snap }));
    const conv = findings.findIndex((f) => f.id === "preview_missing");
    const rank = findings.findIndex((f) => f.id === "secondary_category_missing");
    expect(conv).toBeLessThan(rank);
  });

  it("ties broken stably by id", () => {
    // Two warn/ranking findings: locale_single + secondary_category_missing.
    const snap = healthySnapshot();
    delete snap.appInfo!.secondaryCategory;
    snap.locales = locales([{ locale: "en-US", name: "Demo", subtitle: "x", keywords: "y" }]);
    const findings = auditFindings(input({ snapshot: snap }));
    const a = findings.findIndex((f) => f.id === "locale_single");
    const b = findings.findIndex((f) => f.id === "secondary_category_missing");
    // "locale_single" < "secondary_category_missing" alphabetically
    expect(a).toBeLessThan(b);
  });
});

// ── No-key path ──────────────────────────────────────────────────────────────

describe("no-key path", () => {
  it("emits the screenshot finding (if any) + exactly one asc_unlock info", () => {
    const findings = auditFindings(
      input({ hasAscKey: false, snapshot: undefined, audit: audit(shot({ grade: "?" as Grade, score: null })) }),
    );
    const unlocks = findings.filter((f) => f.id === "asc_unlock");
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]!.severity).toBe("info");
    expect(unlocks[0]!.fix).toContain("Connect App Store Connect");
    expect(findings.map((f) => f.id)).toContain("screenshots_unknown");
    // no ASC-only findings leak through without a snapshot
    expect(findings.map((f) => f.id)).not.toContain("privacy_policy_missing");
  });

  it("with a key, no asc_unlock finding", () => {
    expect(ids(input({ hasAscKey: true }))).not.toContain("asc_unlock");
  });
});

// ── Graceful degradation ─────────────────────────────────────────────────────

describe("graceful degradation", () => {
  it("undefined snapshot → no crash, only screenshot/meta findings", () => {
    const findings = auditFindings(input({ snapshot: undefined, hasAscKey: true }));
    // no ASC-derived findings
    const ascSurfaces = ["previews", "appInfo", "versionState", "pricing", "ageRating", "customProductPages", "locales"];
    for (const f of findings) expect(ascSurfaces).not.toContain(f.surface);
  });

  it("null screenshots → no screenshot findings, no crash", () => {
    const findings = auditFindings(input({ audit: audit(null) }));
    expect(findings.filter((f) => f.surface === "screenshots")).toEqual([]);
  });

  it("an absent surface contributes no findings", () => {
    const snap = healthySnapshot();
    delete snap.previews;
    delete snap.appInfo;
    const findings = auditFindings(input({ snapshot: snap }));
    expect(findings.filter((f) => f.surface === "previews")).toEqual([]);
    expect(findings.filter((f) => f.surface === "appInfo")).toEqual([]);
  });

  it("errored surfaces in snapshot.errors do not crash and stay silent by default", () => {
    const snap = healthySnapshot();
    snap.errors = [{ surface: "pricing", message: "403 denied" }];
    const findings = auditFindings(input({ snapshot: snap }));
    expect(findings.map((f) => f.id)).not.toContain("surface_read_error");
  });

  it("read-error findings appear only when includeReadErrors is on", () => {
    const snap = healthySnapshot();
    snap.errors = [{ surface: "pricing", message: "403 denied" }];
    const findings = auditFindings(input({ snapshot: snap, includeReadErrors: true }));
    const err = byId(findings, "surface_read_error");
    expect(err).toBeDefined();
    expect(err!.severity).toBe("info");
    expect(err!.evidence).toBe("pricing");
  });
});

// ── scoreFinding ─────────────────────────────────────────────────────────────

describe("scoreFinding", () => {
  it("severity dominates impact", () => {
    // a critical/ranking always outweighs a warn/completeness
    expect(scoreFinding("critical", "ranking")).toBeGreaterThan(scoreFinding("warn", "completeness"));
    expect(scoreFinding("warn", "ranking")).toBeGreaterThan(scoreFinding("info", "completeness"));
    expect(scoreFinding("info", "ranking")).toBeGreaterThan(scoreFinding("good", "completeness"));
  });
  it("within a severity, completeness/trust > conversion > ranking", () => {
    expect(scoreFinding("warn", "completeness")).toBeGreaterThan(scoreFinding("warn", "conversion"));
    expect(scoreFinding("warn", "trust")).toBeGreaterThan(scoreFinding("warn", "conversion"));
    expect(scoreFinding("warn", "conversion")).toBeGreaterThan(scoreFinding("warn", "ranking"));
    expect(scoreFinding("warn", "completeness")).toBe(scoreFinding("warn", "trust"));
  });
});

// ── summarizeFindings ────────────────────────────────────────────────────────

describe("summarizeFindings", () => {
  it("counts each severity and total", () => {
    const findings: Finding[] = [
      { id: "a", surface: "s", severity: "critical", impact: "completeness", title: "t", detail: "d", fix: "f" },
      { id: "b", surface: "s", severity: "warn", impact: "ranking", title: "t", detail: "d", fix: "f" },
      { id: "c", surface: "s", severity: "info", impact: "conversion", title: "t", detail: "d", fix: "f" },
      { id: "d", surface: "s", severity: "good", impact: "conversion", title: "t", detail: "d", fix: "f" },
    ];
    expect(summarizeFindings(findings)).toEqual({
      critical: 1,
      warn: 1,
      info: 1,
      good: 1,
      total: 4,
      topImpact: "completeness",
      label: "2 fixes available · 1 critical",
    });
  });
  it("empty findings → zeroed counts and null topImpact", () => {
    expect(summarizeFindings([])).toEqual({
      critical: 0,
      warn: 0,
      info: 0,
      good: 0,
      total: 0,
      topImpact: null,
      label: "No fixes found",
    });
  });
  it("topImpact follows the highest-weighted finding", () => {
    const snap = healthySnapshot();
    snap.appInfo!.locales = [{ locale: "en-US", name: "Demo" }]; // privacy crit/completeness
    const summary = summarizeFindings(auditFindings(input({ snapshot: snap })));
    expect(summary.topImpact).toBe("completeness");
    expect(summary.critical).toBe(1);
  });
});

// ── summarizeFindings.label (PRD #45 — mock/production parity) ────────────────

describe("summarizeFindings label", () => {
  const f = (severity: FindingSeverity): Finding => ({
    id: "x",
    surface: "s",
    severity,
    impact: "conversion",
    title: "t",
    detail: "d",
    fix: "fx",
  });

  it("counts critical + warn as fixes and appends the critical count", () => {
    expect(summarizeFindings([f("critical"), f("warn"), f("warn")]).label).toBe(
      "3 fixes available · 1 critical",
    );
  });

  it("uses the singular 'fix' for a single actionable finding", () => {
    expect(summarizeFindings([f("warn")]).label).toBe("1 fix available");
  });

  it("does NOT append a critical clause when there are no criticals", () => {
    expect(summarizeFindings([f("warn"), f("warn")]).label).toBe("2 fixes available");
  });

  it("falls back to 'No fixes found' for an all-info/good set (info/good are not fixes)", () => {
    expect(summarizeFindings([f("info"), f("good")]).label).toBe("No fixes found");
  });

  it("falls back to 'No fixes found' for an empty array", () => {
    expect(summarizeFindings([]).label).toBe("No fixes found");
  });

  it("counts critical-only as a fix and pluralizes both clauses", () => {
    expect(summarizeFindings([f("critical"), f("critical")]).label).toBe(
      "2 fixes available · 2 critical",
    );
  });

  it("is deterministic — same input → deep-equal summary including label", () => {
    const set = [f("critical"), f("warn"), f("info")];
    expect(summarizeFindings(set)).toEqual(summarizeFindings(set));
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe("determinism", () => {
  it("same input twice → deep-equal array", () => {
    const a = auditFindings(input());
    const b = auditFindings(input());
    expect(a).toEqual(b);
  });

  it("a fully-broken app yields a stable order across runs", () => {
    const broken = (): AuditFindingsInput => {
      const snap = healthySnapshot();
      snap.appInfo!.locales = [{ locale: "en-US", name: "Demo" }];
      delete snap.appInfo!.secondaryCategory;
      snap.previews = { devices: [] };
      snap.locales = locales([{ locale: "en-US", name: "Demo", subtitle: "", keywords: "" }]);
      snap.ageRating = {};
      snap.customProductPages = { pages: [] };
      return input({ snapshot: snap, audit: audit(shot({ grade: "F", iphoneCount: 2 })) });
    };
    expect(auditFindings(broken())).toEqual(auditFindings(broken()));
  });
});

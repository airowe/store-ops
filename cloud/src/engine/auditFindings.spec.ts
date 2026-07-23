import { describe, expect, it } from "vitest";
import {
  type AuditFindingsInput,
  type Finding,
  type FindingImpact,
  type FindingSeverity,
  type SurfaceLock,
  auditFindings,
  scoreFinding,
  summarizeFindings,
  surfaceLocks,
} from "./auditFindings.js";
import type { AscSnapshot } from "./ascRead.js";
import type { Audit, StorefrontIntel } from "./agent.js";
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
    levers: [],
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
    ageRating: { declared: true, contentDescriptors: ["violenceCartoonOrFantasy"] },
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
  {
    // #68: repeats substantiated by the ASC source fileName within one device set
    id: "screenshots_duplicates",
    severity: "info",
    impact: "conversion",
    surface: "screenshots",
    trigger: (b) => {
      const snap = healthySnapshot();
      snap.screenshots = {
        iphoneScreenshots: [
          {
            device: "APP_IPHONE_67",
            count: 3,
            screenshots: [
              { id: "a", imageTemplate: "https://asc/a.png", fileName: "hero.png" },
              { id: "b", imageTemplate: "https://asc/b.png", fileName: "hero.png" },
              { id: "c", imageTemplate: "https://asc/c.png", fileName: "list.png" },
            ],
          },
        ],
        ipadScreenshots: [],
        dataReliable: true,
      };
      return { ...b, snapshot: snap };
    },
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
    id: "age_rating_declared",
    severity: "good",
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
    // #71-C: status, not a fix — the localization-expansion card carries the action.
    id: "locale_single",
    severity: "info",
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
  "age_rating_declared",
  "cpp_present",
]);

describe.each(RULES.filter((r) => !ALWAYS_ON.has(r.id)))("rule $id stays silent", (rule) => {
  it("does not fire on the healthy baseline", () => {
    expect(ids(input())).not.toContain(rule.id);
  });
});

describe("age rating declared vs unconfirmed", () => {
  it("a declared age rating emits 'declared', never the false 'not confirmed'", () => {
    const got = ids(input()); // healthySnapshot is declared
    expect(got).toContain("age_rating_declared");
    expect(got).not.toContain("age_rating_unconfirmed");
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
    // Two warn/ranking findings: locale_incomplete + secondary_category_missing.
    // (locale_single demoted to info/context in #71-C, so the tie pair changed.)
    const snap = healthySnapshot();
    delete snap.appInfo!.secondaryCategory;
    snap.locales = locales([{ locale: "en-US", name: "Demo", subtitle: "", keywords: "" }]);
    const findings = auditFindings(input({ snapshot: snap }));
    const a = findings.findIndex((f) => f.id === "locale_incomplete");
    const b = findings.findIndex((f) => f.id === "secondary_category_missing");
    // "locale_incomplete" < "secondary_category_missing" alphabetically
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

// ── surfaceLocks (#61): per-surface "unlock to see + improve" data contract ───
//
// A keyed run can READ every surface ⇒ locks nothing. A no-key run is blind to
// the App Store Connect-only surfaces, so each becomes an honest lock that frames
// OPPORTUNITY (connect to read + improve), never a deficiency. The engine owns the
// canonical blind-spot list + copy; the UI never re-derives "is this readable".
describe("surfaceLocks", () => {
  // The canonical no-key blind-spots (the surfaces public iTunes can't expose).
  const CANONICAL_SURFACES: SurfaceLock["surface"][] = [
    "subtitle",
    "keywords",
    "screenshots",
    "previews",
    "privacy",
    "category",
    "locales",
  ];

  it("returns [] on a keyed run (nothing is unreadable)", () => {
    expect(surfaceLocks(input({ hasAscKey: true }))).toEqual([]);
  });

  it("returns [] on a keyed run even with no snapshot", () => {
    expect(surfaceLocks(input({ hasAscKey: true, snapshot: undefined }))).toEqual([]);
  });

  it("returns exactly the canonical blind-spot surfaces on a no-key run", () => {
    const locks = surfaceLocks(input({ hasAscKey: false, snapshot: undefined }));
    expect(locks.map((l) => l.surface)).toEqual(CANONICAL_SURFACES);
  });

  describe.each(CANONICAL_SURFACES)("lock for surface %s", (surface) => {
    const lock = (): SurfaceLock => {
      const locks = surfaceLocks(input({ hasAscKey: false, snapshot: undefined }));
      const found = locks.find((l) => l.surface === surface);
      expect(found, `expected a lock for ${surface}`).toBeDefined();
      return found!;
    };

    it("carries a non-empty label + unlockCopy", () => {
      const l = lock();
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.unlockCopy.length).toBeGreaterThan(0);
    });

    // HONESTY (the §6 CI invariant): a lock means "we can't SEE this", never a
    // deficiency. No false "0/30", no "empty/missing/bad", no loss/urgency framing.
    const FORBIDDEN = [/\b0\/(30|100)\b/, /empty|missing|bad|costing you|losing|urgent/i];
    it("never asserts a deficiency or urgency in label/unlockCopy", () => {
      const l = lock();
      for (const pattern of FORBIDDEN) {
        expect(l.label, `label leaks a forbidden phrase: ${pattern}`).not.toMatch(pattern);
        expect(l.unlockCopy, `unlockCopy leaks a forbidden phrase: ${pattern}`).not.toMatch(pattern);
      }
    });

    // OPPORTUNITY frame: the unlock copy reads as "connect to read + improve".
    it("frames opportunity (connect to read/unlock + improve)", () => {
      const l = lock();
      expect(l.unlockCopy).toMatch(/connect|unlock|read|see/i);
    });

    // CAPABILITY frame: the label states a visibility gap, not a measured fact.
    it("states a capability gap (can't see/read without access)", () => {
      const l = lock();
      expect(l.label).toMatch(/can.?t see|can.?t read|without access|unseen|not visible/i);
    });
  });

  it("is deterministic — same input → deep-equal output", () => {
    const a = surfaceLocks(input({ hasAscKey: false, snapshot: undefined }));
    const b = surfaceLocks(input({ hasAscKey: false, snapshot: undefined }));
    expect(a).toEqual(b);
  });

  it("ignores any snapshot on a no-key run (the gap is keyed-ness, not the data)", () => {
    // hasAscKey:false is the single source of truth — a stray snapshot does not
    // unlock surfaces (mirrors how asc_unlock keys off hasAscKey alone).
    const withSnap = surfaceLocks(input({ hasAscKey: false, snapshot: healthySnapshot() }));
    const noSnap = surfaceLocks(input({ hasAscKey: false, snapshot: undefined }));
    expect(withSnap).toEqual(noSnap);
  });
});

// ── reviews surface (#95) ────────────────────────────────────────────────────

import type { ReviewSentiment, Topic } from "./reviewSentiment.js";

function topic(over: Partial<Topic> & { topic: string }): Topic {
  return { topic: over.topic, count: over.count ?? 3, sentiment: over.sentiment ?? "mixed", sampleQuotes: over.sampleQuotes ?? ["a quote"] };
}

describe("reviews surface (#95)", () => {
  it("emits ZERO 'reviews' findings and does not throw when reviews are absent", () => {
    const findings = auditFindings(input({ reviews: undefined }));
    expect(findings.filter((f) => f.surface === "reviews")).toEqual([]);
  });

  it("n<20 emits an honest low-sample finding and presents NO confident numeric score", () => {
    const reviews: ReviewSentiment = {
      n: 7,
      score: null,
      confidence: "low",
      label: "too few reviews to summarize reliably",
      note: "too few reviews to summarize reliably (n=7)",
      topics: [],
    };
    const findings = auditFindings(input({ reviews }));
    const rv = findings.filter((f) => f.surface === "reviews");
    expect(rv.length).toBe(1);
    expect(rv[0]?.id).toBe("reviews_low_sample");
    // honest: carries the sample size, never a fabricated score.
    expect(rv[0]?.evidence).toContain("n=7");
    expect(rv.some((f) => /\b\d{2,3}%\b/.test(f.detail))).toBe(false);
    // the low-signal reviews surface NEVER emits a critical.
    expect(rv.every((f) => f.severity !== "critical")).toBe(true);
  });

  it("n>=20 with >=3 topics emits a reviews finding surfacing REAL topics, never critical", () => {
    const reviews: ReviewSentiment = {
      n: 48,
      score: 72,
      confidence: "ok",
      label: "mostly positive",
      topics: [
        topic({ topic: "sync", count: 9, sentiment: "negative" }),
        topic({ topic: "design", count: 6, sentiment: "positive" }),
        topic({ topic: "pricing", count: 4, sentiment: "mixed" }),
      ],
    };
    const findings = auditFindings(input({ reviews }));
    const rv = findings.filter((f) => f.surface === "reviews");
    expect(rv.length).toBeGreaterThanOrEqual(1);
    // surfaces real observed topics in the copy.
    const blob = rv.map((f) => `${f.title} ${f.detail} ${f.evidence ?? ""}`).join(" ");
    expect(blob).toContain("sync");
    expect(rv.every((f) => f.severity !== "critical")).toBe(true);
  });
});

// ── ratings surface (storefront-intel PRD 01) ────────────────────────────────

describe("ratings surface (storefront-intel PRD 01)", () => {
  /** Apple's verbatim read for a polarized listing: 1★ 22% · 5★ 61% of 4,812. */
  const POLARIZED: StorefrontIntel = {
    ratings: { average: 3.9, count: 4812, histogram: [1059, 200, 300, 340, 2913] },
  };
  /** Apple's own "Not Enough Ratings" territory. */
  const THIN: StorefrontIntel = {
    ratings: { average: 4.8, count: 12, histogram: [1, 0, 1, 2, 8] },
  };

  it("a bimodal histogram emits exactly ratings_polarized with verbatim share evidence", () => {
    const findings = auditFindings(input({ storefront: POLARIZED }));
    const rt = findings.filter((f) => f.surface === "ratings");
    expect(rt.length).toBe(1);
    expect(rt[0]?.id).toBe("ratings_polarized");
    expect(rt[0]?.severity).toBe("warn");
    expect(rt[0]?.impact).toBe("trust");
    // evidence carries the observed shares verbatim, labeled with Apple's count.
    expect(rt[0]?.evidence).toBe("1★ 22% · 5★ 61% (n=4,812)");
    expect(rt[0]?.title).toContain("polarized");
    // fix points at the 1★ cohort, cross-referencing review topics.
    expect(rt[0]?.fix).toMatch(/1★/);
  });

  it("a thin count emits ratings_thin as an info CONTEXT finding framed as Apple's own status", () => {
    const findings = auditFindings(input({ storefront: THIN }));
    const rt = findings.filter((f) => f.surface === "ratings");
    expect(rt.length).toBe(1);
    expect(rt[0]?.id).toBe("ratings_thin");
    expect(rt[0]?.severity).toBe("info");
    expect(rt[0]?.impact).toBe("trust");
    expect(rt[0]?.context).toBe(true);
    // Apple's own count, verbatim — a fact, never a deficiency claim.
    expect(rt[0]?.title).toBe("Only 12 ratings — too few to read the shape");
    expect(rt[0]?.evidence).toContain("n=12 ratings");
  });

  it("a healthy, well-rated storefront emits ZERO ratings findings", () => {
    const healthy: StorefrontIntel = {
      ratings: { average: 4.7, count: 5000, histogram: [100, 100, 300, 1000, 3500] },
    };
    const findings = auditFindings(input({ storefront: healthy }));
    expect(findings.filter((f) => f.surface === "ratings")).toEqual([]);
  });

  type SilentCase = { name: string; storefront: StorefrontIntel | undefined };
  const SILENT: SilentCase[] = [
    { name: "storefront absent", storefront: undefined },
    { name: "ratings absent", storefront: { whatsNew: "Bug fixes." } },
    {
      name: "histogram unreadable ([] fallback) — both findings suppressed",
      storefront: { ratings: { average: 4.8, count: 12, histogram: [] } },
    },
  ];

  it.each(SILENT)("$name ⇒ zero ratings findings", ({ storefront }) => {
    const findings = auditFindings(input({ storefront }));
    expect(findings.filter((f) => f.surface === "ratings")).toEqual([]);
  });

  it("invariant: no ratings finding is EVER critical (low-signal surface)", () => {
    const cases: Array<StorefrontIntel | undefined> = [
      POLARIZED,
      THIN,
      undefined,
      { ratings: { average: 1.2, count: 100000, histogram: [90000, 5000, 3000, 1000, 1000] } },
      { ratings: { average: 3.0, count: 300, histogram: [150, 0, 0, 0, 150] } },
    ];
    for (const storefront of cases) {
      const rt = auditFindings(input({ storefront })).filter((f) => f.surface === "ratings");
      expect(rt.every((f) => f.severity !== "critical")).toBe(true);
    }
  });
});

// ── #71-B/C: suggestions instead of bare links + status/fix separation ────────

describe("findings as suggestions (#71-B)", () => {
  const RANKS = [
    { keyword: "meal planner", rank: 12, total: 200, limit: 200, foundName: "Demo", error: "" },
    { keyword: "grocery list", rank: null, total: 200, limit: 200, foundName: "", error: "" },
    { keyword: "pantry tracker", rank: 44, total: 200, limit: 200, foundName: "Demo", error: "" },
  ];

  it("preview_missing scripts the preview from the run's real tracked keywords", () => {
    const snap = healthySnapshot();
    snap.previews = { devices: [] };
    const findings = auditFindings(input({ snapshot: snap, ranks: RANKS as never }));
    const f = byId(findings, "preview_missing");
    expect(f).toBeDefined();
    expect(f!.fix).toContain("“meal planner”");
    expect(f!.fix).toContain("first 3 seconds");
    expect(f!.fix).toContain("“grocery list”");
  });

  it("preview_missing keeps the generic guidance when the run tracked no keywords", () => {
    const snap = healthySnapshot();
    snap.previews = { devices: [] };
    const f = byId(auditFindings(input({ snapshot: snap, ranks: [] })), "preview_missing");
    expect(f!.fix).toBe("Add a 15–30s preview for your primary device.");
  });

  it("secondary_category_missing carries a derived suggestion for a mapped primary", () => {
    const snap = healthySnapshot();
    delete snap.appInfo!.secondaryCategory;
    snap.appInfo!.primaryCategory = { id: "FOOD_AND_DRINK", name: "Food & Drink" };
    const f = byId(auditFindings(input({ snapshot: snap })), "secondary_category_missing");
    expect(f!.fix).toContain("Health & Fitness or Lifestyle");
    expect(f!.fix).toContain("From your primary category");
  });

  it("secondary_category_missing keeps generic copy for an unmapped primary", () => {
    const snap = healthySnapshot();
    delete snap.appInfo!.secondaryCategory;
    snap.appInfo!.primaryCategory = { id: "SOMETHING_NEW", name: "Something New" };
    const f = byId(auditFindings(input({ snapshot: snap })), "secondary_category_missing");
    expect(f!.fix).toBe("Pick your most relevant secondary category in App Store Connect.");
  });

  it("cpp_none suggests one page per tracked intent", () => {
    const snap = healthySnapshot();
    snap.customProductPages = { pages: [] };
    const f = byId(auditFindings(input({ snapshot: snap, ranks: RANKS as never })), "cpp_none");
    expect(f!.fix).toContain("one page per intent");
    expect(f!.fix).toContain("“meal planner”");
    expect(f!.fix).toContain("“pantry tracker”");
  });

  it("cpp_none frames CPPs as organic surface + counts MEASURED intents (#154)", () => {
    const snap = healthySnapshot();
    snap.customProductPages = { pages: [] };
    const f = byId(auditFindings(input({ snapshot: snap, ranks: RANKS as never })), "cpp_none");
    expect(f!.detail).toMatch(/organic search/i);
    // meal planner / grocery list / pantry tracker share no term → 3 intents
    expect(f!.detail).toContain("3 distinct intents");
  });

  it("cpp_none makes NO intent claim when there are no tracked keywords (never a fake count)", () => {
    const snap = healthySnapshot();
    snap.customProductPages = { pages: [] };
    const f = byId(auditFindings(input({ snapshot: snap, ranks: [] })), "cpp_none");
    expect(f!.detail).not.toMatch(/distinct intent/i);
  });

  it("cpp_present flags headroom when tracked intents outnumber existing pages (#154)", () => {
    const snap = healthySnapshot();
    snap.customProductPages = { pages: [{ id: "1", name: "Default-ish", state: "VISIBLE" }] };
    const f = byId(auditFindings(input({ snapshot: snap, ranks: RANKS as never })), "cpp_present");
    // 3 intents vs 1 page → 2 uncovered
    expect(f!.detail).toContain("2 more than your 1 page");
    expect(f!.fix).toMatch(/uncovered intent/i);
  });

  it("flags a CPP whose screenshots are identical to the default page (#154 wasted surface)", () => {
    const snap = healthySnapshot();
    // default page has two real assets
    snap.screenshots = {
      iphoneScreenshots: [
        {
          device: "APP_IPHONE_67",
          count: 2,
          screenshots: [
            { id: "a", imageTemplate: "https://asc/a.png", fileName: "hero.png" },
            { id: "b", imageTemplate: "https://asc/b.png", fileName: "list.png" },
          ],
        },
      ],
      ipadScreenshots: [],
      dataReliable: true,
    };
    // CPP "Holiday" reuses the SAME assets; "Fresh" has its own
    snap.customProductPages = {
      pages: [
        { id: "c1", name: "Holiday", state: "VISIBLE", screenshotSig: "hero.png|list.png" },
        { id: "c2", name: "Fresh", state: "VISIBLE", screenshotSig: "new1.png|new2.png" },
      ],
    };
    const found = ids(input({ snapshot: snap, ranks: RANKS as never }));
    expect(found).toContain("cpp_identical_to_default_c1");
    expect(found).not.toContain("cpp_identical_to_default_c2");
  });

  it("stays silent on identical-CPP when a CPP's screenshots weren't read (no false positive)", () => {
    const snap = healthySnapshot();
    snap.screenshots = {
      iphoneScreenshots: [
        { device: "APP_IPHONE_67", count: 1, screenshots: [{ id: "a", imageTemplate: "https://asc/a.png", fileName: "hero.png" }] },
      ],
      ipadScreenshots: [],
      dataReliable: true,
    };
    snap.customProductPages = { pages: [{ id: "c1", name: "Holiday", state: "VISIBLE" }] }; // no screenshotSig
    expect(ids(input({ snapshot: snap, ranks: [] }))).not.toContain("cpp_identical_to_default_c1");
  });

  it("primary category is phrased as CONFIRMED by the read, not a go-check chore", () => {
    const f = byId(auditFindings(input()), "primary_category_context");
    expect(f!.title).toContain("Category confirmed:");
    expect(f!.fix).not.toMatch(/confirm it matches/i);
  });
});

describe("status vs fixes separation (#71-C)", () => {
  it("status/context findings carry context:true; actionable ones do not", () => {
    const snap = healthySnapshot();
    delete snap.appInfo!.secondaryCategory; // an actionable warn
    snap.locales = locales([{ locale: "en-US", name: "Demo", subtitle: "Do it", keywords: "a,b" }]);
    const findings = auditFindings(input({ snapshot: snap }));

    const contextIds = findings.filter((f) => f.context).map((f) => f.id);
    for (const id of ["version_context", "pricing_context", "age_rating_context", "primary_category_context", "version_no_draft", "locale_single"]) {
      // version_no_draft only fires without a draft; healthy snapshot HAS one —
      // assert only on the ones present, but the always-present trio must be there.
      if (findings.some((f) => f.id === id)) expect(contextIds).toContain(id);
    }
    expect(contextIds).toContain("version_context");
    expect(contextIds).toContain("pricing_context");

    // actionable findings never carry the flag
    const actionable = byId(findings, "secondary_category_missing");
    expect(actionable!.context).toBeUndefined();
  });

  it("version_no_draft and version_in_review are context when they fire", () => {
    const snap = healthySnapshot();
    snap.versionState = {
      current: { id: "V1", versionString: "1.0.0", appStoreState: "IN_REVIEW" },
      all: [{ id: "V1", versionString: "1.0.0", appStoreState: "IN_REVIEW" }],
    };
    const findings = auditFindings(input({ snapshot: snap }));
    expect(byId(findings, "version_in_review")!.context).toBe(true);
    expect(byId(findings, "version_no_draft")!.context).toBe(true);
  });
});

// ── languages surface (storefront-intel PRD 03) ──────────────────────────────
describe("language_single (keyless localization signal)", () => {
  /** Keyless input: no ASC snapshot; the public page lists languages. */
  function keyless(languages: string[], category?: string): AuditFindingsInput {
    return input({
      snapshot: undefined,
      hasAscKey: false,
      storefront: { languages, ...(category ? { category } : {}) },
    });
  }

  it("fires on a keyless run listed in exactly one language", () => {
    const findings = auditFindings(keyless(["English"]));
    const f = byId(findings, "language_single")!;
    expect(f).toBeDefined();
    expect(f.context).toBe(true);
    expect(f.severity).toBe("info");
    expect(f.title).toBe("Listed in 1 language (English)");
  });

  it("never fabricates per-market volume in its copy", () => {
    const f = byId(auditFindings(keyless(["English"])), "language_single")!;
    expect(f.detail).not.toMatch(/volume|installs?|downloads?|%/i);
  });

  it("does not fire with multiple languages", () => {
    const findings = auditFindings(keyless(["English", "German"]));
    expect(byId(findings, "language_single")).toBeUndefined();
  });

  it("does not fire when the storefront/languages are absent (unknown, not EN-only)", () => {
    expect(byId(auditFindings(input({ snapshot: undefined, hasAscKey: false })), "language_single")).toBeUndefined();
    expect(
      byId(auditFindings(input({ snapshot: undefined, hasAscKey: false, storefront: { whatsNew: "x" } })), "language_single"),
    ).toBeUndefined();
  });

  it("is suppressed on a keyed run — locale_single owns that surface (no double-count)", () => {
    const snap = healthySnapshot();
    snap.locales = locales([{ locale: "en-US", name: "Demo", subtitle: "Do it", keywords: "a,b" }]);
    const findings = auditFindings(input({ snapshot: snap, storefront: { languages: ["English"] } }));
    expect(byId(findings, "language_single")).toBeUndefined();
    expect(byId(findings, "locale_single")).toBeDefined();
  });
});

// ── listing findings pack: privacy · IAP · release (storefront-intel PRD 04) ──
describe("privacy findings (storefront.privacyLabels)", () => {
  const withStorefront = (s: StorefrontIntel) =>
    auditFindings(input({ snapshot: undefined, hasAscKey: false, storefront: s }));

  it("DATA_NOT_COLLECTED alone → privacy_data_not_collected (good), not _observed", () => {
    const f = withStorefront({ privacyLabels: ["DATA_NOT_COLLECTED"] });
    expect(byId(f, "privacy_data_not_collected")).toBeDefined();
    expect(byId(f, "privacy_data_not_collected")!.severity).toBe("good");
    expect(byId(f, "privacy_labels_observed")).toBeUndefined();
  });

  it("other labels → privacy_labels_observed listing them as evidence", () => {
    const f = withStorefront({ privacyLabels: ["DATA_LINKED_TO_YOU", "DATA_USED_TO_TRACK_YOU"] });
    const obs = byId(f, "privacy_labels_observed")!;
    expect(obs).toBeDefined();
    expect(obs.evidence).toContain("DATA_LINKED_TO_YOU");
    expect(byId(f, "privacy_data_not_collected")).toBeUndefined();
  });

  it("absent privacyLabels → no privacy finding (unknown, not 'no labels')", () => {
    expect(byId(withStorefront({ whatsNew: "x" }), "privacy_data_not_collected")).toBeUndefined();
    expect(byId(withStorefront({ whatsNew: "x" }), "privacy_labels_observed")).toBeUndefined();
  });
});

describe("IAP findings (storefront.inAppPurchases)", () => {
  const ranked = (kw: string[]) => kw.map((k, i) => ({ keyword: k, rank: i + 1, total: 200, checked_at: "2026-07-01" }));
  const run = (iaps: Array<{ name: string; price: string }>, keywords: string[]) =>
    auditFindings(input({ snapshot: undefined, hasAscKey: false, ranks: ranked(keywords) as never, storefront: { inAppPurchases: iaps } }));

  it("an IAP name containing a tracked keyword (case-insensitive) → iap_names_keyword_bearing", () => {
    const f = run([{ name: "Budget Pro Yearly", price: "$29.99" }], ["budget"]);
    const kb = byId(f, "iap_names_keyword_bearing")!;
    expect(kb).toBeDefined();
    expect(kb.impact).toBe("ranking");
    expect(kb.evidence).toContain("Budget Pro Yearly");
  });

  it("IAPs present but no tracked-keyword overlap → iap_names_generic", () => {
    const f = run([{ name: "Premium Monthly", price: "$4.99" }], ["budget"]);
    expect(byId(f, "iap_names_generic")).toBeDefined();
    expect(byId(f, "iap_names_keyword_bearing")).toBeUndefined();
  });

  it("an untracked-term match does NOT fire keyword_bearing", () => {
    const f = run([{ name: "Deluxe Yearly", price: "$9.99" }], ["budget"]);
    expect(byId(f, "iap_names_keyword_bearing")).toBeUndefined();
  });

  it("never emits price advice verbs in any IAP finding copy", () => {
    const f = run([{ name: "Premium Monthly", price: "$4.99" }], ["budget"]);
    for (const finding of f.filter((x) => x.surface === "iap")) {
      expect(`${finding.title} ${finding.detail} ${finding.fix}`).not.toMatch(/\b(raise|lower|increase|decrease|reprice|discount)\b/i);
    }
  });

  it("absent inAppPurchases → no IAP finding", () => {
    expect(auditFindings(input({ snapshot: undefined, hasAscKey: false, storefront: { whatsNew: "x" } })).filter((x) => x.surface === "iap")).toEqual([]);
  });
});

describe("release findings (storefront.whatsNew)", () => {
  const wn = (text: string) =>
    auditFindings(input({ snapshot: undefined, hasAscKey: false, storefront: { whatsNew: text } }));

  it("boilerplate What's New → whats_new_boilerplate (info)", () => {
    const f = byId(wn("Bug fixes and performance improvements."), "whats_new_boilerplate")!;
    expect(f).toBeDefined();
    expect(f.severity).toBe("info");
  });

  it("substantive What's New → no boilerplate finding", () => {
    expect(byId(wn("Added a 366-day quote library and offline mode."), "whats_new_boilerplate")).toBeUndefined();
  });

  it("no release finding ever claims a date or staleness", () => {
    for (const finding of wn("Bug fixes.").filter((x) => x.surface === "release")) {
      expect(`${finding.title} ${finding.detail} ${finding.fix}`).not.toMatch(/\b(days?|weeks?|months?|years?|stale|outdated|long time|since)\b/i);
    }
  });

  it("absent whatsNew → no release finding", () => {
    expect(auditFindings(input({ snapshot: undefined, hasAscKey: false, storefront: { privacyLabels: ["DATA_NOT_COLLECTED"] } })).filter((x) => x.surface === "release")).toEqual([]);
  });
});

describe("listing pack — safe degradation", () => {
  it("audit.storefront absent → the three families contribute nothing, no throw", () => {
    const f = auditFindings(input({ snapshot: undefined, hasAscKey: false }));
    expect(f.filter((x) => ["privacy", "iap", "release"].includes(x.surface))).toEqual([]);
  });

  it("is deterministic — same input twice → deep-equal", () => {
    const s: StorefrontIntel = {
      privacyLabels: ["DATA_NOT_COLLECTED"],
      inAppPurchases: [{ name: "Pro", price: "$1" }],
      whatsNew: "Bug fixes.",
    };
    expect(auditFindings(input({ storefront: s }))).toEqual(auditFindings(input({ storefront: s })));
  });
});

// ── chart surface (analytics-reports PRD 04 map) ─────────────────────────────
describe("chart_rank findings (public category chart)", () => {
  const base = { genreId: "6012", genreName: "Lifestyle", chart: "top-free" as const, country: "us", outOf: 100 };

  it("ranked → chart_rank_present (good) with the measured position", () => {
    const f = byId(auditFindings(input({ chartRank: { ...base, ranked: true, position: 7 } })), "chart_rank_present")!;
    expect(f).toBeDefined();
    expect(f.severity).toBe("good");
    expect(f.title).toContain("#7");
    expect(f.title).toContain("Lifestyle");
  });

  it("read-but-absent → chart_rank_absent (info), never a fabricated number", () => {
    const f = byId(auditFindings(input({ chartRank: { ...base, ranked: false } })), "chart_rank_absent")!;
    expect(f).toBeDefined();
    expect(f.severity).toBe("info");
    expect(`${f.title} ${f.detail} ${f.evidence}`).not.toMatch(/#\d/);
  });

  it("undefined/null chartRank → the chart surface is silent (unknown ≠ zero)", () => {
    expect(auditFindings(input({ chartRank: undefined })).filter((x) => x.surface === "chart")).toEqual([]);
    expect(auditFindings(input({ chartRank: null })).filter((x) => x.surface === "chart")).toEqual([]);
  });

  it("is deterministic", () => {
    const cr = { ...base, ranked: true, position: 3 } as const;
    expect(auditFindings(input({ chartRank: cr }))).toEqual(auditFindings(input({ chartRank: cr })));
  });
});

describe("review-risk lint integration (#178)", () => {
  it("surfaces a review_risk finding for risky proposed copy", () => {
    const got = ids(input({ proposedCopy: { name: "Weatherly #1", subtitle: "Free deal", keywords: "weatherly,radar" } }));
    expect(got).toContain("review_risk_superlative");
    expect(got).toContain("review_risk_price_in_title");
    expect(got).toContain("review_risk_brand_in_keywords");
  });
  it("emits no review-risk findings without proposed copy (or when clean)", () => {
    expect(ids(input()).some((i) => i.startsWith("review_risk_"))).toBe(false);
    expect(ids(input({ proposedCopy: { name: "Weatherly", subtitle: "Honest forecasts", keywords: "weather,radar" } })).some((i) => i.startsWith("review_risk_"))).toBe(false);
  });
});

describe("Studio grade projection (#26)", () => {
  it("projects a before→after grade for a set with count headroom (C with 3 shots)", () => {
    const got = ids(input({ audit: audit(shot({ iphoneCount: 3, score: 60, grade: "C" })) }));
    expect(got).toContain("studio_grade_projection");
  });
  it("is silent for an A-grade set (no headroom → never over-sell)", () => {
    const got = ids(input({ audit: audit(shot({ iphoneCount: 8, score: 90, grade: "A" })) }));
    expect(got).not.toContain("studio_grade_projection");
  });
  it("is silent for an unreadable set", () => {
    const got = ids(input({ audit: audit(shot({ score: null, grade: "?" })) }));
    expect(got).not.toContain("studio_grade_projection");
  });
});

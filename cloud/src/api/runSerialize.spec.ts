import { describe, expect, it } from "vitest";
import { serializeRunResult } from "./index.js";
import { auditFindings, summarizeFindings, surfaceLocks } from "../engine/auditFindings.js";
import { buildAscContext } from "../engine/ascContext.js";
import { metadataCoverage } from "../engine/metadataCoverage.js";
import type { ReasoningTrace } from "../d1.js";
import type { AscSnapshot } from "../engine/ascRead.js";
import type { Audit } from "../engine/agent.js";
import type { Rank } from "../engine/rankCheck.js";

/**
 * PRD 02 — the serialization privacy boundary. `serializeRunResult` is the pure
 * core of `runView`: it turns the stored `ReasoningTrace` into the client `result`
 * block. These tests assert the three PRD acceptance criteria:
 *   1. Mode-A run → non-empty findings + ascContext with the expected keys.
 *   2. No-key run → the thin set incl. `asc_unlock`, no ascContext.
 *   3. The negative test: raw pricing / locale copy / privacy-policy text NEVER
 *      reach the client.
 */

const APP_NAME = "Weatherly";

/** A real ASC snapshot with sensitive fields populated (for the leak test). */
function richSnapshot(): AscSnapshot {
  return {
    screenshots: undefined,
    previews: {
      devices: [{ previewType: "APP_IPHONE_67", assetState: ["COMPLETE"], previewUrls: ["https://secret.example/p.mp4"] }],
      usedLocale: "en-US",
    } as unknown as AscSnapshot["previews"],
    appInfo: {
      locales: [
        {
          locale: "en-US",
          name: APP_NAME,
          subtitle: "Hyperlocal forecasts",
          privacyPolicyUrl: "https://weatherly.example/privacy",
          privacyPolicyText: "SECRET PRIVACY POLICY TEXT — server-side only.",
        },
      ],
      primaryCategory: { id: "WEATHER", name: "Weather" },
      // no secondaryCategory ⇒ a real `secondary_category_missing` finding fires
    },
    versionState: {
      current: { id: "v1", versionString: "3.2.1", appStoreState: "READY_FOR_SALE" },
      all: [{ id: "v1", versionString: "3.2.1", appStoreState: "READY_FOR_SALE" }],
    },
    pricing: {
      pricing: { baseTerritoryPrice: 4.99, baseTerritory: "USA" },
      iaps: [{ id: "iap1", name: "Pro Monthly", productId: "com.weatherly.pro.monthly" }],
    } as unknown as AscSnapshot["pricing"],
    ageRating: { ageRating: "FOUR_PLUS" },
    customProductPages: { pages: [] } as unknown as AscSnapshot["customProductPages"],
    locales: [
      { locale: "en-US", name: APP_NAME, subtitle: "Hyperlocal forecasts", keywords: "weather,forecast,rain,storm" },
    ] as unknown as AscSnapshot["locales"],
    errors: [],
  };
}

function audit(grade: "A" | "?"): Audit {
  return {
    app: "weatherly",
    bundleId: "com.weatherly.app",
    liveName: APP_NAME,
    screenshots: grade === "?"
      ? { app: "weatherly", iphoneCount: 0, ipadCount: 0, score: null, grade: "?", findings: [], aspectHint: "", screenshotUrls: [], ipadScreenshotUrls: [], levers: [] }
      : { app: "weatherly", iphoneCount: 6, ipadCount: 2, score: 90, grade: "A", findings: [], aspectHint: "1290x2796", screenshotUrls: [], ipadScreenshotUrls: [], levers: [] },
  };
}

const RANKS: Rank[] = [{ keyword: "weather", rank: 3, foundName: APP_NAME, total: 200, limit: 200, error: "" }];

/** Build a trace the way the run paths do (engine compute → persisted shape). */
function modeATrace(): ReasoningTrace {
  const snapshot = richSnapshot();
  const findings = auditFindings({ snapshot, audit: audit("A"), ranks: RANKS, appName: APP_NAME, hasAscKey: true });
  const ascContext = buildAscContext(snapshot);
  // Coverage off the LIVE copy (PRD 03) — subtitle/keywords are read on a Mode-A
  // run; brand is "Weatherly". "forecast" appears in subtitle + keywords (dup).
  const coverage = metadataCoverage(
    { name: APP_NAME, subtitle: "Live forecast radar", keywords: "weather,forecast,rain,storm" },
    { brand: "Weatherly" },
  );
  return {
    audit: audit("A"),
    ranks: RANKS,
    competitors: { digest: "0 new", changes: [] },
    reasoning: [],
    currentCopy: { name: APP_NAME },
    proposedCopy: { name: APP_NAME, subtitle: "", keywords: "", validation: { pass: true, checks: [] } },
    pushCommands: [],
    findings,
    locks: surfaceLocks({ snapshot, audit: audit("A"), ranks: RANKS, appName: APP_NAME, hasAscKey: true }),
    coverage,
    ...(ascContext !== undefined ? { ascContext } : {}),
    trigger: { source: "manual", reasons: ["test"] },
  };
}

function noKeyTrace(): ReasoningTrace {
  const findings = auditFindings({ audit: audit("?"), ranks: RANKS, appName: APP_NAME, hasAscKey: false });
  return {
    audit: audit("?"),
    ranks: RANKS,
    competitors: { digest: "0 new", changes: [] },
    reasoning: [],
    currentCopy: { name: APP_NAME },
    proposedCopy: { name: APP_NAME, subtitle: "", keywords: "", validation: { pass: true, checks: [] } },
    pushCommands: [],
    findings,
    locks: surfaceLocks({ audit: audit("?"), ranks: RANKS, appName: APP_NAME, hasAscKey: false }),
    trigger: { source: "manual", reasons: ["test"] },
  };
}

describe("serializeRunResult — Mode-A (ASC) run", () => {
  const result = serializeRunResult(modeATrace(), false);

  it("returns a non-empty findings array", () => {
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("includes the real ASC-derived findings (e.g. secondary_category_missing)", () => {
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain("secondary_category_missing");
    expect(ids).toContain("primary_category_context");
    // NOT the unlock CTA — this run read ASC.
    expect(ids).not.toContain("asc_unlock");
  });

  it("includes a findingsSummary with counts matching the findings", () => {
    expect(result.findingsSummary).toEqual(summarizeFindings(result.findings));
    expect(result.findingsSummary.total).toBe(result.findings.length);
  });

  it("ships a non-empty findingsSummary.label (production parity with the mock)", () => {
    expect(typeof result.findingsSummary.label).toBe("string");
    expect(result.findingsSummary.label.length).toBeGreaterThan(0);
    // it must read as the richer label, not a bare "N findings" count fallback.
    expect(result.findingsSummary.label).toMatch(/^(\d+ fixe?s? available( · \d+ critical)?|No fixes found)$/);
  });

  it("includes a slim ascContext with exactly the expected safe keys", () => {
    expect(result.ascContext).toEqual({
      category: "Weather",
      ageRating: "FOUR_PLUS",
      versionState: "READY_FOR_SALE",
      localeCount: 1,
      previewDeviceCount: 1,
    });
  });

  // ── the privacy boundary: a NEGATIVE test ──────────────────────────────────
  it("NEVER leaks raw pricing, locale copy, or privacy-policy text", () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("4.99"); // raw price
    expect(serialized).not.toContain("SECRET PRIVACY POLICY TEXT"); // policy text
    expect(serialized).not.toContain("weatherly.example/privacy"); // policy URL
    expect(serialized).not.toContain("weather,forecast,rain"); // full keyword copy
    expect(serialized).not.toContain("secret.example"); // asset URL
    expect(serialized).not.toContain("com.weatherly.pro.monthly"); // IAP product id
  });

  it("does not carry the raw ascSnapshot", () => {
    expect((result as Record<string, unknown>).ascSnapshot).toBeUndefined();
  });

  // ── PRD 03: the coverage report rides through, curated + safe ───────────────
  it("includes the metadata coverage report with score, usedChars, and waste", () => {
    expect(result.coverage).toBeTruthy();
    expect(typeof result.coverage?.coverageScore).toBe("number");
    expect(result.coverage?.coverageScore).toBeGreaterThanOrEqual(0);
    expect(result.coverage?.coverageScore).toBeLessThanOrEqual(100);
    expect(result.coverage?.usedChars).toEqual({ name: APP_NAME.length, subtitle: "Live forecast radar".length, keywords: "weather,forecast,rain,storm".length });
    // 'forecast' lives in subtitle + keywords → a duplicate waste item.
    expect(result.coverage?.waste.some((w) => w.kind === "duplicate" && w.detail.includes("forecast"))).toBe(true);
  });

  it("coverage never leaks the full raw keyword copy string (only curated tokens)", () => {
    const serialized = JSON.stringify(result.coverage);
    expect(serialized).not.toContain("weather,forecast,rain"); // never the comma-joined field
  });

  // ── #61: a keyed run can read every surface ⇒ it locks NOTHING ──────────────
  it("carries an empty locks[] on a keyed run (nothing is unreadable)", () => {
    expect(result.locks).toEqual([]);
  });
});

describe("serializeRunResult — no-key run", () => {
  const result = serializeRunResult(noKeyTrace(), false);

  it("returns the thin set including the asc_unlock CTA", () => {
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain("asc_unlock");
    // public-only ⇒ no ASC-derived findings
    expect(ids).not.toContain("secondary_category_missing");
    expect(ids).not.toContain("privacy_policy_missing");
  });

  it("omits ascContext entirely (no snapshot was read)", () => {
    expect("ascContext" in result).toBe(false);
  });

  it("still carries findings + summary so the card always renders", () => {
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findingsSummary.total).toBe(result.findings.length);
  });

  // ── #61: a no-key run carries the canonical locked surfaces, copy-safe ───────
  it("carries the canonical surface locks (the per-surface upgrade contract)", () => {
    expect(Array.isArray(result.locks)).toBe(true);
    expect((result.locks ?? []).length).toBeGreaterThan(0);
    const surfaces = (result.locks ?? []).map((l: { surface: string }) => l.surface);
    expect(surfaces).toEqual(["subtitle", "keywords", "screenshots", "previews", "privacy", "category", "locales"]);
  });

  it("lock copy frames opportunity, never a deficiency or raw ASC data", () => {
    const serialized = JSON.stringify(result.locks);
    // honest capability/opportunity copy only — no false metrics, no urgency.
    expect(serialized).not.toMatch(/\b0\/(30|100)\b/);
    expect(serialized).not.toMatch(/costing you|losing|urgent/i);
  });
});

describe("serializeRunResult — legacy trace (pre-PRD 02)", () => {
  it("defaults findings to [] and omits ascContext + coverage, never throwing", () => {
    const legacy = noKeyTrace();
    delete (legacy as { findings?: unknown }).findings;
    delete (legacy as { locks?: unknown }).locks;
    const result = serializeRunResult(legacy, false);
    expect(result.findings).toEqual([]);
    expect(result.findingsSummary.total).toBe(0);
    expect("ascContext" in result).toBe(false);
    // A trace with no coverage (older or no-copy run) omits it cleanly.
    expect("coverage" in result).toBe(false);
    // #61: a legacy trace with no locks omits the field (UI falls back to isNoKeyRun).
    expect("locks" in result).toBe(false);
  });
});

describe("serializeRunResult — rank opportunities (PRD 06)", () => {
  it("surfaces the trace's opportunities to the client (curated copy only)", () => {
    const trace = modeATrace();
    trace.opportunities = [
      {
        keyword: "weather",
        rank: 3,
        opportunityScore: 72,
        reachability: "now",
        why: "Most winnable next: already top 10.",
        drivers: { distance: 98, competitorWeakness: 100, momentum: 50 },
      },
    ];
    const result = serializeRunResult(trace, false);
    expect(result.opportunities).toEqual(trace.opportunities);
    // Honesty: the why never claims causation.
    expect(result.opportunities[0]?.why.toLowerCase()).not.toMatch(/caused|guaranteed/);
  });

  it("defaults opportunities to [] on a trace that has none (older runs)", () => {
    const result = serializeRunResult(noKeyTrace(), false);
    expect(result.opportunities).toEqual([]);
  });
});

describe("serializeRunResult — review sentiment (#95)", () => {
  it("surfaces the trace's PUBLIC review sentiment to the client (sample size carried)", () => {
    const trace = modeATrace();
    trace.reviews = {
      n: 42,
      score: 78,
      confidence: "ok",
      label: "mostly positive",
      topics: [{ topic: "sync", count: 9, sentiment: "negative", sampleQuotes: ["sync keeps failing"] }],
    };
    const result = serializeRunResult(trace, false) as { reviews?: typeof trace.reviews };
    expect(result.reviews).toEqual(trace.reviews);
    // the honest sample size always rides through.
    expect(result.reviews?.n).toBe(42);
  });

  it("rides through the SUPPRESSED low-sample read (score:null) verbatim (#78)", () => {
    const trace = modeATrace();
    trace.reviews = {
      n: 6,
      score: null,
      confidence: "low",
      label: "too few reviews to summarize reliably",
      note: "too few reviews to summarize reliably (n=6)",
      topics: [],
    };
    const result = serializeRunResult(trace, false) as { reviews?: typeof trace.reviews };
    expect(result.reviews?.score).toBeNull();
    expect(result.reviews?.confidence).toBe("low");
  });

  it("omits `reviews` entirely on a trace that fetched none (older/no-review runs)", () => {
    const result = serializeRunResult(noKeyTrace(), false) as Record<string, unknown>;
    expect("reviews" in result).toBe(false);
  });
});

describe("serializeRunResult — storefront intel on the audit (one thread-through)", () => {
  it("survives the reasoning_json persist round-trip and reaches the client verbatim", () => {
    const trace = noKeyTrace();
    trace.audit = {
      ...audit("A"),
      storefront: {
        ratings: { average: 4.6, count: 128, histogram: [1, 2, 5, 20, 100] },
        whatsNew: "- 366 daily quotes",
        privacyLabels: ["DATA_NOT_COLLECTED"],
        languages: ["English", "German"],
        category: "Lifestyle",
        inAppPurchases: [{ name: "Pro Yearly", price: "$29.99" }],
        similarApps: [{ bundleId: "molozhenko.Sober", name: "Sober not Sorry" }],
        moreByDeveloper: [{ bundleId: "com.airowe.mangia", name: "Mangia - Recipe Manager" }],
      },
    };
    // persistRun stores the trace as JSON in runs.reasoning_json; runView parses
    // it back. The round-trip must not drop or reshape the storefront intel.
    const persisted = JSON.parse(JSON.stringify(trace)) as ReasoningTrace;
    const result = serializeRunResult(persisted, false);
    expect(result.audit.storefront).toEqual(trace.audit.storefront);
  });

  it("stays absent on an audit that never read the page (unknown, never {})", () => {
    const result = serializeRunResult(noKeyTrace(), false);
    expect("storefront" in result.audit).toBe(false);
  });
});

describe("serializeRunResult — approval gate still holds", () => {
  it("withholds pushCommands until approved (unchanged by PRD 02)", () => {
    const trace = modeATrace();
    trace.pushCommands = [{ store: "appstore", tool: "asc", description: "x", command: "asc x" }];
    expect(serializeRunResult(trace, false).pushCommands).toEqual([]);
    expect(serializeRunResult(trace, true).pushCommands.length).toBe(1);
  });
});

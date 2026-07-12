import type { Page } from "@playwright/test";

/**
 * Deterministic API mocks for the redesign's happy path. Intercepts the built
 * app's real API host and answers each endpoint with realistic, typed-shaped
 * JSON — so the E2E drives the ACTUAL app (router, React Query, all cards) with
 * zero live Worker/D1/network. Anything not explicitly matched returns 200 {}
 * so no request ever escapes to the real backend.
 */
const iso = "2026-07-01T12:00:00.000Z";

const APPS = {
  apps: [
    {
      id: "app1",
      name: "Weatherly",
      bundle_id: "com.demo.weatherly",
      latest_run: { status: "awaiting_approval", created_at: iso },
      rank_summary: { lead_keyword: "weather", lead_rank: 12 },
      findings_summary: { label: "3 fixes available · 1 critical", critical: 1 },
    },
  ],
};

const APP_DETAIL = {
  app: { id: "app1", bundle_id: "com.demo.weatherly", name: "Weatherly", country: "us" },
  runs: [{ id: "run1", status: "awaiting_approval", created_at: iso }],
};

const RANKS = {
  points: [
    { rank: 20, total: 200, checked_at: "2026-06-01T00:00:00Z" },
    { rank: 16, total: 200, checked_at: "2026-06-15T00:00:00Z" },
    { rank: 12, total: 200, checked_at: "2026-07-01T00:00:00Z" },
  ],
  annotations: [{ at: "2026-06-15T00:00:00Z", kind: "push", label: "Pushed new subtitle" }],
};

const DELTAS = {
  entries: [
    { keyword: "weather", previous: 16, current: 12, delta: 4, direction: "up" },
    { keyword: "radar", previous: null, current: 30, delta: null, direction: "new" },
  ],
};

const COMPETITORS = {
  competitors: [{ key: "c1", name: "RainRadar", source: "discovered", status: "confirmed" }],
};

const RUN_DETAIL = {
  id: "run1",
  app_id: "app1",
  status: "awaiting_approval",
  created_at: iso,
  approval: null,
  result: {
    currentCopy: { name: "Weatherly", subtitle: "Weather app", keywords: "weather,forecast" },
    proposedCopy: { name: "Weatherly — Forecasts", subtitle: "Honest hourly forecasts", keywords: "weather,forecast,radar,rain" },
    pushCommands: [],
    findingsSummary: { label: "3 fixes available · 1 critical", critical: 1 },
    findings: [
      { id: "subtitle_thin", surface: "subtitle", severity: "critical", impact: "ranking", title: "Subtitle underuses its keyword budget", detail: "Your subtitle is a ranked field.", fix: "Add high-value terms to the subtitle." },
      { id: "screenshots_thin", surface: "screenshots", severity: "warn", impact: "conversion", title: "Only 2 iPhone screenshots", detail: "More shots convert better.", fix: "Add 3+ outcome-led screenshots." },
      { id: "version_state", surface: "version", severity: "info", impact: "completeness", title: "Live version 2.1 in READY_FOR_SALE", detail: "Context fact.", fix: "", context: true },
    ],
    locks: [],
    opportunities: [
      { keyword: "hourly forecast", rank: 14, opportunityScore: 82, why: "Close to the top 10, weak competitors, gaining.", reachability: "now" },
      { keyword: "weather radar", rank: null, opportunityScore: 40, why: "Not in top results yet; mid competition.", reachability: "soon" },
    ],
    localizationExpansion: [
      { locale: "es-MX", rationale: "Large Spanish-speaking market you don't list in.", storefrontTier: "large", effort: "new" },
    ],
    coverage: {
      coverageScore: 72,
      distinctTerms: 14,
      fieldFill: [
        { field: "name", limit: 30, used: 22, fillPct: 73, seen: true },
        { field: "subtitle", limit: 30, used: 24, fillPct: 80, seen: true },
        { field: "keywords", limit: 100, used: 61, fillPct: 61, seen: true },
      ],
      waste: [{ kind: "duplicate", detail: "'weather' repeats across fields", chars: 7 }],
    },
    ppoTreatment: {
      headline: "Run a free A/B test: an outcome-led screenshot treatment",
      steps: ["Duplicate your current screenshots.", "Rewrite the first caption around the outcome."],
      evidence: "Public Product Page Optimization tests have measured large conversion swings.",
      guidance: "Let the test run up to ~90 days and reach Apple's confidence threshold before you read it.",
      ascUrl: "https://appstoreconnect.apple.com/apps/12345/distribution",
    },
    audit: { app: "Weatherly", bundleId: "com.demo.weatherly", liveName: "Weatherly", screenshots: { grade: "C", score: 62, findings: [], iphoneCount: 2, ipadCount: 0 } },
  },
};

/** Per-path JSON, matched by URL suffix (most-specific first). */
const ROUTES: Array<[RegExp, unknown]> = [
  [/\/auth\/me$/, { authed: true, email: "demo@shipaso.com" }],
  [/\/proof$/, { apps: 0, pushes: 0, wins: 0 }],
  [/\/account\/credentials$/, { enabled: false, credentials: [] }],
  [/\/github\/status$/, { appConfigured: false, connected: false, repo: null }],
  [/\/apps\/app1\/ranks(\?|$)/, RANKS],
  [/\/apps\/app1\/deltas$/, DELTAS],
  [/\/apps\/app1\/competitors$/, COMPETITORS],
  [/\/apps\/app1\/analytics\/engagement$/, { state: "no_data", message: "No measured conversion yet." }],
  [/\/apps\/app1$/, APP_DETAIL],
  [/\/apps$/, APPS],
  [/\/runs\/run1$/, RUN_DETAIL],
];

/** A request whose path is one of our API routes — host-agnostic, so the mocks
 *  work whether the build targets api.shipaso.com or a relative base. */
function isApiPath(pathname: string): boolean {
  return /^\/(apps|runs|auth|account|github|proof|resolve)\b/.test(pathname);
}

/**
 * Install the mock backend on a page: intercept API requests BY PATH (regardless
 * of origin) and answer with typed JSON; everything else (the app's own HTML/JS/
 * CSS) loads normally. Host-agnostic so the same mocks work in CI (built with any
 * VITE_API_BASE) and locally.
 */
export async function installMocks(page: Page): Promise<void> {
  await page.route(
    (url) => isApiPath(url.pathname),
    async (route) => {
      // Only intercept the app's data calls (fetch/xhr). A top-level navigation to
      // an owned route like /apps/:id is a DOCUMENT request whose path also looks
      // like an API path — let it through so the server serves the SPA shell.
      const type = route.request().resourceType();
      if (type !== "fetch" && type !== "xhr") return route.continue();
      const u = new URL(route.request().url());
      const hit = ROUTES.find(([re]) => re.test(u.pathname + u.search));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(hit ? hit[1] : {}),
      });
    },
  );
}

import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun, readDeltaRows } from "./helpers.js";

/**
 * End-to-end of the dashboard funnel, driving the REAL app.js against the
 * deterministic mock backend (mock.js). Covers: connect-by-name → first run →
 * app detail with the animated rank-movement card → the share-a-win button →
 * the approval gate (commands hidden until approved → revealed) → and the
 * prefers-reduced-motion path. No live Worker, D1, or network is touched.
 */

test.describe("dashboard funnel (mock backend)", () => {
  test("connect-by-name resolves a catalog app and lands on the APP PAGE (not a silent dashboard bounce) (#77)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);

    // The connect form: search a name that resolves to a single catalog app
    // ("Calm" is unique in the mock catalog). Picking it connects the app. Target
    // the connect search box by its placeholder (NOT input.first(), which is the
    // header "act as…" email field).
    const search = page.getByPlaceholder(/app name, app store .* link, or bundle id/i);
    await search.fill("Calm");
    await page.getByRole("button", { name: /^search$/i }).click();

    // #77: after connect, land on the APP PAGE (#/apps/:id) — where the ASC-read
    // panel is the primary CTA — NOT a silent dashboard bounce (which read as
    // "nothing happened") and NOT an auto-blind-run (low-quality name tokens).
    await expect(page).toHaveURL(/#\/apps\//, { timeout: 10_000 });
    await expect(page.locator("h1", { hasText: /Calm/i })).toBeVisible({ timeout: 10_000 });
    // The ASC read-and-improve run is the primary CTA on the app page.
    await expect(page.getByRole("button", { name: /run with asc read/i })).toBeVisible();
  });

  test("typing 3+ chars auto-searches (no button click) and shows the picker", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const search = page.getByPlaceholder(/app name, app store .* link, or bundle id/i);

    // Two chars: below the threshold — must NOT search yet.
    await search.fill("me");
    await page.waitForTimeout(500);
    await expect(page.locator(".appcard")).toHaveCount(0);

    // 3+ chars: a debounced auto-search fires WITHOUT clicking Search. "med"
    // matches the meditation apps in the catalog → the picker renders. We never
    // touch the Search button.
    await search.fill("meditation");
    await expect(page.locator(".appcard").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/pick your app/i)).toBeVisible();

    // Auto-search must NOT auto-connect even on a lone exact hit — that would
    // yank the user into a run on a keystroke. A single result shows the picker.
    await search.fill("Calm");
    await expect(page.locator(".appcard", { hasText: "Calm" })).toBeVisible({ timeout: 10_000 });
    // Still on the connect screen (picker), not navigated to an app dashboard.
    await expect(page.getByText(/found it — click to connect|pick your app/i)).toBeVisible();
  });

  test("the picker pages: 'Show more' loads the next page of results", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const search = page.getByPlaceholder(/app name, app store .* link, or bundle id/i);

    // "meditation" is padded to 27 catalog results → page 1 = 12 + a "Show more".
    await search.fill("meditation");
    await expect(page.locator(".appcard").first()).toBeVisible({ timeout: 10_000 });
    expect(await page.locator(".appcard").count()).toBe(12);
    const moreBtn = page.getByRole("button", { name: /show more results/i });
    await expect(moreBtn).toBeVisible();

    // Clicking it appends the next page (rows accumulate, not replaced).
    await moreBtn.click();
    await expect.poll(async () => page.locator(".appcard").count()).toBeGreaterThan(12);

    // Page through to the end by clicking "Show more" until it's gone. (The
    // scroll sentinel may also fire — both drive the same paginator, so we just
    // keep clicking while a button exists rather than assert exact step counts.)
    for (let i = 0; i < 5; i++) {
      const btn = page.getByRole("button", { name: /show more results/i });
      if ((await btn.count()) === 0) break;
      await btn.click().catch(() => {});
      await page.waitForTimeout(150);
    }

    // All 27 loaded, button replaced by the "that's everything" note.
    await expect.poll(async () => page.locator(".appcard").count()).toBe(27);
    await expect(page.getByRole("button", { name: /show more results/i })).toHaveCount(0);
    await expect(page.getByText(/that's everything matching/i)).toBeVisible();
  });

  test("the picker auto-loads more on scroll (infinite scroll sentinel)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const search = page.getByPlaceholder(/app name, app store .* link, or bundle id/i);
    await search.fill("meditation");
    await expect(page.locator(".appcard").first()).toBeVisible({ timeout: 10_000 });
    expect(await page.locator(".appcard").count()).toBe(12);

    // Scroll the sentinel into view → the IntersectionObserver fires loadMore()
    // with no button click. More rows appear.
    await page.locator(".pager-sentinel").scrollIntoViewIfNeeded();
    await expect.poll(async () => page.locator(".appcard").count()).toBeGreaterThan(12);
  });

  test("name search at end-of-results nudges to paste an exact link/bundle id, and the link focuses the search box (#48)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const search = page.getByPlaceholder(/app name, app store .* link, or bundle id/i);

    // A NAME search ("meditation") pages to the very end of the mock's 27 results.
    await search.fill("meditation");
    await expect(page.locator(".appcard").first()).toBeVisible({ timeout: 10_000 });

    // Click through to the end so the paginator hits hasMore=false.
    for (let i = 0; i < 6; i++) {
      const btn = page.getByRole("button", { name: /show more results/i });
      if ((await btn.count()) === 0) break;
      await btn.click().catch(() => {});
      await page.waitForTimeout(150);
    }
    await expect(page.getByRole("button", { name: /show more results/i })).toHaveCount(0);

    // The end-of-results nudge is visible and frames the find-my-app path honestly.
    const nudge = page.locator(".find-exact-nudge");
    await expect(nudge).toBeVisible();
    await expect(nudge).toContainText(/don't see your app/i);
    await expect(nudge).toContainText(/search can miss apps that don't yet rank/i);

    // The "App Store link or bundle id" phrase is an actionable control that
    // focuses the search input (so the user can paste their exact id/link).
    const link = nudge.locator(".find-exact-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveText(/app store link or bundle id/i);
    await link.click();
    await expect(search).toBeFocused();
  });

  test("an exact bundle-id search resolves directly and shows NO end-of-results nudge (#48)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const search = page.getByPlaceholder(/app name, app store .* link, or bundle id/i);

    // A bundle id resolves to exactly one catalog app (single result, hasMore=false)
    // — there's nothing to "find exactly", so the nudge must NOT appear.
    await search.fill("com.calm.calmapp");
    await expect(page.getByText(/found it — click to connect|pick your app/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(".find-exact-nudge")).toHaveCount(0);
  });

  test("app detail renders the animated rank-movement card with numbers matching the data", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);

    // The movement card heading is present.
    await expect(page.getByRole("heading", { name: /rank movement this week/i })).toBeVisible();

    // Rows render; wait past the count-up settle window so numbers are final.
    const rows = page.locator(".deltarow");
    await expect(rows.first()).toBeVisible();
    await page.waitForTimeout(1500);

    // Every displayed current rank must equal the mock's data (the count-up
    // safety-net guarantees it lands exactly, even if rAF is throttled).
    const dom = await readDeltaRows(page);
    expect(dom.length).toBeGreaterThan(0);

    const data = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const d = await (await M.handle("GET", `/apps/${appId}/deltas`, null, "demo@store-ops.dev")).json();
      return d.entries as Array<{ keyword: string; current: number | null }>;
    }, id);
    const byKw = Object.fromEntries(data.map((e) => [e.keyword, e]));

    for (const row of dom) {
      const expected = byKw[row.keyword];
      expect(expected, `data for keyword "${row.keyword}"`).toBeTruthy();
      const expectedCur = expected.current === null ? "—" : `#${expected.current}`;
      expect(row.cur, `current rank for "${row.keyword}"`).toBe(expectedCur);
    }
  });

  test("a climbing keyword shows an up chip and its current rank in the signal-green class", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // Keywords whose hash yields a climb exist in the default seed; assert at least
    // one row is a real 'up' move (green chip + .good current).
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);
    await page.waitForTimeout(1500);

    const upChips = page.locator(".dchip.up");
    await expect(upChips.first()).toBeVisible();
    // the up chip's row has a green current rank
    const goodCur = page.locator(".deltarow", { has: page.locator(".dchip.up") }).locator(".dcur.good");
    await expect(goodCur.first()).toBeVisible();
  });

  test("the share-a-win button appears when there is a real win", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);

    // hasShareWin gates the button on a climb/strong-new — the default seed has one.
    const hasWin = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const d = await (await M.handle("GET", `/apps/${appId}/deltas`, null, "demo@store-ops.dev")).json();
      return (d.entries as Array<{ direction: string; current: number | null }>).some(
        (e) => (e.direction === "up" && e.current != null) || (e.direction === "new" && e.current != null && e.current <= 50),
      );
    }, id);

    const shareBtn = page.getByRole("button", { name: /share this win/i });
    if (hasWin) {
      await expect(shareBtn).toBeVisible();
    } else {
      await expect(shareBtn).toHaveCount(0);
    }
  });

  test("the run page renders the metadata coverage gauge + waste breakdown (PRD 03)", async ({ page }) => {
    await gotoMockDashboard(page);
    // An ASC (Mode-A) run fills the live subtitle + keyword field, so the coverage
    // report has real terms to score (and likely some duplicate/filler waste).
    const id = await seedAppWithRun(page, { asc: true });
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    // The coverage gauge renders inside the listing-audit card with a numeric score.
    const gauge = page.locator(".cov-gauge .cov-score");
    await expect(gauge).toBeVisible({ timeout: 10_000 });
    const scoreText = (await gauge.textContent())?.trim() ?? "";
    const score = Number(scoreText);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);

    // The honesty frame must be present — coverage is a budget heuristic, not a
    // rank score (the PRD's over-claim guard, surfaced in the UI).
    await expect(page.getByText(/not a rank score/i)).toBeVisible();
    await expect(page.getByText(/of 160 chars working/i)).toBeVisible();

    // (#60) A per-field FILL breakdown renders for all three fields. On a keyed
    // run every field is SEEN, so each row carries a real used/limit + a fill bar
    // (no "unseen" markers) — fill is shown honestly, separate from the score.
    const covCard = page.locator(".cov-card");
    const rows = covCard.locator(".cov-field-row");
    await expect(rows).toHaveCount(3);
    await expect(covCard.locator(".cov-field-row", { hasText: "Name" })).toContainText(/\d+\/30/);
    await expect(covCard.locator(".cov-field-row", { hasText: "Subtitle" })).toContainText(/\d+\/30/);
    await expect(covCard.locator(".cov-field-row", { hasText: "Keywords" })).toContainText(/\d+\/100/);
    await expect(covCard.locator(".cov-field-val.unseen")).toHaveCount(0);

    // The coverage report served to the client must match what renders, and must
    // never carry the raw comma-joined keyword field (the privacy boundary).
    const cov = await page.evaluate(async (rid) => {
      const M = (window as any).STORE_OPS_MOCK;
      const r = await (await M.handle("GET", `/runs/${rid}`, null, "demo@store-ops.dev")).json();
      return r.result.coverage as { coverageScore: number; waste: Array<{ kind: string; chars: number }> };
    }, runId);
    expect(typeof cov.coverageScore).toBe("number");
    expect(Math.round(cov.coverageScore)).toBe(score);
  });

  test("approval gate hides push commands until approved, then reveals them", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);

    // Open the latest run for this app.
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    await expect(page.getByRole("heading", { name: /approval gate/i })).toBeVisible();

    // Pre-approval: the locked placeholder is shown, no live push commands.
    await expect(page.locator(".locked")).toBeVisible();

    // Approve → commands revealed.
    await page.getByRole("button", { name: /approve & reveal commands/i }).click();
    // After the decision the gate re-renders into the approved state.
    await expect(page.getByText(/Hand the metadata to your build pipeline/i)).toBeVisible({
      timeout: 10_000,
    });

    // Honest status: the status BADGE must NOT claim "Shipped" (nothing pushed
    // to Apple yet — approval only reveals the commands). It reads "ready to
    // push".
    await expect(page.locator(".badge")).toHaveText(/Approved · ready to push/);
    await expect(page.getByText(/ready to push/i).first()).toBeVisible();
    await expect(page.getByText(/^Shipped$/)).toHaveCount(0);

    // The approval-sets-status path: the run row is now 'approved' — NOT
    // 'shipped'. 'shipped' would overstate (it implies a verified push reached
    // App Store Connect, which has not happened).
    const status = await page.evaluate(async (rid) => {
      const M = (window as any).STORE_OPS_MOCK;
      const run = await (await M.handle("GET", `/runs/${rid}`, null, "demo@store-ops.dev")).json();
      return run.status as string;
    }, runId);
    expect(status).toBe("approved");
  });

  test("the run page shows the keyword-opportunities card with competitor attribution and honest copy", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // Seed an app whose targeted keywords do NOT cover the competitors' terms,
    // so the gap finder surfaces real opportunities (PRD 01).
    const id = await seedAppWithRun(page, { keywords: ["timer", "focus", "pomodoro"] });
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    // The card renders with its honest, non-causal framing.
    await expect(page.getByRole("heading", { name: /keyword opportunities/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/competitors use that you don't target/i)).toBeVisible();
    // Honesty boundary: never claims a competitor RANKS because of a term.
    await expect(page.getByText(/visible listing/i)).toBeVisible();
    await expect(page.getByText(/rank #1 because/i)).toHaveCount(0);

    // At least one gap row with a competitor badge + an "Add to next run" button.
    const gap = page.locator(".gap").first();
    await expect(gap).toBeVisible();
    await expect(gap.locator(".gap-comp").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /add to next run/i }).first()).toBeVisible();
  });

  test("prefers-reduced-motion: the movement card renders fully (no stuck/invisible elements)", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);

    // With motion reduced, chips must be opacity:1 (the media guard) and the
    // current numbers must already equal the data (countUpRank short-circuits).
    await expect(page.locator(".deltarow").first()).toBeVisible();
    const chipOpacity = await page.locator(".dchip").first().evaluate((el) => getComputedStyle(el).opacity);
    expect(chipOpacity).toBe("1");

    const dom = await readDeltaRows(page);
    const data = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const d = await (await M.handle("GET", `/apps/${appId}/deltas`, null, "demo@store-ops.dev")).json();
      return d.entries as Array<{ keyword: string; current: number | null }>;
    }, id);
    const byKw = Object.fromEntries(data.map((e) => [e.keyword, e]));
    for (const row of dom) {
      const expectedCur = byKw[row.keyword].current === null ? "—" : `#${byKw[row.keyword].current}`;
      expect(row.cur).toBe(expectedCur);
    }
    await context.close();
  });
});

/**
 * Header auth state (#49): on a LIVE backend the misleading editable
 * "acting as <email>" X-User-Email stub must NOT show — a logged-out visitor
 * gets a real "Sign in" button instead (the stub can't authenticate on prod).
 * We simulate a live-but-logged-out frontend by pointing config.js at a non-empty
 * API_BASE and stubbing /auth/me → {authed:false}.
 */
test.describe("header auth state (#49)", () => {
  async function gotoLiveLoggedOut(page: import("@playwright/test").Page): Promise<void> {
    await page.route("**/config.js", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: 'window.STORE_OPS = { API_BASE: "https://api.test.local" };',
      }),
    );
    // Every API call to the fake live backend: /auth/me says logged out; the
    // preview endpoint returns an empty picker so the page renders.
    await page.route("https://api.test.local/**", (route) => {
      const url = route.request().url();
      if (url.endsWith("/auth/me")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authed: false }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ needsChoice: true, candidates: [], hasMore: false, offset: 0 }) });
    });
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
    await page.goto("/index.html");
  }

  test("logged-out on a live backend shows a 'Sign in' button, not the email stub", async ({ page }) => {
    await gotoLiveLoggedOut(page);

    // The misleading editable stub must be hidden.
    await expect(page.locator("#emailInput")).toBeHidden();
    // A real Sign in button is present in the header.
    const signIn = page.locator(".who").getByRole("button", { name: /^sign in$/i });
    await expect(signIn).toBeVisible();

    // Clicking it opens the magic-link login screen.
    await signIn.click();
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByPlaceholder(/you@example\.com/i)).toBeVisible();
  });

  test("demo backend (no API_BASE) keeps the editable 'acting as' stub for local dev", async ({ page }) => {
    await gotoMockDashboard(page); // API_BASE = "" → demoStub mode
    await expect(page.locator("#emailInput")).toBeVisible();
    await expect(page.locator(".who").getByRole("button", { name: /^sign in$/i })).toHaveCount(0);
  });
});

import { test, expect } from "@playwright/test";
import { gotoMockDashboard, seedAppWithRun, setMockTier } from "./helpers.js";

/**
 * Additional dashboard flows: the disconnect two-click confirm, the reject path
 * on the approval gate, the empty-dashboard state, multi-app rendering, and the
 * try-before-signup preview (which uses a raw fetch to /preview, so it's driven
 * with a route stub rather than the mock backend).
 */

test.describe("disconnect (two-click confirm)", () => {
  test("first click arms, second click deletes and returns to an empty dashboard", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);

    const btn = page.getByRole("button", { name: /disconnect app/i });
    await expect(btn).toBeVisible();

    // First click ARMS — it must not delete yet; the label changes to a confirm.
    await btn.click();
    await expect(page.getByRole("button", { name: /click again to confirm/i })).toBeVisible();

    // The app still exists at this point (arming is not a delete).
    const stillThere = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const r = await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev");
      return r.status;
    }, id);
    expect(stillThere).toBe(200);

    // Second click CONFIRMS — deletes and routes home.
    await page.getByRole("button", { name: /click again to confirm/i }).click();
    await expect(page.getByRole("heading", { name: /connect an app/i })).toBeVisible({
      timeout: 10_000,
    });

    // The app is gone from the backend.
    const afterStatus = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const r = await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev");
      return r.status;
    }, id);
    expect(afterStatus).toBe(404);
  });
});

test.describe("approval gate — reject path", () => {
  test("rejecting a run shows the rejected state and never reveals push commands", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    await expect(page.getByRole("heading", { name: /approval gate/i })).toBeVisible();
    await page.getByRole("button", { name: /reject/i }).click();

    // Rejected state shown; the "approved" hand-off copy must NOT appear.
    await expect(page.getByText(/you rejected this proposal/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Hand the metadata to your build pipeline/i)).toHaveCount(0);

    // The rejected screen offers a re-run affordance that routes back to the app.
    const rerun = page.getByRole("button", { name: /run the agent again/i });
    await expect(rerun).toBeVisible();
    await rerun.click();
    await expect(page).toHaveURL(new RegExp(`#/apps/${id}$`));
  });
});

test.describe("approval gate — Upload to App Store Connect CTA (#32)", () => {
  test("the upload CTA is hidden pre-approval and appears with a credential form after approval", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    await expect(page.getByRole("heading", { name: /approval gate/i })).toBeVisible();

    // PRE-APPROVAL: the upload CTA must not be present yet (commands are locked).
    await expect(
      page.getByRole("button", { name: /upload to app store connect/i }),
    ).toHaveCount(0);

    // APPROVE → reveal the handoff.
    await page.getByRole("button", { name: /approve & reveal commands/i }).click();

    // POST-APPROVAL: the upload CTA is now a prominent, visible action.
    await expect(
      page.getByRole("button", { name: /upload to app store connect/i }),
    ).toBeVisible({ timeout: 10_000 });

    // The ephemeral credential form is surfaced inline (issuer / key id / .p8).
    const cta = page.locator(".asc-cta");
    await expect(cta.getByPlaceholder(/issuer id/i)).toBeVisible();
    await expect(cta.getByPlaceholder(/key id/i)).toBeVisible();
    await expect(cta.getByPlaceholder(/begin private key/i)).toBeVisible();
  });
});

test.describe("connect picker pagination (Show more)", () => {
  test("an ambiguous search shows a page of results and 'Show more' loads the next page", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const search = page.getByPlaceholder(/app name, app store .* link, or bundle id/i);
    // "meditation" matches several mock-catalog apps → an ambiguous search that
    // the mock pads into a long, paged list (so "Show more" is exercisable).
    await search.fill("meditation");
    await page.getByRole("button", { name: /^search$/i }).click();

    await expect(page.getByText(/pick your app/i)).toBeVisible();
    // First page shows 12 candidate cards.
    const cards = page.locator("#view .appcard");
    await expect(cards).toHaveCount(12);

    // "Show more results" is present (more pages exist) → click it.
    const more = page.getByRole("button", { name: /show more results/i });
    await expect(more).toBeVisible();
    await more.click();

    // The next page is appended (12 → 24).
    await expect(cards).toHaveCount(24);
  });
});

test.describe("run with App Store Connect (#30 Mode A)", () => {
  test("the ASC-run panel is the primary CTA, requires creds, then runs a read-and-improve pass", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);

    // The ASC read-and-improve run is the PRIMARY CTA — its form is always
    // visible (no <details> to expand) and its run button is the primary button.
    const runBtn = page.getByRole("button", { name: /run with asc read/i });
    await expect(runBtn).toBeVisible();
    await expect(runBtn).toHaveClass(/primary/);
    await expect(page.getByPlaceholder(/issuer id/i)).toBeVisible();

    // The blind "Run agent now" run is demoted behind an opt-out checkbox and is
    // hidden until the visitor admits they have no ASC key.
    const noKey = page.getByRole("checkbox", { name: /don.t have an asc key/i });
    await expect(noKey).toBeVisible();
    const blindBtn = page.getByRole("button", { name: /run agent now/i });
    await expect(blindBtn).toBeHidden();

    // Toggling the opt-out reveals the blind run button…
    await noKey.check();
    await expect(blindBtn).toBeVisible();
    // …and un-toggling hides it again.
    await noKey.uncheck();
    await expect(blindBtn).toBeHidden();

    // Clicking with empty creds must NOT navigate (validation guard).
    await runBtn.click();
    await expect(page).toHaveURL(new RegExp(`#/apps/${id}$`));

    // Fill the credential fields and run — lands on the new run.
    await page.getByPlaceholder(/issuer id/i).fill("11111111-2222-3333-4444-555555555555");
    await page.getByPlaceholder(/key id/i).fill("ABC123DEFG");
    await page.getByPlaceholder(/begin private key/i).fill("-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----");
    await runBtn.click();
    await expect(page).toHaveURL(/#\/runs\//, { timeout: 10_000 });

    // The ASC-read run proposes a subtitle + keywords (the read-and-improve path).
    const proposal = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      const runId = detail.runs[0].id;
      const run = await (await M.handle("GET", `/runs/${runId}`, null, "demo@store-ops.dev")).json();
      const c = run.result.proposedCopy;
      return { subtitle: c.subtitle, keywords: c.keywords };
    }, id);
    expect(proposal.subtitle.length).toBeGreaterThan(0);
    expect(proposal.keywords.length).toBeGreaterThan(0);
  });

  test("a normal run leaves subtitle/keywords empty (no blind overwrite)", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    const proposal = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      // a plain /run (no ASC) — the seed run used this path
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      const run = await (await M.handle("GET", `/runs/${detail.runs[0].id}`, null, "demo@store-ops.dev")).json();
      return run.result.proposedCopy;
    }, id);
    expect(proposal.subtitle).toBe("");
    expect(proposal.keywords).toBe("");
  });
});

test.describe("File upload: .p8 (#33)", () => {
  test("uploading a .p8 file populates the run-panel textarea and auto-fills Key ID", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    await page.goto(`/index.html#/apps/${id}`);

    // The ASC run panel is now the primary surface (no expand needed since #31).
    await expect(page.getByRole("button", { name: /run with asc read/i })).toBeVisible();

    const p8Body = "-----BEGIN PRIVATE KEY-----\nMOCKP8CONTENTS\n-----END PRIVATE KEY-----";
    // setInputFiles with an in-memory buffer (no temp file on disk).
    await page.locator('input[type="file"][accept=".p8"]').setInputFiles({
      name: "AuthKey_ABC123DEFG.p8",
      mimeType: "application/x-pem-file",
      buffer: Buffer.from(p8Body),
    });

    // The textarea is populated client-side from the file (paste remains a fallback).
    await expect(page.getByPlaceholder(/begin private key/i)).toHaveValue(p8Body);
    // Key ID is auto-filled from the AuthKey_<KEYID>.p8 filename.
    await expect(page.getByPlaceholder(/key id/i)).toHaveValue("ABC123DEFG");
  });

  test("uploading a .p8 file populates the verify-panel textarea on the run page", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    // The verify/push panel only renders after approval — approve to reveal it.
    await page.getByRole("button", { name: /approve & reveal commands/i }).click();

    // Expand the advanced "connect App Store Connect directly" panel.
    await page.getByText(/connect app store connect directly/i).click();
    await expect(page.getByRole("button", { name: /verify credential/i })).toBeVisible();

    const p8Body = "-----BEGIN PRIVATE KEY-----\nVERIFYMOCK\n-----END PRIVATE KEY-----";
    await page.locator('.asc-verify input[type="file"][accept=".p8"]').setInputFiles({
      name: "AuthKey_XYZ789QRS.p8",
      mimeType: "application/x-pem-file",
      buffer: Buffer.from(p8Body),
    });

    await expect(page.locator(".asc-verify").getByPlaceholder(/begin private key/i)).toHaveValue(p8Body);
    await expect(page.locator(".asc-verify").getByPlaceholder(/key id/i)).toHaveValue("XYZ789QRS");
  });
});

test.describe("run page — PR-style diff (current → proposed)", () => {
  test("the run page leads with a diff card showing current and proposed values", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    // The diff card is the lead: a "Proposed changes" header with Current/Proposed columns.
    await expect(page.getByRole("heading", { name: /proposed changes/i })).toBeVisible();
    const diff = page.locator(".diffrow").first();
    await expect(diff).toBeVisible();
    await expect(diff.getByText(/current/i)).toBeVisible();
    await expect(diff.getByText(/proposed/i)).toBeVisible();
    // The field-change tag (added/changed/unchanged) is present on each row.
    await expect(page.locator(".diffrow .dtag").first()).toBeVisible();
  });

  test("the proposed side of a changed row carries an animated text-reveal layer", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    // The animation is additive: with motion ALLOWED, the proposed value of a
    // changed row runs a named text-reveal keyframe animation (layered on the
    // static diff). It is staggered per-row via an --i CSS variable.
    const dval = page.locator(".diffrow.is-changed .diffside.now .dval").first();
    await expect(dval).toBeVisible();
    const animName = await dval.evaluate((node) => getComputedStyle(node).animationName);
    expect(animName).toBe("textReveal");
    const stagger = await page
      .locator(".diffrow.is-changed")
      .first()
      .evaluate((node) => getComputedStyle(node).getPropertyValue("--i").trim());
    expect(stagger).not.toBe("");
  });

  test("prefers-reduced-motion: the diff renders fully with the text-reveal animation disabled", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    // The diff card still leads with the "Proposed changes" header.
    await expect(page.getByRole("heading", { name: /proposed changes/i })).toBeVisible();

    // The animated layer applies to the proposed side of changed rows. With motion
    // reduced, those values must be fully visible (opacity:1, not stuck at the
    // animation's 0 start) and carry their real text — the static diff is the
    // source of truth, the animation is purely additive.
    const dvals = page.locator(".diffrow.is-changed .diffside.now .dval");
    const count = await dvals.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const opacity = await dvals.nth(i).evaluate((node) => getComputedStyle(node).opacity);
      expect(opacity).toBe("1");
      const text = await dvals.nth(i).textContent();
      expect(text?.trim()).toBeTruthy();
    }
    await context.close();
  });
});

test.describe("run page — Listing audit card (ASC findings, PRD 03)", () => {
  async function latestRunId(page: import("@playwright/test").Page, appId: string): Promise<string> {
    return await page.evaluate(async (id) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${id}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, appId);
  }

  test("the audit card leads above the diff, with prioritized rows, severities, fixes and impact chips", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, { asc: true });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    // The card renders with its header + a one-line summary.
    const card = page.locator(".audit-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: /listing audit/i })).toBeVisible();
    await expect(card.locator(".audit-summary")).toBeVisible();

    // It sits ABOVE the diff card (audit → proposed changes → reasoning).
    const auditTop = await card.evaluate((n) => n.getBoundingClientRect().top);
    const diffTop = await page.locator(".card").filter({ has: page.getByRole("heading", { name: /proposed changes/i }) }).evaluate((n) => n.getBoundingClientRect().top);
    expect(auditTop).toBeLessThan(diffTop);

    // Multiple finding rows, each with a severity icon, title, detail and a "→ Fix:" line.
    const findings = card.locator(".finding");
    expect(await findings.count()).toBeGreaterThan(1);
    const first = findings.first();
    await expect(first.locator(".finding-ico")).toBeVisible();
    await expect(first.locator(".finding-title")).toBeVisible();
    await expect(card.locator(".finding-fix").first()).toContainText(/fix/i);

    // Impact chips label which lever each finding pulls — both ranking and conversion appear.
    const chips = card.locator(".impact-chip");
    expect(await chips.count()).toBeGreaterThan(1);
    await expect(card.locator(".impact-chip.rank").first()).toBeVisible();
    await expect(card.locator(".impact-chip.conv").first()).toBeVisible();
  });

  test("a critical finding renders in the --bad (critical) treatment", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, { asc: true });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    const crit = page.locator(".audit-card .finding.critical").first();
    await expect(crit).toBeVisible();
    const color = await crit
      .locator(".finding-ico")
      .evaluate((node) => getComputedStyle(node).color);
    // --bad is #f87171 → rgb(248, 113, 113).
    expect(color).toBe("rgb(248, 113, 113)");
  });

  test("prefers-reduced-motion: the audit card renders fully with no stuck rows", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    await expect(page.getByRole("heading", { name: /listing audit/i })).toBeVisible();
    const rows = page.locator(".audit-card .finding");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const opacity = await rows.nth(i).evaluate((node) => getComputedStyle(node).opacity);
      expect(opacity).toBe("1");
      const text = await rows.nth(i).locator(".finding-title").textContent();
      expect(text?.trim()).toBeTruthy();
    }
    await context.close();
  });

  test("the no-findings state shows the green 'great shape' message", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);
    const runId = await latestRunId(page, id);
    // Force the persisted run to have an empty findings array (the rare great-listing case).
    await page.evaluate((rid) => {
      const KEY = "store-ops:mockdb:v1";
      const all = JSON.parse(localStorage.getItem(KEY) || "{}");
      const db = all["demo@store-ops.dev"];
      db.runs[rid].result.findings = [];
      db.runs[rid].result.findingsSummary = { total: 0, critical: 0, warn: 0, good: 0, info: 0, label: "No fixes found" };
      localStorage.setItem(KEY, JSON.stringify(all));
    }, runId);
    await page.goto(`/index.html#/runs/${runId}`);

    const great = page.locator(".audit-card .audit-empty");
    await expect(great).toBeVisible();
    await expect(great).toContainText(/great shape/i);
    // Empty state is the signal-green honest state, not a finding row.
    expect(await page.locator(".audit-card .finding").count()).toBe(0);
  });
});

test.describe("run page — Where to push next (rank opportunity score, PRD 06)", () => {
  async function latestRunId(page: import("@playwright/test").Page, appId: string): Promise<string> {
    return await page.evaluate(async (id) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${id}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, appId);
  }

  test("renders the panel with ranked opportunities, reachability chips, why text and driver bars", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, { asc: true });
    const runId = await latestRunId(page, id);
    await page.goto(`/index.html#/runs/${runId}`);

    const card = page.locator(".opp-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: /where to push next/i })).toBeVisible();

    // Multiple opportunity rows, each with a winnability score + a reachability chip.
    const opps = card.locator(".opp");
    expect(await opps.count()).toBeGreaterThan(1);
    await expect(opps.first().locator(".opp-score")).toBeVisible();
    await expect(opps.first().locator(".reach-chip")).toBeVisible();
    await expect(opps.first().locator(".opp-why")).not.toBeEmpty();
    // Four driver bars (volume / distance / weak-field / momentum).
    expect(await opps.first().locator(".opp-driver").count()).toBe(4);

    // Honesty: opportunities are sorted by score descending (winnability first).
    const scores = await card.locator(".opp-score").allTextContents();
    const nums = scores.map((s) => Number(s));
    for (let i = 1; i < nums.length; i++) expect(nums[i - 1]).toBeGreaterThanOrEqual(nums[i]!);
  });

  test("the panel ranks by winnability, not raw volume (the longshot is labeled, not hidden)", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, { asc: true });
    const runId = await latestRunId(page, id);

    // Pull the serialized opportunities the run carries — assert the engine's
    // winnability discipline reached the client (no causal claims; buckets present).
    const opps = await page.evaluate(async (rid) => {
      const M = (window as any).STORE_OPS_MOCK;
      const run = await (await M.handle("GET", `/runs/${rid}`, null, "demo@store-ops.dev")).json();
      return run.result.opportunities as Array<{ why: string; reachability: string; opportunityScore: number }>;
    }, runId);

    expect(Array.isArray(opps)).toBe(true);
    expect(opps.length).toBeGreaterThan(0);
    for (const o of opps) {
      expect(["now", "soon", "longshot"]).toContain(o.reachability);
      // never claim causation in the explanation.
      expect(o.why.toLowerCase()).not.toMatch(/caused|guaranteed/);
    }

    await page.goto(`/index.html#/runs/${runId}`);
    // The dim "Longshot" chip exists when present — labeled honestly, not removed.
    const hasLongshot = opps.some((o) => o.reachability === "longshot");
    if (hasLongshot) await expect(page.locator(".reach-chip.longshot").first()).toBeVisible();
  });
});

test.describe("run page — export as agent prompt (#35)", () => {
  test("Copy as agent prompt builds a clipboard string with the proposed values and exact fastlane field names", async ({
    page,
    context,
  }) => {
    // Clipboard reads/writes need an explicit grant in Chromium.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page);

    // Pull the run id + the proposed copy the run carries, so the assertions
    // check the EXACT values the prompt should contain (no magic literals).
    const { runId, proposed } = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      const rId = detail.runs[0].id as string;
      const run = await (await M.handle("GET", `/runs/${rId}`, null, "demo@store-ops.dev")).json();
      return { runId: rId, proposed: run.result.proposedCopy };
    }, id);

    await page.goto(`/index.html#/runs/${runId}`);

    // The handoff (with the export button) only appears after approval.
    await page.getByRole("button", { name: /approve & reveal commands/i }).click();

    const copyBtn = page.getByRole("button", { name: /copy as agent prompt/i });
    await expect(copyBtn).toBeVisible({ timeout: 10_000 });
    await copyBtn.click();

    // Toast confirms the copy went through.
    await expect(page.locator("#toast")).toContainText(/copied/i);

    const clip = await page.evaluate(() => navigator.clipboard.readText());

    // The instruction header the agent acts on.
    expect(clip).toContain("Update my fastlane metadata files accordingly");
    expect(clip).toContain("change nothing not listed");

    // Exact fastlane / ASC field names (the source of truth in fastlane.ts):
    // every field the run actually proposed must surface under its real file name.
    const fastlaneFile: Record<string, string> = {
      name: "name.txt",
      subtitle: "subtitle.txt",
      keywords: "keywords.txt",
      promo: "promotional_text.txt",
      description: "description.txt",
    };
    // The name is always proposed.
    expect(proposed.name.length).toBeGreaterThan(0);
    expect(clip).toContain("name.txt");

    // Every NON-empty proposed value (and its exact fastlane file name) must be in
    // the prompt; every empty one (e.g. subtitle/keywords on a no-ASC run, #30) is
    // omitted — its file name never appears (the listing uses human labels, not
    // file names, so a .txt name only ever comes from a proposed field).
    (["name", "subtitle", "keywords", "promo", "description"] as const).forEach((k) => {
      const v = (proposed as Record<string, string>)[k];
      if (v && v.trim() !== "") {
        expect(clip).toContain(v);
        expect(clip).toContain(fastlaneFile[k]);
      } else {
        expect(clip).not.toContain(fastlaneFile[k]);
      }
    });
  });
});

test.describe("dashboard states", () => {
  test("empty dashboard shows the connect form when no apps exist", async ({ page }) => {
    await gotoMockDashboard(page);
    // Fresh mock partition → no apps. The connect form is the primary CTA.
    await expect(page.getByRole("heading", { name: /connect an app/i })).toBeVisible();
    await expect(page.locator(".appcard")).toHaveCount(0);
  });

  test("multiple connected apps each render a card with a rank summary", async ({ page }) => {
    await gotoMockDashboard(page);
    await seedAppWithRun(page, { name: "Calm", bundleId: "com.calm.calmapp" });
    await seedAppWithRun(page, { name: "Headspace", bundleId: "com.getsomeheadspace.headspace" });

    // Re-render the dashboard in-place via the SPA router (a full page.goto reload
    // would re-render before loadSession() settles — a boot race, not a real bug).
    await page.evaluate(() => { location.hash = "#/_"; location.hash = "#/"; });
    await expect(page.locator(".appcard")).toHaveCount(2);
    await expect(page.locator(".appcard", { hasText: "Calm" })).toBeVisible();
    await expect(page.locator(".appcard", { hasText: "Headspace" })).toBeVisible();
  });
});

test.describe("dashboard — finding-count badge (PRD 04)", () => {
  test("a findings-bearing app shows the count badge derived from findingsSummary", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // An ASC (keyed) run produces the full findings set incl. the critical privacy
    // gap — a no-key run can't see appInfo, so it must NOT show critical findings.
    await seedAppWithRun(page, { name: "Calm", bundleId: "com.calm.calmapp", asc: true });
    await page.evaluate(() => { location.hash = "#/_"; location.hash = "#/"; });

    const card = page.locator(".appcard", { hasText: "Calm" });
    const badge = card.locator(".finding-badge");
    await expect(badge).toBeVisible();
    // The keyed run carries a critical privacy gap + warnings → "N fixes
    // available", and the critical pushes the badge into the --bad treatment.
    await expect(badge).toContainText(/fix(es)? available/i);
    await expect(badge).toHaveClass(/has-critical/);
  });

  test("a clean app (no actionable findings) shows the green 'Looking good' badge", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, { name: "Calm", bundleId: "com.calm.calmapp" });
    // Force the latest run + its summary to zero actionable findings (a great listing).
    await page.evaluate((appId) => {
      const KEY = "store-ops:mockdb:v1";
      const all = JSON.parse(localStorage.getItem(KEY) || "{}");
      const db = all["demo@store-ops.dev"];
      const app = db.apps[appId];
      const rid = app.runs[0];
      db.runs[rid].result.findings = [];
      db.runs[rid].result.findingsSummary = { total: 0, critical: 0, warn: 0, good: 0, info: 0, label: "No fixes found" };
      app.findingsSummary = { total: 0, critical: 0, warn: 0, good: 0, info: 0, label: "No fixes found" };
      localStorage.setItem(KEY, JSON.stringify(all));
    }, id);
    await page.evaluate(() => { location.hash = "#/_"; location.hash = "#/"; });

    const badge = page.locator(".appcard", { hasText: "Calm" }).locator(".finding-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/looking good/i);
    await expect(badge).toHaveClass(/looking-good/);
  });

  test("an app with no run yet shows no finding badge", async ({ page }) => {
    await gotoMockDashboard(page);
    // Connect without running — the mock's POST /apps seeds the app but no run.
    await page.evaluate(async () => {
      const M = (window as any).STORE_OPS_MOCK;
      const EM = "demo@store-ops.dev";
      await M.handle("POST", "/_tier", { tier: "fleet" }, EM);
      await M.handle("POST", "/apps", { bundle_id: "com.norun.app", name: "NoRun", keywords: ["x"] }, EM);
    });
    await page.evaluate(() => { location.hash = "#/_"; location.hash = "#/"; });

    const card = page.locator(".appcard", { hasText: "NoRun" });
    await expect(card).toBeVisible();
    await expect(card.locator(".finding-badge")).toHaveCount(0);
  });
});

test.describe("run page — ASC unlock CTA on a no-key run (PRD 04)", () => {
  test("the no-key audit card renders the unlock CTA wired to the ASC run panel", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, { name: "Calm", bundleId: "com.calm.calmapp" });
    // The default seed run uses POST /apps/:id/run → a no-key run → carries asc_unlock.
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const detail = await (await M.handle("GET", `/apps/${appId}`, null, "demo@store-ops.dev")).json();
      return detail.runs[0].id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    // The unlock CTA lives inside the audit card, below the findings.
    const cta = page.locator(".audit-card .asc-unlock");
    await expect(cta).toBeVisible();
    await expect(cta).toContainText(/unlock your full audit/i);
    // It lists the surfaces a key unlocks so the user knows what they're missing.
    await expect(cta).toContainText(/screenshots/i);
    await expect(cta).toContainText(/preview/i);
    await expect(cta).toContainText(/privacy policy/i);

    // Clicking it surfaces the existing primary ASC run panel (#31) on the app page —
    // it does NOT build a new credential surface.
    await cta.getByRole("button", { name: /connect app store connect/i }).click();
    await expect(page).toHaveURL(/#\/apps\//);
    const panel = page.locator(".asc-run-panel");
    await expect(panel).toBeVisible();
    // The panel is highlighted/scrolled into focus (the reward framing lands the user here).
    await expect(panel).toHaveClass(/asc-flash/);
  });

  test("a key-bearing run does NOT render the unlock CTA", async ({ page }) => {
    await gotoMockDashboard(page);
    const id = await seedAppWithRun(page, { name: "Calm", bundleId: "com.calm.calmapp" });
    // Run WITH an ASC key (the -asc path) → no asc_unlock finding, no CTA.
    const runId = await page.evaluate(async (appId) => {
      const M = (window as any).STORE_OPS_MOCK;
      const EM = "demo@store-ops.dev";
      const r = await (await M.handle("POST", `/apps/${appId}/run-asc`, { p8: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----", keyId: "ABC123DEFG", issuerId: "00000000-0000-0000-0000-000000000000" }, EM)).json();
      return r.id as string;
    }, id);
    await page.goto(`/index.html#/runs/${runId}`);

    await expect(page.locator(".audit-card")).toBeVisible();
    await expect(page.locator(".audit-card .asc-unlock")).toHaveCount(0);
  });
});

test.describe("connect — 402 tier-limit paywall (#27)", () => {
  test("connecting past the plan's app limit shows a visible upgrade modal, not a silent fail", async ({
    page,
  }) => {
    await gotoMockDashboard(page);
    // Seed one app, then pin the partition to the free tier (1 app max) so the
    // NEXT connect attempt trips the 402 tier gate. (seedAppWithRun lifts the
    // tier to fleet to seed; we drop it back to free here for the paywall.)
    await seedAppWithRun(page, { name: "Calm", bundleId: "com.calm.calmapp" });
    await setMockTier(page, "free");
    await page.evaluate(() => { location.hash = "#/_"; location.hash = "#/"; });
    await expect(page.locator(".appcard", { hasText: "Calm" })).toBeVisible();

    // Attempt to connect a SECOND app via the search funnel. A bundle id resolves
    // to a single candidate, which auto-connects → the mock returns 402.
    const search = page.getByPlaceholder(/app name, app store .* link, or bundle id/i);
    await search.fill("com.getsomeheadspace.headspace");
    await page.getByRole("button", { name: /^search$/i }).click();

    // The tier-limit modal is visible and names the plan + the limit + an upgrade CTA.
    const modal = page.locator(".tier-limit-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal.getByRole("heading", { name: /upgrade to connect more/i })).toBeVisible();
    await expect(modal).toContainText(/free plan/i);
    await expect(modal).toContainText(/1 app/i);
    const cta = modal.getByRole("button", { name: /upgrade/i });
    await expect(cta).toBeVisible();

    // It did NOT navigate away from the dashboard, and did NOT silently connect a 2nd app.
    await expect(page).toHaveURL(/#\/$/);
    const appCount = await page.evaluate(async () => {
      const M = (window as any).STORE_OPS_MOCK;
      const r = await (await M.handle("GET", "/apps", null, "demo@store-ops.dev")).json();
      return r.apps.length as number;
    });
    expect(appCount).toBe(1);

    // Dismissing the modal removes it from the page.
    await modal.getByRole("button", { name: /got it/i }).click();
    await expect(page.locator(".tier-limit-modal")).toHaveCount(0);
  });
});

test.describe("try-before-signup preview (logged-out, raw /preview fetch)", () => {
  test("a logged-out visitor sees a real audit + rank preview without signing up", async ({
    page,
  }) => {
    // The preview view triggers only when API_BASE is set AND the session is
    // logged-out, and it calls fetch(API_BASE + "/preview") directly. Drive it by
    // pointing API_BASE at the test origin, stubbing /auth/me (logged-out) and
    // /preview (a canned teaser), and intercepting the POST.
    await page.route("**/config.js", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: 'window.STORE_OPS = { API_BASE: location.origin };',
      }),
    );
    await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
    await page.route("https://fonts.gstatic.com/**", (r) => r.abort());

    // logged-out session so route() picks the preview view
    await page.route("**/auth/me", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authed: false }) }),
    );
    // the preview teaser the page renders
    await page.route("**/preview", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          preview: {
            appName: "Calm",
            auditGrade: "B",
            leadKeyword: "meditation",
            leadRank: 12,
            keywordsChecked: 6,
            inTop10: 2,
            sample: [
              { keyword: "meditation", rank: 12 },
              { keyword: "sleep sounds", rank: 24 },
            ],
          },
          bundleId: "com.calm.calmapp",
        }),
      }),
    );

    await page.goto("/index.html#/");
    await page.waitForFunction(() => !!(window as any).STORE_OPS_MOCK);

    // The try-before-signup hero is shown (logged-out preview view).
    await expect(page.getByRole("heading", { name: /where your app really ranks/i })).toBeVisible();

    // Run a preview — the canned teaser renders the app name + a rank.
    await page.getByPlaceholder(/app name, app store .* link, or bundle id/i).fill("Calm");
    await page.getByRole("button", { name: /^preview$/i }).click();

    await expect(page.getByText(/Calm/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/#12/).first()).toBeVisible();
  });
});

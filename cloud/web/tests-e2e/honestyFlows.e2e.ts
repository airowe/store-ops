import { test, expect } from "@playwright/test";
import { installMocks, type MockOverrides } from "./mocks.js";

/**
 * The honesty invariants, end to end (#369).
 *
 * Retiring the legacy dashboard (#356 Phase 3) deleted 114 specs whose subject
 * was cloud/public. Several of them pinned promises the PRODUCT still makes —
 * "nothing auto-watched", "metadata only", "deletes honestly" — so the promises
 * outlived the tests that guarded them. These re-establish that guard against
 * the new app.
 *
 * Deliberately NOT a 1:1 port. Component tests already cover these cards in
 * isolation (556 of them). What only an E2E can prove is that the real router,
 * real React Query cache and real chrome COMPOSE into the flow a customer walks
 * — a card that is honest in a test harness but reached through a route that
 * pre-confirms, caches staleley or leaks key material is still a broken promise.
 *
 * Each spec below is written against a promise in user-facing copy, not against
 * an implementation detail, so it keeps its meaning through a redesign.
 */

test.describe("stored credentials: metadata only, and delete is honest", () => {
  /**
   * The copy on /settings says: "Metadata only — key material is never shown,
   * not even to you. Delete is immediate."
   *
   * Both halves are load-bearing. The first is the product's core security
   * claim; the second is a claim about what a button DOES.
   */
  test("a stored key renders as metadata and never leaks key material", async ({ page }) => {
    await installMocks(page, {
      credentials: {
        enabled: true,
        credentials: [
          {
            id: "cred1",
            appId: null,
            kind: "asc",
            keyId: "KID123",
            issuerId: "issuer-abc",
            createdAt: "2026-06-01T00:00:00.000Z",
            lastUsedAt: "2026-07-01T00:00:00.000Z",
            kekVersion: 1,
          },
        ],
      },
    });
    await page.goto("/settings");

    // The metadata we DO show: kind, key id, dates.
    const row = page.getByTestId("delete-asc").locator("xpath=ancestor::div[@class='pref-row']");
    await expect(row).toContainText("ASC · KID123");
    await expect(row).toContainText("added 2026-06-01");
    await expect(row).toContainText("last used 2026-07-01");

    // The promise: nothing resembling key material anywhere in the document.
    // Asserted over the whole page body, not the row, so a leak into a debug
    // panel, a title attribute or a stray card is caught too.
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("BEGIN PRIVATE KEY");
    expect(body).not.toMatch(/-----BEGIN/);
    // the issuer id is metadata and MAY show; the secret must not.
    expect(body).not.toContain("SUPER_SECRET_P8_BODY");
  });

  test("delete removes the key immediately, with no lingering optimistic row", async ({ page }) => {
    /**
     * "Delete is immediate" — the honest failure mode here is a UI that hides
     * the row while the server still holds the key. So the mock only reports
     * the key gone AFTER the DELETE is actually received: if the app removed
     * the row optimistically without the server agreeing, the refetch would
     * put it back and this spec fails.
     */
    let deleted = false;
    await installMocks(page, {
      credentials: () =>
        deleted
          ? { enabled: true, credentials: [] }
          : {
              enabled: true,
              credentials: [
                {
                  id: "cred1",
                  appId: null,
                  kind: "asc",
                  keyId: "KID123",
                  issuerId: "issuer-abc",
                  createdAt: "2026-06-01T00:00:00.000Z",
                  lastUsedAt: null,
                  kekVersion: 1,
                },
              ],
            },
    });
    await page.route(
      (url) => /\/account\/credentials\/asc/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== "DELETE") return route.fallback();
        deleted = true;
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
    );

    await page.goto("/settings");
    await expect(page.getByTestId("delete-asc")).toBeVisible();
    await page.getByTestId("delete-asc").click();

    // The row is gone, and the empty state is the honest one.
    await expect(page.getByTestId("delete-asc")).toHaveCount(0);
    await expect(page.getByTestId("no-keys")).toBeVisible();
    expect(deleted, "the app must actually call DELETE, not just hide the row").toBe(true);
  });
});

test.describe("competitors: nothing is auto-watched", () => {
  /**
   * The strongest honesty claim on the competitor surface, and the one a
   * component test can least prove: watching is PER-PAIR, so confirming a rival
   * for one app must never silently confirm it for another. That is a fact
   * about shared cache state across two rows on one route — precisely the class
   * of bug that passes in isolation.
   */
  test("a suggested rival is not watched until confirmed, and confirming is per-pair", async ({ page }) => {
    const confirmed: string[] = [];
    await installMocks(page, {
      portfolioCompetitors: () => ({
        rivals: [
          {
            key: "c1",
            name: "RainRadar",
            pairs: [
              {
                app_id: "app1",
                app_name: "Weatherly",
                status: confirmed.includes("app1") ? "confirmed" : "suggested",
                source: "discovered",
              },
              {
                app_id: "app2",
                app_name: "Skywatch",
                status: confirmed.includes("app2") ? "confirmed" : "suggested",
                source: "discovered",
              },
            ],
          },
        ],
      }),
    });
    await page.route(
      (url) => /\/apps\/(app1|app2)\/competitors\/c1\/confirm$/.test(url.pathname),
      async (route) => {
        const m = /\/apps\/(app1|app2)\//.exec(new URL(route.request().url()).pathname);
        if (m) confirmed.push(m[1]!);
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
    );

    await page.goto("/competitors");

    // Both pairs start as SUGGESTIONS — nothing is watched on arrival.
    await expect(page.getByTestId("pcomp-suggestion-c1-app1")).toBeVisible();
    await expect(page.getByTestId("pcomp-suggestion-c1-app2")).toBeVisible();
    expect(confirmed, "arriving on the page must not confirm anything").toEqual([]);

    // Confirm the rival for app1 only.
    await page.getByTestId("pcomp-suggestion-confirm-c1-app1").click();

    // The rival is now watched, so it moves OUT of the flat suggested grid and
    // into its own card — where its still-unconfirmed pairs live as inline
    // chips (portfolioCompetitorsModel.suggestions: "a rival watched somewhere
    // keeps its unconfirmed pairs inside its own card"). Both pairs therefore
    // render as chips, and the promise is about their STATE, not their section.
    await expect(page.getByTestId("pcomp-pair-c1-app1")).toHaveAttribute("data-state", "confirmed");
    await expect(page.getByTestId("pcomp-pair-c1-app2")).toHaveAttribute("data-state", "suggested");
    // app2 still offers a confirm — i.e. it was not swept along with app1.
    await expect(page.getByTestId("pcomp-confirm-c1-app2")).toBeVisible();
    await expect(page.getByTestId("pcomp-stop-c1-app1")).toBeVisible();
    expect(confirmed, "confirming app1 must not also confirm app2").toEqual(["app1"]);
  });

  test("dismissing a suggestion removes it without watching anything", async ({ page }) => {
    const calls: string[] = [];
    let dismissed = false;
    await installMocks(page, {
      portfolioCompetitors: () => ({
        rivals: dismissed
          ? []
          : [
              {
                key: "c1",
                name: "RainRadar",
                pairs: [
                  { app_id: "app1", app_name: "Weatherly", status: "suggested", source: "discovered" },
                ],
              },
            ],
      }),
    });
    await page.route(
      (url) => /\/apps\/app1\/competitors\/c1/.test(url.pathname),
      async (route) => {
        const p = new URL(route.request().url()).pathname;
        calls.push(`${route.request().method()} ${p}`);
        dismissed = true;
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
    );

    await page.goto("/competitors");
    await expect(page.getByTestId("pcomp-suggestion-c1-app1")).toBeVisible();
    await page.getByTestId("pcomp-suggestion-dismiss-c1-app1").click();

    await expect(page.getByTestId("pcomp-suggestion-c1-app1")).toHaveCount(0);
    // Dismiss must never route through confirm — the whole point is that
    // declining a suggestion cannot start watching it.
    expect(calls.some((c) => c.includes("/confirm"))).toBe(false);
    expect(calls.length, "dismiss should hit the API exactly once").toBe(1);
  });
});

test.describe("run approval: approving is not shipping", () => {
  /**
   * The product's central promise: "It never pushes. Every run ends at your
   * approval." An approved run must read as approved and hand off — it must
   * never claim to have shipped, and it must not present itself as pushed
   * merely because the approve call succeeded.
   *
   * happyPath.e2e.ts covers the success path. These cover the two ways the
   * promise breaks: overclaiming after approve, and the pre-approval state
   * asserting something was already done.
   */
  test("a pending run claims nothing about having pushed", async ({ page }) => {
    await installMocks(page);
    await page.goto("/runs/run1");
    await expect(page.getByRole("heading", { name: "Proposed changes" })).toBeVisible();

    const body = await page.locator("body").innerText();
    // A run awaiting approval must not describe itself in the past tense.
    expect(body).not.toMatch(/\bShipped\b/);
    expect(body).not.toMatch(/\bPushed to the App Store\b/);
    // and the decision is still open
    await expect(page.getByTestId("approve")).toBeVisible();
    await expect(page.getByTestId("reject")).toBeVisible();
  });

  test("approving with push commands hands off — it does not claim to have run them", async ({ page }) => {
    /**
     * The riskiest overclaim: approve returns pushCommands (the escape-hatch
     * CLI handoff, #179). Rendering those must read as "here is what to run",
     * never as "we ran it".
     */
    await installMocks(page);
    await page.route(
      (url) => url.pathname === "/runs/run1/approve",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "run1",
            status: "approved",
            pushCommands: ["shipaso push --run run1"],
          }),
        }),
    );

    await page.goto("/runs/run1");
    await page.getByTestId("approve").click();

    await expect(page.getByTestId("run-status")).toContainText("Approved");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\bShipped\b/);
    expect(body).not.toMatch(/\bwe pushed\b/i);
    expect(body).not.toMatch(/\bpushed to (the )?App Store\b/i);
  });
});

/**
 * The WebMCP surface in a REAL browser.
 *
 * These are the assertions jsdom cannot make. Chromium here has no WebMCP (it
 * ships behind a flag in 146), so this file pins the two things that must be
 * true regardless: the page degrades honestly when the API is absent, and the
 * approval boundary holds against the attack an agent would actually mount —
 * a scripted click and a scripted fetch, both issued from the page's own
 * context with the user's own session.
 */
import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks.js";

test.describe("WebMCP surface", () => {
  test("the tools panel is always visible — there is no Human/Agent toggle", async ({ page }) => {
    await installMocks(page);
    await page.goto("/runs/run1");
    await expect(page.getByTestId("webmcp-panel")).toBeVisible();
    // A toggle would ask the visitor to declare something the page cannot
    // verify. Nothing offers that choice.
    await expect(page.getByRole("button", { name: /agent|human/i })).toHaveCount(0);
  });

  test("says WebMCP is unavailable rather than showing an empty tool list", async ({ page }) => {
    await installMocks(page);
    await page.goto("/runs/run1");
    // Chromium in CI has no WebMCP model context, so this is the honest branch.
    await expect(page.getByTestId("webmcp-unsupported")).toBeVisible();
    await expect(page.getByTestId("webmcp-count")).toHaveCount(0);
  });

  test("the panel states that no tool can approve", async ({ page }) => {
    await page.addInitScript(() => {
      // Stand in for a WebMCP browser so the full panel renders.
      (navigator as unknown as { modelContext: unknown }).modelContext = {
        registerTool: () => ({ unregister: () => {} }),
        unregisterTool: () => {},
      };
    });
    await installMocks(page);
    await page.goto("/runs/run1");
    await expect(page.getByTestId("webmcp-boundary")).toContainText(/no tool here can approve/i);
    await expect(page.getByTestId("webmcp-count")).toBeVisible();
  });

  test("registers this route's tools and swaps them on navigation", async ({ page }) => {
    await page.addInitScript(() => {
      const names: string[] = [];
      (window as unknown as { __tools: string[] }).__tools = names;
      (navigator as unknown as { modelContext: unknown }).modelContext = {
        registerTool: (t: { name: string }) => {
          names.push(t.name);
          return { unregister: () => names.splice(names.indexOf(t.name), 1) };
        },
        unregisterTool: (n: string) => names.splice(names.indexOf(n), 1),
      };
    });
    await installMocks(page);
    await page.goto("/runs/run1");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __tools: string[] }).__tools))
      .toContain("draft_alternative");

    await page.goto("/dashboard");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __tools: string[] }).__tools))
      .not.toContain("draft_alternative");
  });

  test("THE BOUNDARY: a scripted click cannot approve, though a real one can", async ({ page }) => {
    await installMocks(page);
    const approvals: string[] = [];
    await page.route(
      (url) => url.pathname === "/runs/run1/approve",
      (route) => {
        approvals.push(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "run1", status: "approved", pushCommands: [] }),
        });
      },
    );
    await page.goto("/runs/run1");
    await expect(page.getByTestId("approve")).toBeVisible();

    // The attack: exactly what an agent in the page can do — call click() on the
    // real button, from the real session. The dispatched event is untrusted.
    await page.evaluate(() => {
      (document.querySelector('[data-testid="approve"]') as HTMLButtonElement).click();
    });
    await page.waitForTimeout(300);
    expect(approvals, "a scripted click must not approve").toHaveLength(0);

    // The control: a REAL user gesture. Same button, same session — approved.
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("run-status")).toContainText("Approved");
    expect(approvals).toHaveLength(1);
  });
});

/**
 * The vulnerability that shipped, as a regression test.
 *
 * The scripted-CLICK test above passed throughout — and the gate was still
 * open, because an agent does not have to click. It can fetch. The original
 * design exposed `POST /runs/:id/approval-nonce`, which handed an approval
 * credential to any caller with the user's cookie; measured against production,
 * a plain scripted fetch got one, 200.
 *
 * These assert the two properties that closed it: there is no endpoint that
 * vends a credential on request, and a challenge cannot be spent twice.
 */
test.describe("the approval credential cannot be obtained on demand", () => {
  test("there is no credential-vending endpoint to call", async ({ page }) => {
    await installMocks(page);
    let vended = false;
    await page.route(
      (url) => url.pathname.endsWith("/approval-nonce"),
      (route) => {
        vended = true;
        return route.fulfill({ status: 404, body: "{}" });
      },
    );
    await page.route(
      (url) => url.pathname === "/runs/run1/approve",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "run1", status: "approved", pushCommands: [] }),
        }),
    );
    await page.goto("/runs/run1");
    await expect(page.getByTestId("approve")).toBeVisible();

    // A real click drives the whole production approve path.
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("run-status")).toContainText("Approved");

    expect(vended, "the client must never request an approval credential").toBe(false);
  });

  test("the approve request carries the run view's challenge, not one it made up", async ({ page }) => {
    await installMocks(page);
    const headers: (string | undefined)[] = [];
    await page.route(
      (url) => url.pathname === "/runs/run1/approve",
      (route) => {
        headers.push(route.request().headers()["x-approval-challenge"]);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "run1", status: "approved", pushCommands: [] }),
        });
      },
    );
    await page.goto("/runs/run1");
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("run-status")).toContainText("Approved");
    // "c_e2e" is what the mocked run view served — proving the client spends
    // what it was given rather than anything it could synthesise.
    expect(headers).toEqual(["c_e2e"]);
  });
});

/**
 * THE FALLBACK PATH — a browser with WebMCP but no on-device model, which is
 * where most visitors are and quite possibly where a judge will be.
 *
 * The tour has to drive the REAL tools, not a mock of them, or it is a video
 * pretending to be a product. And it has to say it is scripted, or it is a
 * claim we cannot support: the tool calls are genuine, the wording between them
 * is written.
 */
test.describe("no on-device model", () => {
  test("the scripted tour drives real tools", async ({ page }) => {
  await installMocks(page);
  // WebMCP present, Prompt API absent — the exact state most visitors are in.
  await page.addInitScript(() => {
    const live = new Map<string, unknown>();
    (navigator as never as { modelContext: unknown }).modelContext = {
      registerTool: (t: { name: string }, o?: { signal?: AbortSignal }) => {
        live.set(t.name, t);
        o?.signal?.addEventListener("abort", () => live.delete(t.name));
      },
      getTools: async () => [...live.values()],
      executeTool: async (t: { execute: (a: unknown) => Promise<unknown> }, a: string) =>
        JSON.stringify(await t.execute(JSON.parse(a))),
    };
    delete (window as never as { LanguageModel?: unknown }).LanguageModel;
  });
  await page.goto("/runs");
  await page.getByTestId("webmcp-toggle").click();

  const tour = page.getByTestId("webmcp-tour");
  await expect(tour).toBeVisible();
  await tour.click();

  // Real tool calls land in the activity log, which the tour shares with the agent.
  await expect(page.getByTestId("webmcp-turns")).toBeVisible();
  await expect(page.getByTestId("webmcp-scripted-label")).toBeVisible();
  await expect(page.getByTestId("webmcp-activity")).toContainText("list_pending_runs");
  // And it ends where an agent would.
  await expect(page.getByTestId("webmcp-turns")).toContainText(/approves, ships or publishes/i);
});
});

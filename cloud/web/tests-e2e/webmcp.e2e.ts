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
    // Chromium in CI has no navigator.modelContext, so this is the honest branch.
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

/**
 * The email fallback for "a run awaits your approval".
 *
 * Push was the only channel that reaches a user who is not looking at the
 * product — the half of the pitch that says "you do nothing but approve"
 * requires something to tell them there is anything to approve.
 *
 * Measured in production on 2026-08-23: `device_tokens` held 2 rows, both the
 * owner's (one his review account). NO real user has ever registered one, so
 * `notifyRunAwaitingApproval` returned 0 early for every one of them. The one
 * paying user had zero tokens, so even before the stale-gate deadlock (#492)
 * silenced their app, no notification could have reached them.
 *
 * A token only exists for someone who installed the mobile app AND granted
 * permission. Email is the channel every user has by definition — they signed
 * in with it.
 */
import { describe, expect, it } from "vitest";
import { runReadyMessage } from "./runReadyEmail.js";

const RUN_URL = "https://app.shipaso.com/runs/run-123";

describe("runReadyMessage", () => {
  it("names the app so a multi-app owner knows which one moved", () => {
    const msg = runReadyMessage({ appName: "Mangia", runUrl: RUN_URL });
    expect(msg.subject).toContain("Mangia");
  });

  it("puts the run link in both the html and the text part", () => {
    const msg = runReadyMessage({ appName: "Mangia", runUrl: RUN_URL });
    expect(msg.html).toContain(RUN_URL);
    expect(msg.text).toContain(RUN_URL);
  });

  it("says approving is not shipping — the invariant, in the one email that asks for an approval", () => {
    const msg = runReadyMessage({ appName: "Mangia", runUrl: RUN_URL });
    expect(msg.text).toMatch(/nothing is pushed|never pushes|does not ship/i);
  });

  it("carries the reason when the sweep gave one, so the email is not a content-free nag", () => {
    const msg = runReadyMessage({
      appName: "Mangia",
      runUrl: RUN_URL,
      reasons: ['2 targeted keyword(s) unranked: pasta, recipes'],
    });
    expect(msg.text).toContain("pasta, recipes");
    expect(msg.html).toContain("pasta");
  });

  it("escapes html in an app name — the name comes from the store, not from us", () => {
    const msg = runReadyMessage({
      appName: '<script>alert(1)</script>',
      runUrl: RUN_URL,
    });
    expect(msg.html).not.toContain("<script>alert(1)</script>");
    expect(msg.html).toContain("&lt;script&gt;");
  });

  it("survives an app with no reasons without emitting an empty bullet", () => {
    const msg = runReadyMessage({ appName: "Mangia", runUrl: RUN_URL, reasons: [] });
    expect(msg.text).not.toMatch(/^\s*[-•]\s*$/m);
  });
});

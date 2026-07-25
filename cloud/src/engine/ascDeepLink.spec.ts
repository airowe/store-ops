import { describe, it, expect } from "vitest";
import { ascDeepLink, ASC_GENERIC_URL } from "./ascDeepLink.js";

/**
 * #324 Tier 1 — every "→ do X in App Store Connect" should land the customer in
 * the right place for THEIR app, not a generic console link.
 *
 * The honesty constraint dominates the feature: Apple does NOT document the ASC
 * web console's route structure, so we only ever emit an app-scoped path we can
 * actually stand behind. Anything else falls back to the generic console URL —
 * a wrong deep link is worse than no deep link.
 */
describe("ascDeepLink — app-scoped links", () => {
  it("builds an app-scoped App Store listing link from the trackId", () => {
    expect(ascDeepLink("privacy_policy_missing", "12345")).toBe(
      "https://appstoreconnect.apple.com/apps/12345/appstore",
    );
  });

  it("routes PPO / experiment findings to the distribution area for the app", () => {
    expect(ascDeepLink("ppo_never_tested", "12345")).toBe(
      "https://appstoreconnect.apple.com/apps/12345/distribution",
    );
  });

  it("routes the promoted-IAP finding to an app-scoped link (never a bare console URL)", () => {
    const url = ascDeepLink("iap_not_promoted", "12345");
    expect(url).toContain("/apps/12345/");
    expect(url).not.toBe(ASC_GENERIC_URL);
  });

  it("percent-encodes an unexpected id rather than interpolating it raw", () => {
    expect(ascDeepLink("privacy_policy_missing", "12 345")).toBe(
      "https://appstoreconnect.apple.com/apps/12%20345/appstore",
    );
  });
});

describe("ascDeepLink — honest absence (never a fabricated route)", () => {
  it("falls back to the generic console link when the trackId is unknown", () => {
    expect(ascDeepLink("privacy_policy_missing", undefined)).toBe(ASC_GENERIC_URL);
  });

  it("treats an empty trackId as unknown, not as an app id", () => {
    expect(ascDeepLink("privacy_policy_missing", "")).toBe(ASC_GENERIC_URL);
  });

  it("falls back to the generic console link for a finding we have no verified route for", () => {
    expect(ascDeepLink("some_unmapped_finding_id", "12345")).toBe(ASC_GENERIC_URL);
  });

  it("only ever emits routes from the verified allowlist — no invented sub-paths", () => {
    // Every app-scoped URL we can produce must end in one of the two console
    // paths this repo has actually confirmed. This is the guard that stops a
    // future edit from inventing e.g. /distribution/pricing.
    const VERIFIED = [/\/apps\/12345\/appstore$/, /\/apps\/12345\/distribution$/];
    const ids = [
      "privacy_policy_missing",
      "ppo_never_tested",
      "iap_not_promoted",
      "secondary_category_missing",
      "version_no_draft",
      "cpp_none",
    ];
    for (const id of ids) {
      const url = ascDeepLink(id, "12345");
      if (url === ASC_GENERIC_URL) continue;
      expect(VERIFIED.some((re) => re.test(url))).toBe(true);
    }
  });

  it("is deterministic — same input yields the same URL", () => {
    expect(ascDeepLink("ppo_never_tested", "999")).toBe(ascDeepLink("ppo_never_tested", "999"));
  });
});

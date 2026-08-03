import Constants from "expo-constants";
import { legalUrls } from "./legalUrls.js";

jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));

const setExtra = (extra: Record<string, unknown>) => {
  (Constants as unknown as { expoConfig: { extra: unknown } }).expoConfig = { extra };
};

/**
 * Terms of Use (EULA) + privacy policy links for the paywall.
 *
 * Apple requires both to be reachable from the purchase screen, and 5.1.1(i)
 * requires the privacy policy inside the app "in an easily accessible manner".
 *
 * The URLs are config, not constants, because they must be verifiable per
 * build: a link that 404s on a purchase screen is itself a rejection, and
 * hardcoding one that has not been published yet is how that happens. When a
 * URL is unset, the paywall renders NO link rather than a broken one — the
 * measured-or-nothing rule applied to a compliance surface.
 */
describe("legalUrls", () => {
  it("returns both URLs when configured", () => {
    setExtra({ legal: { terms: "https://shipaso.com/terms", privacy: "https://shipaso.com/privacy" } });
    expect(legalUrls()).toEqual({
      terms: "https://shipaso.com/terms",
      privacy: "https://shipaso.com/privacy",
    });
  });

  it("returns nulls when no legal config is present at all", () => {
    setExtra({});
    expect(legalUrls()).toEqual({ terms: null, privacy: null });
  });

  it("returns null for whichever URL is missing, keeping the other", () => {
    setExtra({ legal: { privacy: "https://shipaso.com/privacy" } });
    expect(legalUrls()).toEqual({ terms: null, privacy: "https://shipaso.com/privacy" });
  });

  it("treats an empty string as unset — an empty href is a dead link", () => {
    setExtra({ legal: { terms: "", privacy: "  " } });
    expect(legalUrls()).toEqual({ terms: null, privacy: null });
  });

  /**
   * A non-https URL on a purchase screen is both an ATS failure on iOS and a
   * bad look under review. Reject rather than render.
   */
  it.each([
    ["http://shipaso.com/terms", "plain http"],
    ["shipaso.com/terms", "no scheme"],
    ["javascript:alert(1)", "not a web URL"],
  ])("rejects %s (%s)", (url: string, _why: string) => {
    setExtra({ legal: { terms: url, privacy: url } });
    expect(legalUrls()).toEqual({ terms: null, privacy: null });
  });
});

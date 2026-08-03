/**
 * Terms of Use (EULA) + privacy policy URLs for the purchase screen.
 *
 * Apple requires both to be reachable from a screen that sells a subscription,
 * and Guideline 5.1.1(i) requires the privacy policy inside the app "in an
 * easily accessible manner".
 *
 * These are CONFIG rather than constants for one reason: a link that 404s on a
 * purchase screen is itself a rejection (0.1.0 was already cited under 2.1(a)
 * for a link that did not work). Hardcoding a URL that has not been published
 * makes shipping a dead link the default. Unset ⇒ the paywall renders no link
 * at all, which is visibly incomplete in review rather than silently broken —
 * measured-or-nothing applied to a compliance surface.
 */
import Constants from "expo-constants";

export type LegalUrls = {
  /** Terms of Use / EULA, or null when unconfigured. */
  terms: string | null;
  /** Privacy policy, or null when unconfigured. */
  privacy: string | null;
};

/**
 * https only. A plain-http link fails App Transport Security on iOS, and a
 * scheme-less or non-web string is not a link at all — either would render as a
 * control that does nothing.
 */
function usable(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith("https://")) return null;
  return trimmed;
}

/** Read `extra.legal` from `app.config.ts`. Both fields independently optional. */
export function legalUrls(): LegalUrls {
  const extra = Constants.expoConfig?.extra as
    | { legal?: { terms?: string; privacy?: string } }
    | undefined;
  const legal = extra?.legal;
  return {
    terms: usable(legal?.terms),
    privacy: usable(legal?.privacy),
  };
}

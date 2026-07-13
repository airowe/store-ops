/**
 * Google Play "Data safety" — the READ + FINDINGS half. Fetches the data-safety
 * page (keyless, `reliable:false`) via the injected `FetchFn`, parses it by
 * content (`playDataSafetyParse`), and turns the declaration into HONEST findings.
 *
 * Honesty is load-bearing here because data safety is a legal declaration:
 *   • we only FLAG a POSITIVELY-OBSERVED gap — "you declare data collection but we
 *     found no linked privacy policy in the section" — never "you are
 *     non-compliant" (a flag, not a verdict), and never on mere absence (scraped
 *     absence is UNKNOWN);
 *   • the declaration itself is surfaced as neutral CONTEXT (transparency);
 *   • the reader is degrade-safe: any fetch/parse failure → an all-UNKNOWN record,
 *     which yields no findings, never a throw into the audit.
 *
 * This reader is also the data source the (future) data-safety WRITE / propose
 * loop needs — the declaration model lives here.
 */
import { type Finding, mk } from "../findings/core.js";
import { type FetchFn, buildUrl } from "../itunes.js";
import { fetchText } from "./playWebSource.js";
import { type PlayDataSafety, parsePlayDataSafety } from "./playDataSafetyParse.js";

export const PLAY_DATASAFETY_URL = "https://play.google.com/store/apps/datasafety";
/** Google's Data safety help page — the cite for the privacy-policy requirement. */
export const PLAY_DATA_SAFETY_SOURCE =
  "https://support.google.com/googleplay/android-developer/answer/10787469";

/** An all-UNKNOWN declaration — the honest degrade result (never a fabricated 0). */
function unknownDataSafety(packageName: string): PlayDataSafety {
  return {
    packageName,
    privacyPolicyUrl: null,
    declaresCollection: null,
    declaresSharing: null,
    dataTypes: [],
    reliable: false,
  };
}

/**
 * Read one app's Play data-safety declaration → `PlayDataSafety`. Degrade-safe:
 * a 403/429 (Worker egress) or parse failure yields an all-UNKNOWN record, so a
 * caller merging findings never breaks the audit.
 */
export async function readPlayDataSafety(
  fetchFn: FetchFn,
  packageName: string,
  opts: { country?: string; lang?: string } = {},
): Promise<PlayDataSafety> {
  const { country = "US", lang = "en" } = opts;
  const url = buildUrl(PLAY_DATASAFETY_URL, { id: packageName, gl: country, hl: lang });
  try {
    return parsePlayDataSafety(await fetchText(fetchFn, url), packageName);
  } catch {
    return unknownDataSafety(packageName);
  }
}

const SURFACE = "dataSafety";

/**
 * Findings from a data-safety declaration. Pure.
 *   1. A POSITIVELY-OBSERVED gap: declares collection but no linked privacy
 *      policy found in the section → a WARN flag (Play requires a policy), cited.
 *   2. Otherwise, a neutral CONTEXT summary of what the section declares.
 * UNKNOWN reads (couldn't parse) contribute nothing.
 */
export function playDataSafetyFindings(ds: PlayDataSafety): Finding[] {
  // Nothing we could positively read → stay silent (UNKNOWN, not a false "empty").
  if (ds.declaresCollection === null && ds.dataTypes.length === 0 && ds.privacyPolicyUrl === null) {
    return [];
  }

  const out: Finding[] = [];

  if (ds.declaresCollection === true && !ds.privacyPolicyUrl) {
    out.push(
      mk({
        id: "play_data_safety_no_policy",
        surface: SURFACE,
        severity: "warn",
        impact: "trust",
        title: "Data-safety declares collection but no linked privacy policy was found",
        detail:
          "Your Play data-safety section lists collected data, but we couldn't find a privacy-policy link in it. Google requires a privacy policy when you declare data collection — flagged for you to confirm the link is present (scraped data, so verify in Console).",
        fix: "Add/confirm your privacy-policy URL in Play Console → App content → Data safety.",
        evidence: `Play Data safety — privacy-policy requirement (${PLAY_DATA_SAFETY_SOURCE})`,
      }),
    );
  }

  const parts: string[] = [];
  if (ds.dataTypes.length > 0) parts.push(`collects: ${ds.dataTypes.join(", ")}`);
  else if (ds.declaresCollection === false) parts.push("declares no data collected");
  if (ds.declaresSharing === false) parts.push("declares no data shared");
  if (ds.privacyPolicyUrl) parts.push("privacy policy linked");
  if (parts.length > 0) {
    out.push(
      mk({
        id: "play_data_safety_summary",
        surface: SURFACE,
        severity: "info",
        impact: "trust",
        title: `Play data-safety: ${parts.join("; ")}`,
        detail:
          "What your public Play data-safety section declares. Scraped (reliable:false), so treat it as a transparency snapshot to reconcile against Console, not owner-truth.",
        fix: "",
        evidence: PLAY_DATA_SAFETY_SOURCE,
        context: true,
      }),
    );
  }

  return out;
}

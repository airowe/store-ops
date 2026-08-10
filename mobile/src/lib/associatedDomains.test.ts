import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every host our EMAILS link to must be an associated domain, or the link opens
 * Safari instead of the app.
 *
 * iOS matches universal links on the EXACT host: `app.shipaso.com` is a
 * different host from `shipaso.com`, and a wildcard is not implied. The app
 * declared only `applinks:shipaso.com`, while the weekly digest links
 * `DASHBOARD_ORIGIN ?? "https://app.shipaso.com"` (cloud/src/api/index.ts) — so
 * tapping a digest link loaded the web page and never offered to open the app.
 * `shipaso.com/dashboard` 404s; the content only exists on the subdomain.
 *
 * That is the same Guideline 2.1(a) failure that rejected 0.1.0 (a magic link
 * that dead-ended), which is why this is a guard and not a comment.
 *
 * Static: reads the config source, so it needs no Expo runtime. Both hosts are
 * verified to serve a valid AASA with `content-type: application/json`.
 */
const mobileRoot = join(__dirname, "..", "..");
const config = readFileSync(join(mobileRoot, "app.config.ts"), "utf8");

/** Hosts that appear in customer-facing links and therefore must open the app. */
const LINKED_HOSTS = ["shipaso.com", "app.shipaso.com"] as const;

/** `associatedDomains: [...]` entries, as written in the config source. */
function associatedDomains(): string[] {
  const block = config.match(/associatedDomains:\s*\[([^\]]*)\]/s);
  if (!block?.[1]) return [];
  return [...block[1].matchAll(/applinks:([A-Za-z0-9.${}_-]+)/g)]
    .map((m) => m[1])
    .filter((s): s is string => !!s);
}

/**
 * Does the Android intent filter derive its hosts from the same LINKED_HOSTS
 * list as iOS? Asserting the shared source beats scraping literals: the two
 * platforms drifting apart is the failure this guards against.
 */
function androidUsesLinkedHosts(): boolean {
  const block = config.match(/intentFilters:\s*\[([\s\S]*?)\n\s{2}\]/);
  return !!block?.[1] && /LINKED_HOSTS/.test(block[1]);
}

describe("associated domains cover every linked host", () => {
  it("declares an iOS applinks entry for each host our emails link to", () => {
    const declared = associatedDomains().join(" ");
    for (const host of LINKED_HOSTS) {
      // The config interpolates constants, so assert the CONSTANT resolves to
      // the host rather than requiring a literal.
      const viaConstant = new RegExp(`=\\s*"${host.replace(/\./g, "\\.")}"`).test(config);
      expect(declared.includes(host) || viaConstant).toBe(true);
    }
  });

  it("registers the same hosts as Android app links", () => {
    // Both platforms must read the one list, so adding a host can't fix iOS
    // while silently leaving Android's intent filter behind.
    expect(androidUsesLinkedHosts()).toBe(true);
  });

  it("names the dashboard subdomain somewhere in the config", () => {
    // The digest CTA points at app.shipaso.com; if that host is absent from the
    // config entirely, no association can exist for it.
    expect(config).toMatch(/app\.shipaso\.com/);
  });
});

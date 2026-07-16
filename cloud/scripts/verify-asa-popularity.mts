// @ts-nocheck — standalone tsx utility (Node globals); not part of the worker build.
/**
 * verify-asa-popularity — the #78-2 "LIVE-VERIFICATION GATE" step.
 *
 * Exercises the REAL production auth + read path (engine/asaAuth.ts +
 * engine/asaClient.ts) against Apple's LIVE Search Ads v5 API, so we can confirm
 * the keyword-popularity reader returns sane numbers before wiring it into
 * scoring/UI and flipping ASA_POPULARITY_ENABLED.
 *
 * Credentials come from ENV (never args, never disk, never logged):
 *   ASA_PRIVATE_KEY   PEM (PKCS#8, EC P-256) — the ASA API cert private key.
 *                     Pass a file path via ASA_PRIVATE_KEY_FILE instead if easier.
 *   ASA_CLIENT_ID     ASA client id
 *   ASA_TEAM_ID       ASA team id
 *   ASA_KEY_ID        ASA key id (kid)
 *   ASA_ORG_ID        ASA org id (X-AP-Context)
 *   ASA_TERMS         comma-separated terms to check (default: a few generic ones)
 *
 * Run:  cd cloud && npx tsx scripts/verify-asa-popularity.mts
 * Prints: token-mint result, /acls org reachability, and the popularity map.
 * Writes NOTHING. The private key stays in a local for one mint (module posture).
 */
import { readFileSync } from "node:fs";
import { verifyAsaCredentials, mintAsaAccessToken, type AsaKeyBundle, type FetchLike } from "../src/engine/asaAuth.js";
import { keywordPopularity } from "../src/engine/asaClient.js";

// Real fetch, adapted to the module's narrow FetchLike shape.
const fetchLike: FetchLike = async (url, init) => {
  const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
  return { ok: r.ok, status: r.status, text: () => r.text() };
};

function reqEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`✗ missing env ${name}`);
    process.exit(2);
  }
  return v;
}

function privateKey(): string {
  const file = process.env.ASA_PRIVATE_KEY_FILE?.trim();
  if (file) return readFileSync(file, "utf8");
  return reqEnv("ASA_PRIVATE_KEY");
}

const bundle: AsaKeyBundle = {
  privateKey: privateKey(),
  clientId: reqEnv("ASA_CLIENT_ID"),
  teamId: reqEnv("ASA_TEAM_ID"),
  keyId: reqEnv("ASA_KEY_ID"),
  orgId: reqEnv("ASA_ORG_ID"),
};

const terms = (process.env.ASA_TERMS ?? "meditation,bible,budget,fitness,weather")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

console.log("=== ASA popularity verification (live) ===");
console.log(`orgId: ${bundle.orgId}  keyId: ${bundle.keyId}  terms: ${terms.join(", ")}`);
console.log("(the private key is never printed or persisted)\n");

// 1) Verify the credential + org reachability (mints a token, probes /acls).
const verify = await verifyAsaCredentials(fetchLike, bundle);
if (!verify.ok) {
  console.error(`✗ credential check FAILED: ${verify.reason}`);
  process.exit(1);
}
console.log("✓ credential valid + org reachable (/acls)\n");

// 2) Mint a token and read real popularity for the terms.
const { accessToken } = await mintAsaAccessToken(fetchLike, bundle);
const map = await keywordPopularity(fetchLike, { accessToken, orgId: bundle.orgId, terms });

if (map.size === 0) {
  console.log("⚠ Apple returned NO popularity for any term.");
  console.log("  This is the reader's honest empty-fallback. Either the terms have");
  console.log("  no data, or the v5 response shape differs from what the parser");
  console.log("  expects (keys: searchPopularity/popularity/score). If you expected");
  console.log("  numbers, we need to inspect the raw response — tell me and I'll add");
  console.log("  a raw-dump mode.");
  process.exit(0);
}

console.log("✓ Apple returned popularity:\n");
console.log("  term".padEnd(22) + "popularity (5–100)");
console.log("  " + "-".repeat(38));
for (const term of terms) {
  const hit = map.get(term.toLowerCase());
  console.log("  " + term.padEnd(20) + (hit ? String(hit.popularity) : "— (no data)"));
}
console.log("\nVerified. If these look right, the next step is flipping");
console.log("ASA_POPULARITY_ENABLED and wiring the map into scoring/UI.");

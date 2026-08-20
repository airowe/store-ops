// @ts-nocheck — standalone tsx utility (Node globals); not part of the worker build.
/**
 * mint-review-token — mint the long-lived App Review sign-in token.
 *
 * WHY: sign-in is passwordless. App Review cannot read the mailbox our magic
 * links go to, and magic tokens die in 15 minutes, so no credential survives
 * long enough to write into the review notes. That is exactly what got 0.1.1
 * rejected under Guideline 2.1(a). This mints the audience-separated `review`
 * token that CAN live in the notes; the reviewer pastes it on the login screen
 * and `POST /auth/review-exchange` trades it for an ordinary session.
 *
 * The token is a bearer credential in a document, so it is deliberately bounded:
 * it only ever mints a session for REVIEW_ACCOUNT_EMAIL, and only while that var
 * is set on the worker. Rotate by changing SESSION_SECRET or REVIEW_ACCOUNT_EMAIL
 * — either one invalidates every outstanding review token immediately.
 *
 * Both values must match the DEPLOYED worker or the token will not verify:
 *   SESSION_SECRET        the worker's signing secret (never printed here)
 *   REVIEW_ACCOUNT_EMAIL  the review account address
 *   REVIEW_TOKEN_DAYS     optional TTL in days (default 90)
 *
 * Run:  cd cloud && SESSION_SECRET=… REVIEW_ACCOUNT_EMAIL=… npx tsx scripts/mint-review-token.mts
 * Prints the token and its expiry. Writes NOTHING.
 */
import { mintReviewToken, verifyReviewToken, isReviewAccount } from "../src/auth.js";

function reqEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`✗ missing env ${name}`);
    process.exit(2);
  }
  return v;
}

const secret = reqEnv("SESSION_SECRET");
const email = reqEnv("REVIEW_ACCOUNT_EMAIL");
const days = Number(process.env.REVIEW_TOKEN_DAYS ?? "90");
if (!Number.isFinite(days) || days <= 0) {
  console.error("✗ REVIEW_TOKEN_DAYS must be a positive number of days");
  process.exit(2);
}
const ttlSeconds = Math.floor(days * 24 * 60 * 60);

const token = await mintReviewToken(secret, email, { ttlSeconds });

// Prove the thing we just minted actually works, rather than assuming it: it must
// verify as a review token AND land on the configured review account.
const verified = await verifyReviewToken(secret, token);
if (!verified.ok) {
  console.error("✗ the minted token failed to verify — refusing to print it.");
  process.exit(1);
}
if (!isReviewAccount({ REVIEW_ACCOUNT_EMAIL: email }, verified.email)) {
  console.error("✗ the token does not resolve to the review account — refusing to print it.");
  process.exit(1);
}

const expiry = new Date(Date.now() + ttlSeconds * 1000);
console.log("=== App Review sign-in token ===");
console.log(`account: ${verified.email}`);
console.log(`expires: ${expiry.toISOString().slice(0, 10)} (${days} days)`);
console.log("verified: signs, verifies, and resolves to the review account.\n");
console.log("Paste this into App Store Connect → App Review Information → Notes:\n");
console.log(token);
console.log("\nReminder: set REVIEW_ACCOUNT_EMAIL on the worker, or the route stays closed.");

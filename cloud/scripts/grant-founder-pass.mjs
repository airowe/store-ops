#!/usr/bin/env node
/**
 * grant-founder-pass — give one account Scale for twelve months, free.
 *
 * The Founders' Pass (docs/gtm/founders-pass.md): a short named list of
 * people who ship many apps or speak to many developers. This is the only
 * mechanism; there is no promo code and no affiliate path.
 *
 * What it writes, and why each column:
 *   tier         = 'scale'   what every gate reads (getTier)
 *   stripe_tier  = 'scale'   what recomputeEffectiveTier derives `tier` from,
 *                            so a later webhook cannot silently demote the pass
 *   status       = 'comped'  visible in the row; nothing gates on it
 *   current_period_end       twelve months from now, so the expiry is a fact
 *                            in the row rather than a note in someone's head
 * No Stripe ids are touched. Revoking is the same command with --revoke,
 * which sets tier and stripe_tier back to 'free'.
 *
 * Run (from cloud/):  node scripts/grant-founder-pass.mjs --email person@example.com [--months 12] [--revoke]
 * Reads and writes production D1 through wrangler; prints the row before and after.
 */
import { execFileSync } from "node:child_process";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const email = (arg("email", "") ?? "").trim().toLowerCase();
const months = Number(arg("months", "12"));
const revoke = process.argv.includes("--revoke");
if (!email.includes("@")) {
  console.error("usage: node scripts/grant-founder-pass.mjs --email person@example.com [--months 12] [--revoke]");
  process.exit(1);
}
if (!Number.isInteger(months) || months < 1 || months > 24) {
  console.error("--months must be a whole number from 1 to 24");
  process.exit(1);
}

const q = (s) => s.replace(/'/g, "''");
function d1(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "store_ops", "--remote", "--json", "--command", sql], { encoding: "utf8" });
  const json = out.slice(out.indexOf("["));
  return JSON.parse(json)[0]?.results ?? [];
}

const before = d1(`SELECT id, email, tier, stripe_tier, status, current_period_end FROM users WHERE email = '${q(email)}'`);
if (before.length !== 1) {
  console.error(`no account for ${email} — they must sign in once (magic link) before a pass can be granted`);
  process.exit(2);
}
console.log("before:", JSON.stringify(before[0]));

const end = new Date();
end.setUTCMonth(end.getUTCMonth() + months);
const sql = revoke
  ? `UPDATE users SET tier = 'free', stripe_tier = 'free', status = 'active', current_period_end = NULL WHERE email = '${q(email)}'`
  : `UPDATE users SET tier = 'scale', stripe_tier = 'scale', status = 'comped', current_period_end = '${end.toISOString()}' WHERE email = '${q(email)}'`;
d1(sql);

const after = d1(`SELECT id, email, tier, stripe_tier, status, current_period_end FROM users WHERE email = '${q(email)}'`);
console.log("after: ", JSON.stringify(after[0]));
console.log(revoke ? `revoked the pass for ${email}` : `granted Scale to ${email} until ${end.toISOString().slice(0, 10)}`);

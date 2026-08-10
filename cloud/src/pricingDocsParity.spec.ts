/**
 * The advertised prices and app limits must match what the code actually bills.
 *
 * Three surfaces have to agree:
 *
 *   billing.ts appLimitForTier   what the code ENFORCES
 *   docs/landing/pricing.md      what a human READS
 *   docs/landing/llms.txt        what an LLM QUOTES (machine-readable, so this
 *                                one gets repeated verbatim by assistants)
 *
 * They diverged badly (#380): marketing advertised a $49 one-time tier that no
 * code path could sell, quoted $149/mo for a tier that bills $65, and never
 * mentioned the $7 entry point at all. The tier rename+reprice landed in #105
 * and the marketing surfaces were written separately, so nothing caught it —
 * for weeks the site sold a product the system did not implement.
 *
 * Prices live in prose, not constants, so they are read out of the source text.
 * That is deliberate: the point is to catch the DOC drifting from the code, and
 * a shared constant would only prove the docs agree with themselves.
 *
 * NOT covered: commercial/OFFER.md deliberately still describes the
 * aspirational $49/$19/$149 scheme behind a warning banner. It is an intended
 * direction pending a business decision, not a live description — see #380.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appLimitForTier } from "./billing.js";

const PRICING_MD = fileURLToPath(new URL("../../docs/landing/pricing.md", import.meta.url).href);
const LLMS_TXT = fileURLToPath(new URL("../../docs/landing/llms.txt", import.meta.url).href);

/** The live scheme. Prices are not in code (Stripe holds them), so they are pinned here. */
const TIERS = [
  { name: "Free", price: "$0", limit: appLimitForTier("free") },
  { name: "Indie", price: "$6.99/mo", limit: appLimitForTier("indie") },
  { name: "Startup", price: "$19/mo", limit: appLimitForTier("startup") },
  { name: "Scale", price: "$65/mo", limit: appLimitForTier("scale") },
] as const;

/** Tier names retired in #105 that must never reappear on a customer surface. */
const RETIRED = ["Launch Optimization", "Fleet Autopilot", "$49", "$149"] as const;

const surfaces = [
  { label: "docs/landing/pricing.md", path: PRICING_MD },
  { label: "docs/landing/llms.txt", path: LLMS_TXT },
];

describe("pricing docs parity (#380)", () => {
  it("app limits are the ones billing.ts enforces", () => {
    expect(TIERS.map((t) => t.limit)).toEqual([1, 3, 10, 50]);
  });

  describe.each(surfaces)("$label", ({ path }) => {
    const text = () => readFileSync(path, "utf8");

    it.each(TIERS)("advertises $name at $price", ({ name, price }) => {
      const src = text();
      expect(src).toContain(name);
      expect(src).toContain(price);
    });

    it.each(TIERS)("states $name's real app limit ($limit)", ({ name, limit }) => {
      // The row is "| Indie | $7/mo | 3 | ..." — assert the limit appears in the
      // tier's own row, not merely somewhere in the file.
      const row = text()
        .split("\n")
        .find((l) => l.includes(`| ${name} `) && l.includes("|"));
      expect(row, `no table row for tier ${name}`).toBeDefined();
      expect(row).toContain(`| ${limit} |`);
    });

    it.each(RETIRED)("does not resurrect the retired %o", (dead) => {
      expect(text()).not.toContain(dead);
    });
  });
});

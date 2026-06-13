#!/usr/bin/env node
/**
 * One-shot Stripe (TEST MODE) product + price creation for store-ops.
 *
 * Creates the three paid tiers from commercial/OFFER.md and prints the price ids
 * to paste into the Worker secrets (STRIPE_PRICE_LAUNCH/AUTOPILOT/FLEET).
 *
 * Idempotent-ish: looks up an existing product by its `lookup_key`-style metadata
 * tag before creating, so re-running won't make duplicates.
 *
 * Usage:
 *   STRIPE_KEY=sk_test_or_restricted node scripts/stripe-setup.mjs
 *
 * No Stripe SDK — plain fetch against the REST API (form-encoded), same posture
 * as src/billing.ts.
 */
const KEY = process.env.STRIPE_KEY;
if (!KEY) {
  console.error("Set STRIPE_KEY (a TEST-mode secret or restricted key) in the env.");
  process.exit(1);
}
if (!/^(sk|rk)_test_/.test(KEY)) {
  console.error(
    `Refusing to run: STRIPE_KEY does not look like a TEST key (expected sk_test_ / rk_test_). ` +
      `Got prefix "${KEY.slice(0, 8)}…". This script must never run against live mode.`,
  );
  process.exit(1);
}

const API = "https://api.stripe.com/v1";

async function stripe(path, params) {
  const body = new URLSearchParams();
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v, key);
      else body.set(key, String(v));
    }
  };
  if (params) walk(params, "");
  const resp = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(`Stripe ${path} failed (${resp.status}): ${JSON.stringify(json.error ?? json)}`);
  }
  return json;
}

async function search(resource, query) {
  const resp = await fetch(`${API}/${resource}/search?query=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const json = await resp.json();
  if (!resp.ok) return { data: [] }; // search may be unavailable; fall through to create
  return json;
}

/** The three tiers. amount in cents; recurring => subscription, else one-time. */
const TIERS = [
  { tag: "store_ops_launch", name: "Launch Optimization", amount: 4900, recurring: null },
  { tag: "store_ops_autopilot", name: "Autopilot", amount: 1900, recurring: "month" },
  { tag: "store_ops_fleet", name: "Fleet Autopilot", amount: 14900, recurring: "month" },
];

async function ensureTier(t) {
  // find existing product by metadata tag
  const found = await search("products", `metadata['store_ops_tier']:'${t.tag}' AND active:'true'`);
  let product = found.data?.[0];
  if (!product) {
    product = await stripe("/products", {
      name: `store-ops — ${t.name}`,
      metadata: { store_ops_tier: t.tag },
    });
    console.error(`  created product ${product.id} (${t.name})`);
  } else {
    console.error(`  reusing product ${product.id} (${t.name})`);
  }

  // reuse an existing price on the product with the same amount/interval if present
  const prices = await fetch(`${API}/prices?product=${product.id}&active=true&limit=100`, {
    headers: { Authorization: `Bearer ${KEY}` },
  }).then((r) => r.json());
  const match = (prices.data ?? []).find(
    (p) =>
      p.unit_amount === t.amount &&
      ((t.recurring && p.recurring?.interval === t.recurring) || (!t.recurring && !p.recurring)),
  );
  if (match) {
    console.error(`  reusing price ${match.id}`);
    return match.id;
  }

  const priceParams = {
    product: product.id,
    currency: "usd",
    unit_amount: t.amount,
    metadata: { store_ops_tier: t.tag },
  };
  if (t.recurring) priceParams.recurring = { interval: t.recurring };
  const price = await stripe("/prices", priceParams);
  console.error(`  created price ${price.id}`);
  return price.id;
}

(async () => {
  console.error("Creating store-ops Stripe products/prices (TEST mode)…");
  const out = {};
  for (const t of TIERS) {
    console.error(`\n• ${t.name}`);
    const id = await ensureTier(t);
    out[t.tag] = id;
  }
  // Machine-readable result on stdout (stderr carried the progress chatter).
  console.log(
    JSON.stringify(
      {
        STRIPE_PRICE_LAUNCH: out.store_ops_launch,
        STRIPE_PRICE_AUTOPILOT: out.store_ops_autopilot,
        STRIPE_PRICE_FLEET: out.store_ops_fleet,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});

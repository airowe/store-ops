#!/usr/bin/env node
/**
 * One-shot Stripe product + price creation for store-ops (ShipASO).
 *
 * Creates the three paid tiers and prints the price ids to paste into the
 * Worker secrets (STRIPE_PRICE_INDIE/STARTUP/SCALE).
 *
 * Idempotent-ish: looks up an existing product by its metadata tag before
 * creating, so re-running won't make duplicates.
 *
 * Usage:
 *   # TEST mode (default — only test keys accepted):
 *   STRIPE_KEY=sk_test_or_rk_test_… node scripts/stripe-setup.mjs
 *
 *   # LIVE mode (creates REAL products/prices — requires BOTH a live key AND the
 *   # explicit --live flag, so a live key alone can never run by accident):
 *   STRIPE_KEY=sk_live_or_rk_live_… node scripts/stripe-setup.mjs --live
 *
 * No Stripe SDK — plain fetch against the REST API (form-encoded), same posture
 * as src/billing.ts.
 */
const LIVE = process.argv.includes("--live");
const KEY = process.env.STRIPE_KEY;
if (!KEY) {
  console.error("Set STRIPE_KEY (a Stripe secret or restricted key) in the env.");
  process.exit(1);
}

const isTestKey = /^(sk|rk)_test_/.test(KEY);
const isLiveKey = /^(sk|rk)_live_/.test(KEY);

if (LIVE) {
  // Live mode: demand a live key AND the explicit flag. Two locks, both required.
  if (!isLiveKey) {
    console.error(
      `--live was passed but STRIPE_KEY is not a LIVE key (expected sk_live_ / rk_live_). ` +
        `Got prefix "${KEY.slice(0, 8)}…". Refusing to run.`,
    );
    process.exit(1);
  }
  console.error(
    "⚠️  LIVE MODE: this will create REAL products + prices on your Stripe account " +
      "and they can take REAL money. Proceeding because --live was passed with a live key.",
  );
} else {
  // Default (test): only a test key is accepted. A live key without --live is a
  // hard stop — you must opt into live deliberately.
  if (isLiveKey) {
    console.error(
      `STRIPE_KEY is a LIVE key but --live was NOT passed. Refusing to create live ` +
        `objects by accident. Re-run with --live if you really mean live mode.`,
    );
    process.exit(1);
  }
  if (!isTestKey) {
    console.error(
      `Refusing to run: STRIPE_KEY does not look like a TEST key (expected sk_test_ / ` +
        `rk_test_). Got prefix "${KEY.slice(0, 8)}…".`,
    );
    process.exit(1);
  }
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

/** The three tiers. amount in cents; all recurring monthly subscriptions. */
const TIERS = [
  { tag: "store_ops_indie", name: "Indie", amount: 700, recurring: "month" },
  { tag: "store_ops_startup", name: "Startup", amount: 1900, recurring: "month" },
  { tag: "store_ops_scale", name: "Scale", amount: 6500, recurring: "month" },
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
  console.error(`Creating store-ops Stripe products/prices (${LIVE ? "LIVE" : "TEST"} mode)…`);
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
        STRIPE_PRICE_INDIE: out.store_ops_indie,
        STRIPE_PRICE_STARTUP: out.store_ops_startup,
        STRIPE_PRICE_SCALE: out.store_ops_scale,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});

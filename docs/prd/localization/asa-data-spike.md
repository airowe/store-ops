# ASA popularity/difficulty — honest-access spike (#78 item 2)

Status: **spike / decision doc** (owner picked "investigate honest access",
2026-07-05). This is the gate before any code. Question it answers: is there a
ToS-clean, per-user-consented way to surface Apple Search Ads *search
popularity* (and a difficulty signal) — the one real-data feature TryAstro has
that we deliberately don't fabricate (#65)?

## The wedge this must not break

Our stance (#65): we never present fabricated search volume or difficulty as if
measured. Astro shows ASA popularity/difficulty numbers; we show honest,
store-derived proxies and are explicit that they're proxies. Any access path
here has to clear the same bar — real numbers, per-user authorized, or we don't
show them at all and say why.

## What ASA actually exposes (and to whom)

Apple Search Ads has two surfaces:

1. **Search Ads Campaign Management API** (`api.searchads.apple.com`) — the
   real one. Its `SearchTerms` / keyword reports and the
   `GET .../keywords/recommendations` + popularity endpoints return Apple's own
   **search popularity** (a 1–100 relative index) and impression data. This is
   the genuine signal.
2. The consumer-facing "Search Popularity" shown in the ASA UI — same data,
   behind the same account.

Access facts (verified against Apple's ASA API docs, 2026):

- **OAuth 2.0 client-credentials**, per advertiser account. The account holder
  generates an API certificate / key pair in their ASA account and grants an
  API user a role (Account Admin / API Account Manager / etc.). There is **no**
  global/partner key that reads popularity for arbitrary apps — it is always
  scoped to *an ASA account the caller controls*.
- Popularity/impression data is **account-scoped**, not app-scoped: you get the
  signal for the terms your own campaigns touch (and keyword recommendations
  for your apps). You cannot pull "popularity for 'meal planner' globally"
  without a campaign/recommendation context in an account you own.
- **A live ASA account requires a funded ad account** (a payment method; Apple
  requires campaign setup to unlock most reporting). Many indie users targeting
  organic ASO do **not** run paid ASA — so for them the data literally does not
  exist to grant us.

## The three honest paths, scored

### Path A — per-user ASA connect (OAuth), read popularity for *their* terms
The user who already runs ASA authorizes ShipASO (client-credentials with their
generated key, same custody model as #67 stored credentials — opt-in,
envelope-encrypted, write-only, revocable). We call the Campaign Management API
on their behalf and surface **their** real popularity/difficulty for **their**
keywords.

- **Honest?** Yes — real Apple data, user-authorized, per-account scoped. No
  fabrication, no cross-account leakage.
- **Coverage?** Only users with a funded ASA account and campaigns/reco context.
  Likely a minority of our organic-ASO base. Everyone else sees the honest "you
  don't have ASA connected — here's our proxy, labeled as a proxy" state.
- **Custody?** Reuses #67 exactly: `kind: "asa"` added to `stored_credentials`,
  envelope-encrypted, opt-in, `last_used_at`, delete-doesn't-revoke-at-Apple
  copy. No new crypto — the vault is credential-kind agnostic.
- **ToS?** Clean. It's the account owner using their own account's official API
  through a tool they authorized. This is exactly how ASA API partners operate.
- **Effort?** M. OAuth client-credentials flow + one reader module + a keyword
  → popularity join on the existing scoring path + the connect UI. The vault,
  opt-in pattern, and honesty-copy conventions already exist from #67.

### Path B — a single ShipASO-owned ASA account as a "popularity oracle"
We fund one ASA account, create campaigns across seed keywords, and read
popularity to back a global index we show all users.

- **Honest?** The *numbers* are real, but presenting one account's
  campaign-context popularity as a universal per-user signal is a stretch, and
  it silently re-introduces "a number we synthesized centrally" — the thing
  #65 warns against. **Rejected on honesty grounds** unless labeled as "ShipASO
  seed-keyword popularity index (our account)," which is weak.
- **ToS?** Grey — systematically farming popularity to resell/redistribute as a
  data product is closer to what Apple's terms restrict than a user reading
  their own account. **Do not pursue without legal review.**
- **Cost?** Requires ongoing ad spend to keep campaigns live. Recurring burn
  for a derived dataset. **Rejected pre-PMF.**

### Path C — keep the #65 stance, no ASA numbers
Lean entirely on the agent/loop differentiation and honest proxies; never show
an ASA-style number.

- **Honest?** Maximally. **Coverage?** Universal. **Effort?** Zero.
- **Cost:** we visibly lack the one number Astro markets. Acceptable given our
  positioning (agent that ships, not another data dashboard), but leaves value
  on the table for the ASA-running subset.

## Recommendation

**Path A, gated behind the existing #67 custody model — as an *opt-in connect*,
not a default.** It's the only path that yields *real* Apple popularity data
without fabrication or ToS risk, and it composes with credential storage we
already shipped (add `kind: "asa"`, reuse the vault + opt-in + honesty copy).
For the majority without ASA, we fall back to Path C's honest proxy with an
explicit "connect Apple Search Ads to see Apple's real popularity for your
terms" affordance — no dead UI, no fabricated numbers.

**Explicitly not** Path B: central popularity farming is a cost sink and an
honesty/ToS liability.

## If approved → implementation sketch (not built here)

1. `stored_credentials.kind` gains `"asa"` (schema CHECK + migration). No new
   crypto — `credentialVault`/`credentialStore` are kind-agnostic.
2. `cloud/src/engine/asaClient.ts` — OAuth client-credentials token exchange +
   `keywordPopularity(terms)` against the Campaign Management API. Degradable;
   failure = honest "couldn't read ASA," never a guess.
3. Join popularity into the existing keyword scoring as a **labeled real signal**
   ("Apple Search Ads popularity") distinct from our proxy columns — never
   silently blended.
4. Connect UI: opt-in card mirroring the ASC key panel; honest empty-state for
   users without ASA.
5. Tests pin: no ASA number is ever shown unless it came from the user's
   authorized account read; proxy stays labeled as proxy.

## Decision needed to proceed

Owner go/no-go on **Path A as an opt-in ASA connect**. Until then #78 item 2
stays open with this spike as its resolution-of-record. #65's no-fabrication
stance is unchanged either way.

# Google Play (Android) support — implementation plan

Status: **proposal / not yet built**. This document is a file-by-file plan, not code.

ShipASO is iOS-only today. This plan extends it to **audit Google Play listings** and
**hand off a `fastlane supply` metadata tree** — read + audit + handoff only, never a
Play publish. It mirrors the existing iOS architecture so the shared engine (coverage,
screenshot scoring, keyword/intent grounding) runs for both stores without duplication.

The whole plan is gated on one decision, so it goes first.

> **See also `01-data-map.md`** — the concrete research behind this plan: exact
> endpoints, fields, auth, rate limits, ToS, Worker-fit, and the honesty/product-value
> mapping for every Play data surface (keyless scrape, licensed vendors, and the
> official owner APIs). It resolves the "which vendor / which endpoint" questions this
> plan leaves abstract.

---

## 1. The gating decision: where does Android listing data come from?

iOS gets a free, public, keyless Lookup API (`itunes.apple.com/lookup`) that returns any
app's listing by bundle id. **Google Play has no equivalent.** There is no sanctioned,
free, keyless "read any package's listing" endpoint. So before any module is written we
must choose a data plane. Three options:

### (a) Licensed third-party Play-data API
Vendors that already scrape/license Play data and expose a clean REST+JSON surface
(e.g. 42matters, SerpApi's Google-Play engine, AppTweak, Sensor Tower, data.ai). You call
an HTTPS endpoint with a package id and get back title, short description, long
description, screenshots, category, rating, installs bucket, etc.

| Dimension | Assessment |
|---|---|
| **Cost** | Paid + recurring, scales with audit volume. The accessible tier (42matters, SerpApi) is per-call and affordable; the incumbents (Sensor Tower, data.ai) are enterprise contracts. |
| **Reliability** | **High.** The vendor absorbs the anti-bot / DOM-drift problem and returns stable JSON with an SLA. |
| **ToS risk** | **Low for us.** The vendor holds the data-licensing/scraping exposure; we consume a sanctioned API under their terms. No Google-egress exposure on our Worker. |
| **Use-case fit** | **Audit ANY competitor's listing — yes.** Query an arbitrary package id. This is the only option that delivers the "audit a competitor" capability. |
| **Stack fit** | A plain `fetch` to a JSON endpoint — matches the codebase's "REST directly via fetch, no heavy deps" posture. No SDK, no headless browser. |

### (b) Scrape the Play Store directly
| Dimension | Assessment |
|---|---|
| **Cost** | "Free" but real: proxy/egress costs + ongoing maintenance. |
| **Reliability** | **Brittle.** Play pages are JS-heavy; the data lives in obfuscated `AF_initDataCallback` blobs. Google aggressively blocks datacenter egress (our own `constants.ts` already notes Apple *intermittently* 403s Worker egress — Google does it deliberately and persistently). A Cloudflare Worker has no headless browser; `google-play-scraper` is a Node-oriented **heavy dep** that violates the Worker + no-heavy-deps constraints. |
| **ToS risk** | **High — ours.** Directly against Google Play ToS; the legal exposure is ShipASO's, not a vendor's. |
| **Use-case fit** | Any competitor in theory, but unreliable enough to be a support burden and a brand risk. |

### (c) Official Google Play Developer API (Android Publisher API)
| Dimension | Assessment |
|---|---|
| **Cost** | **Free.** |
| **Reliability** | **High** — official, stable, documented. |
| **ToS risk** | **None** — the sanctioned API. |
| **Use-case fit** | **Owner-only.** Requires the developer's own OAuth / service-account credentials, and only returns apps that live in *their* Play Console. `edits.listings.get` reads the real title/short/long description per language at full fidelity — but you can **never** read a competitor this way. It is also the *publish* path (`edits.*` is a write transaction), so it is exactly the surface constraint #2 forbids us to auto-execute; we use only its **read** verbs. |

### Recommendation

**Lead with (a) as the resolution + listing-read data plane, behind an injected
`PlayDataSource` interface. Add (c) as an optional owner-only, high-fidelity read tier
that also unlocks the fastlane `supply` handoff. Reject (b) outright.**

The reasoning is that this is **the same two-tier honesty model iOS already uses**, ported
one-for-one:

| Tier | iOS (today) | Android (this plan) | Fidelity / trust |
|---|---|---|---|
| Public / "no-key" | free iTunes Search+Lookup | licensed Play-data API (option **a**) | any app, lower trust — empty fields are **UNKNOWN, not zero** (`dataReliable:false`) |
| Connected / "Mode-A" | App Store Connect (owner key) | Play Developer API read (option **c**) | owner only, high trust — reads the real long description + assets; **gates the `supply` handoff** |

Why not a single option:

- **(c) alone cannot do competitors** — it is owner-only by construction. The product's
  headline "audit any competitor's listing" use-case *requires* (a). There is no free
  public Lookup to fall back on the way iOS does.
- **(b) is incompatible** with the Worker runtime, the no-heavy-deps rule, and the ToS
  posture. We do not build it.
- **(a) is the iTunes-equivalent** (any app, public fidelity); **(c) is the ASC-equivalent**
  (owner, high fidelity). Mapping them onto the existing `hasAscKey` / surface-lock /
  `dataReliable` machinery means the honesty guardrails we already trust extend to Android
  with almost no new concepts.

**The tradeoff we are accepting:** unlike iOS, the Android public tier costs money per
audit (there is no free Lookup). We isolate that cost behind one injected interface
(`PlayDataSource`) so the vendor is swappable and the engine never depends on a specific
provider — and so the entire engine still unit-tests with zero network via a fake source.

**Honesty consequence that propagates everywhere below:** even the licensed API returns
only the **visible** listing (title, short/long description, screenshots, category,
rating). It does **not** return measured search volume, and the public tier cannot see
owner-only truth. So Android inherits iOS's discipline verbatim: real numbers or an honest
`null`/"unmeasured" — never an estimate dressed as measured (constraint #1).

---

## 2. The Store abstraction (so shared logic isn't duplicated)

Today the engine hard-codes iOS everywhere: `optimize.ts` assumes a 30/30/100 budget and a
comma keyword field; `metadataCoverage.ts` assumes name/subtitle/keywords; `screenshotScore.ts`
assumes iPhone/iPad; `auditFindings.ts` is shaped around the ASC snapshot. We introduce a
thin **store profile + adapter** seam and make the genuinely-shared functions read from a
**normalized listing** plus a **profile**, instead of iOS literals.

### New: `engine/store/types.ts`

```ts
export type StoreId = "appstore" | "googleplay";

/** A metadata field the store exposes, with its budget and ranking role. */
export type RankingSurface = {
  field: string;          // "name" | "subtitle" | "keywords" | "shortDescription" | "description"
  limit: number;          // hard char budget
  indexed: boolean;       // does the store index this field for search?
  role: "title" | "tagline" | "keywordfield" | "longform";
};

export type DeviceFamily = {
  key: string;            // "iphone" | "ipad" | "phone" | "tablet7" | "tablet10"
  primary: boolean;       // the most-shown family (drives the count score)
  label: string;
};

/** Static description of a store's metadata + ranking model. No per-app data. */
export type StoreProfile = {
  id: StoreId;
  fields: RankingSurface[];
  hasKeywordField: boolean;     // iOS: true · Play: FALSE (the load-bearing difference)
  deviceFamilies: DeviceFamily[];
  fastlaneTool: "deliver" | "supply";
};

/**
 * A store-agnostic listing the shared engine reads. Honest tri-state on every
 * text field: a string (incl. "") = MEASURED; `null` = UNREAD/UNMEASURED.
 * `keywordField` is ALWAYS null for Google Play — Play has no keyword field.
 */
export type NormalizedListing = {
  store: StoreId;
  appId: string;                       // bundleId (iOS) / packageName (Play)
  title: string | null;
  tagline: string | null;             // subtitle (iOS) / short description (Play)
  keywordField: string | null;       // iOS keyword field · null on Play
  longDescription: string | null;
  screenshots: { family: string; urls: string[] }[];
  category: { id: string; name: string | null } | null;
  /** Is this source trustworthy for ABSENCE? false → empty set means UNKNOWN. */
  reliable: boolean;
};

/** The per-store plug: resolve a query, read a listing, build the handoff. */
export type StoreAdapter = {
  profile: StoreProfile;
  resolve(query: string, opts?: { country?: string; offset?: number }): Promise<ResolveResult>;
  readListing(appId: string, opts?: { country?: string }): Promise<NormalizedListing>;
};
```

### New: `engine/store/profiles.ts`

The two concrete `StoreProfile` literals. This is the single source of truth for the
field/budget/device differences:

```ts
export const APP_STORE_PROFILE: StoreProfile = {
  id: "appstore",
  hasKeywordField: true,
  fields: [
    { field: "name",        limit: 30,   indexed: true,  role: "title" },
    { field: "subtitle",    limit: 30,   indexed: true,  role: "tagline" },
    { field: "keywords",    limit: 100,  indexed: true,  role: "keywordfield" },
    { field: "promo",       limit: 170,  indexed: false, role: "longform" },
    { field: "description", limit: 4000, indexed: false, role: "longform" }, // iOS does NOT index description for search
  ],
  deviceFamilies: [ { key: "iphone", primary: true, ... }, { key: "ipad", primary: false, ... } ],
  fastlaneTool: "deliver",
};

export const GOOGLE_PLAY_PROFILE: StoreProfile = {
  id: "googleplay",
  hasKeywordField: false,                       // ← no keyword field
  fields: [
    { field: "title",            limit: 30,   indexed: true, role: "title" },
    { field: "shortDescription", limit: 80,   indexed: true, role: "tagline" },
    { field: "description",      limit: 4000, indexed: true, role: "longform" }, // ← Play DOES index the long description
  ],
  deviceFamilies: [
    { key: "phone",    primary: true,  ... },
    { key: "tablet7",  primary: false, ... },
    { key: "tablet10", primary: false, ... },
  ],
  fastlaneTool: "supply",
};
```

The two profiles encode the three Android truths that must not be ported blindly: no
keyword field, the long description *is* the indexed keyword surface, and the device
families are phone/7"/10" (no iPad). `CHAR_LIMITS` in `constants.ts` stays as the iOS
source of truth; the Play limits live on its profile.

### Which existing modules become store-agnostic

| Module | Change | Why |
|---|---|---|
| `engine/screenshotScore.ts` | Generalize `Listing` from `{screenshotUrls, ipadScreenshotUrls}` to a **device-family map** scored against `profile.deviceFamilies` (primary family drives the count budget; non-primary families are the "coverage" bonus). Keep iOS behavior identical when handed the iPhone/iPad families. | Count/aspect/coverage scoring is genuinely store-agnostic; only the family *names* are iOS-specific. |
| `engine/keywordReasoner.ts` | **No structural change.** It already grounds candidates against `{appName, description}` and never assumes a keyword field. For Android we pass the **long description** as `description`. | "LLM classifies, reality validates" is store-neutral — this is the cleanest reuse in the codebase. |
| `engine/keywordGap.ts` | Make `yourMetadataTokens()` read the **profile's indexed fields** instead of literal name/subtitle/keywords; drop the hard-coded 100-char `fitsBudget` (becomes "fits the longform/keyword budget for *this* store"). | The gap concept (terms rivals use that you don't) is shared; only "your metadata" and the budget differ per store. |
| `engine/auditFindings.ts` | Split into a **store-agnostic core** (severity/impact scoring, sorting, summary, the `SurfaceLock` machinery) and **per-store rule sets**. Today's ASC-snapshot rules become the iOS rule set; Android gets its own (below). | The scoring/sort/lock framework is reusable; the per-surface rules are inherently store-specific. |
| `engine/agent.ts` | `runAgent(fetchFn, input)` → `runAgent(adapter, input)`. The orchestration order is identical; it just drives the injected `StoreAdapter` and threads the `StoreProfile` into the shared functions. **Delete the iOS-derived `googleplay`/`gplay` line in `buildPushCommands` (lines 222-229)** — see §4. | One orchestrator, two stores; no fork. |
| `engine/constants.ts` | Keep iOS `CHAR_LIMITS` / `KEYWORD_BUCKETS` as-is. Add the Play long-description ranking notes only as profile data, not new global literals. | iOS constants stay load-bearing; Android specifics live on the profile. |

`metadataCoverage.ts` and `optimize.ts` are **not** force-fitted to be agnostic — their
budget/keyword-field model is too iOS-specific. They get Android siblings (§3) that share
helpers but encode Play's different model honestly. Forcing one function to serve both
budgets would smuggle iOS assumptions into Android, which constraint #3 forbids.

---

## 3. New Android-specific modules

### `engine/play/playDataSource.ts` — the injected data plane (option a)
```ts
export type PlayDataSource = (req: { op: "resolve" | "lookup"; query: string; country: string })
  => Promise<unknown>;     // provider-agnostic, like FetchFn — tests inject a fake
```
Mirrors the `FetchFn` seam exactly: pure + injectable, so the engine never hard-codes a
vendor and unit-tests with zero network. The concrete vendor binding (API key, base URL)
lives in the API layer and is injected in — never in the engine.

### `engine/play/resolvePlayApp.ts` — Android resolution (parallels `resolveApp.ts`)
- Reuses `classifyQuery` from `resolveApp.ts` — it *already* recognizes
  `play.google.com/...?id=com.foo` and dot-separated package ids (`resolveApp.ts:65,81-83`).
- A package id / Play URL → exact lookup via `PlayDataSource`. A name → search via the
  same source, paginated like the iTunes path (`PAGE_SIZE`, `hasMore`).
- Returns the same `ResolveResult` shape so the connect UI is store-agnostic.

### `engine/play/readPlayListing.ts` — listing read → `NormalizedListing`
- Public tier (option a): map the vendor JSON → `NormalizedListing` with
  `reliable: false` (so an empty screenshot/field set grades **UNKNOWN**, never a false
  "grade F", exactly like `dataReliable:false` on iOS).
- Connected tier (option c, optional): map `edits.listings.get` per-language →
  `NormalizedListing` with `reliable: true`. **Read-only** verbs; we never call a write
  verb. `keywordField` is hard-coded `null` either way.

### `engine/play/playKeywordModel.ts` — Play's keyword/long-description model
This is where constraint #3 is honored. Google Play has **no keyword field**; it indexes
the **title (30)**, **short description (80)**, and **long description (4000)**. So:
- **No comma keyword field, no `buildKeywordField`, no `BUCKET_TO_FIELD` Long-tail→keywords
  mapping.** Those are iOS-only and must not appear in the Play path.
- Bucket remap for Play: `Primary → title`, `Secondary → short description`,
  `Long-tail → woven into the long-description body`, `Aspirational → tracked only`.
- The model is **keyword *coverage / density* in the indexed text**, not budget-packing
  into a 100-char field. We surface: which target terms appear in title/short/long desc,
  which high-value terms are absent from the long description, and a **stuffing guard**
  (over-repetition of a term is a Play-ranking *risk*, the inverse of iOS's "fill the
  field"). Term *presence* is measured (we can read the text); term *value/volume* is
  **not** measured → reported as unmeasured (constraint #1).
- Reuses `keywordReasoner.ts` unchanged to ground candidate terms against the long
  description.

### `engine/play/playCoverage.ts` — Android coverage (sibling of `metadataCoverage.ts`)
- Budget is **title 30 / short 80 / long 4000**, not 30/30/100.
- "Waste" is redefined for Play: the iOS "Apple counts a cross-field dupe once" rule
  doesn't apply; the Play analogues are **keyword stuffing** (over-repetition in the long
  description) and **title brand-burn**. Shares the `tokenize`/`FieldFill`/`seen`
  (measured-vs-unseen) helpers with the iOS module so the honesty contract is identical.
- `coverageScore` stays "how hard your indexed text is working," never "your rank."

### `engine/play/playFindings.ts` — the Android rule set for `auditFindings`
Per-surface rules against the `NormalizedListing`: missing/short title, missing short
description, thin long description (under-using the 4000 indexed chars), screenshot grade
(via the generalized `screenshotScore`), missing feature graphic, category sanity, no
privacy policy. Plugs into the store-agnostic findings core from §2. Where the public tier
can't see a surface, it emits an Android `SurfaceLock` ("we can't see this without
connecting Play"), not a deficiency.

---

## 4. `fastlane.ts` — re-introducing `supply`/`metadata/android` honestly

`fastlane.ts` today deliberately emits **no** `metadata/android` tree, with a comment
saying Android was removed because Play support wasn't real (`fastlane.ts:16-19`). This
plan makes it real, under a strict gate.

**Two changes:**

1. **Remove the dishonest iOS-derived Play command first.** `agent.ts:222-229`
   (`buildPushCommands`) currently emits a `gplay listing update --title <iOS name>
   --short-description <iOS subtitle>` command **synthesized from iOS copy**. That is the
   exact anti-pattern constraint #3 forbids (Android output derived from iOS copy, no real
   Play audit behind it). Delete it. The Play handoff is emitted *only* by the gated path
   below.

2. **Add a gated `metadata/android` writer.** New `buildFastlaneSupply(copy, listing)` (or
   a `store: "googleplay"` branch in `buildFastlaneBundle`) that writes
   `fastlane/metadata/android/<lang>/{title,short_description,full_description}.txt` for
   `fastlane supply`.

**The gate — emit `metadata/android` only when ALL hold:**
- A **real Play `NormalizedListing` was actually read** for this package (public or
  connected tier), AND
- the field's proposed value is grounded in that **Play** read or in Play-specific
  authoring — **never** in iOS `CopyFields`. The function takes the Play `NormalizedListing`
  as a required argument; it cannot be called with only iOS copy.
- Apply the **existing per-field omission rule** (`fastlane.ts:29-36`): a field we didn't
  read/propose produces **no file**, never a blank one — because an empty `.txt` makes
  `supply` **wipe** the live Play value. This is the same safeguard the iOS path already
  enforces, and it's doubly important for the long description.

Because `supply` pushes to the **owner's** Play listing via their service account, the
honest source for the supply tree is the owner-grounded read (option c) — though a public
read of the owner's own package is acceptable as long as every emitted field was genuinely
read for *that package*. The `SHIPASO_README.md` gains a `supply` section mirroring the
`deliver` one, including the same "⚠️ this OVERWRITES live metadata — review the diff"
warning. Credentials stay in the user's CI; ShipASO never holds them and never pushes
(constraint #2).

---

## 5. Test plan (`*.spec.ts`, fixtures, no live network)

All tests are colocated `*.spec.ts`, vitest, fixture-driven (zero live network) — matching
the existing suite. The injected `PlayDataSource`/`FetchFn` seams make this trivial.

| Spec | Proves |
|---|---|
| `store/profiles.spec.ts` | Play profile has `hasKeywordField:false`, fields title/short/long with 30/80/4000, no iPad family; iOS profile unchanged. |
| `play/resolvePlayApp.spec.ts` | Play URL → package id; package id → exact lookup; name → paginated candidates; not-found path; reuses `classifyQuery`. Fake `PlayDataSource`. |
| `play/readPlayListing.spec.ts` | Vendor JSON fixture → `NormalizedListing`; **`keywordField` is always `null`**; public tier sets `reliable:false`; empty screenshot set stays UNKNOWN, not "F"; connected-tier fixture sets `reliable:true`. |
| `play/playKeywordModel.spec.ts` | No keyword field is ever produced; buckets map to title/short/long; **term presence is measured but term value is reported unmeasured**; stuffing guard fires on over-repetition; grounding rejects a term absent from the long description. |
| `play/playCoverage.spec.ts` | Budgets are 30/80/4000; stuffing flagged as waste; an unseen field reads UNKNOWN (`seen:false`), never a false "0/limit"; clean listing scores 100. |
| `play/playFindings.spec.ts` | Thin long description, missing short description, missing feature graphic, low screenshot grade; an unreadable surface emits a `SurfaceLock`, **never a deficiency**; absent surface emits nothing and never throws. |
| `screenshotScore.spec.ts` (extend) | Device-family generalization scores Android phone/tablet sets; **existing iPhone/iPad cases stay byte-identical** (no regression). |
| `fastlane.spec.ts` (extend) | `metadata/android` emitted **only** when a real Play listing is passed; an unread field writes **no file** (never a blank that wipes `supply`); README gains the `supply` section. |
| `agent.spec.ts` (extend) | `runAgent` with the Play adapter produces a Play audit; **the old iOS-derived `gplay` push command is gone**; iOS run output unchanged. |
| `auditFindings.spec.ts` (extend) | The store-agnostic core still produces identical iOS findings after the iOS rules are extracted into a rule set. |

Honesty is asserted as **test invariants** (the codebase already does this for iOS, e.g.
the surface-lock "never assert a deficiency in an unseen field" test): no Android spec may
assert a measured search-volume number, and every "unmeasured" path must round-trip as
`null`, never a fabricated value.

---

## 6. Honesty guardrails — where "unmeasured" must appear for Android

Constraint #1 (never present unmeasured data as measured) maps to these concrete Android
null/unmeasured points:

1. **No search-volume numbers, ever.** Neither the licensed API nor the Developer API
   returns measured per-keyword Play search volume. The Play keyword model reports term
   **presence** (measured — we read the text) and a **null/"unmeasured"** for term value,
   exactly like the iOS path declines to show fake keyword volume.
2. **Public-tier absence is UNKNOWN, not zero** (`reliable:false`). An empty screenshot set
   or unread field from the licensed API grades `?`/UNKNOWN, never "grade F" — the direct
   port of iOS's `dataReliable:false` rule (`screenshotScore.ts:251-273`).
3. **`keywordField` is structurally `null` for Play.** Not "empty" — *absent*, because the
   field doesn't exist. The UI must render this as "Google Play has no keyword field," never
   a "0/100" that implies an unfilled iOS field.
4. **Public vs connected tier = surface locks.** Owner-only Play fields we can't see on the
   public tier render as Android `SurfaceLock`s ("connect Play to read + improve"), framed
   as a capability gap, never a deficiency — reusing the iOS lock machinery.
5. **`metadata/android` is omitted, not blanked.** A field ShipASO didn't read for the Play
   package produces no `.txt` file, so `supply` can't wipe a live value (§4).
6. **Rating/installs are buckets, shown as given.** If the licensed API returns an installs
   *range* ("100k–500k"), we surface the range verbatim — never a fabricated point estimate.

---

## Build order (suggested)

1. `store/types.ts` + `store/profiles.ts` + `store/profiles.spec.ts` (the seam, no behavior change).
2. Generalize `screenshotScore.ts` (keep iOS identical) + extend its spec.
3. `play/playDataSource.ts` + `play/resolvePlayApp.ts` + `play/readPlayListing.ts` (+ specs) — the data plane.
4. `play/playKeywordModel.ts` + `play/playCoverage.ts` + `play/playFindings.ts` (+ specs) — the Play model.
5. Make `auditFindings.ts` core/rules split; wire `keywordGap.ts` to the profile.
6. `agent.ts`: `runAgent(adapter, …)`, **delete the iOS-derived `gplay` command**.
7. `fastlane.ts`: gated `buildFastlaneSupply` + README; extend its spec.
8. Export the new surface from `engine/index.ts`.

Each step is independently testable and leaves iOS behavior unchanged, so Android lands
incrementally without a big-bang fork.

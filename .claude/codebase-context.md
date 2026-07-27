# store-ops (ShipASO) — codebase context

An autonomous ASO agent: it audits an app's store listing, proposes metadata
changes, and **stops at the customer's approval**. Cloudflare-native (Workers +
D1 + Cron + Pages), with a React web app and an Expo mobile app over a shared
spine.

> **Maintenance.** Hand-written, not generated. Paths here are enforced by
> `packages/docpaths/lint.mjs`, which runs in the `spine` CI job — a path that
> stops existing fails the build. Prose claims are NOT enforced; when you change
> behaviour this file describes, update it in the same PR.

## Writing paths in docs

The linter only checks paths carrying a repo-root prefix — `cloud/…`,
`mobile/…`, `packages/…`, `docs/…`, `scripts/…`, `lib/…`, `.github/…`,
`.githooks/…`. **When a doc is asserting that a specific file exists at a
specific place, write the full path from the repo root**, so a later move breaks
the build instead of quietly misleading someone. That is the class that has
actually bitten: `mobile/STORE.md` sent people to edit association files at
`cloud/public/.well-known/` for weeks after the directory was deleted.

Do **not** mechanically prefix every filename. Two attempts to widen the linter
to bare and workspace-relative references were measured against this repo and
rejected — the first flagged 39 documents, the second 17, and on inspection
essentially every finding was a false positive. Most bare references are
legitimately contextual and should stay as they are:

- **procedural steps** — `cloud/DEPLOY.md` says "Edit `public/config.js`" at a
  point where the reader is inside `cloud/web`. Correct as written.
- **concepts, not locations** — `plans/001` discusses `generated/tokens.css`
  meaning "the generated palette", not a path to verify.
- **runtime outputs** — `.asc/screenshots.json` does not exist until the tool
  runs. Asserting it exists would be wrong.

The distinction is whether the doc is making a **claim about where a file is**
(prefix it) or **naming something in context** (leave it). A linter cannot tell
those apart, which is why this is a convention rather than a rule.

## The two invariants everything else serves

**1. Measured-or-nothing.** Every number shown is measured or absent. An
unmeasured value renders `—`, or its clause is omitted. Never a plausible
placeholder, never `0`. `packages/honesty/` holds the shared primitives
(`formatRank`, `classifyDelta`); `direction: "lost"` (measured, fell out) is
deliberately distinct from `"unmeasured"` (never read).

**2. Approval is the terminus.** No copy may claim ShipASO pushes to a store on
its own. Approving is not shipping; an approved run reveals a handoff. Push is
always an explicit, separate click on an already-approved run.

Key material is never displayed back to the user — stored credentials surface as
metadata only.

## Layout

| Path | What |
|---|---|
| `cloud/src/` | The Worker: API, engine, cron, MCP. `cloud/src/api/index.ts` is the router (~4.9k lines; contains a deliberate NUL byte, so use `rg -na` on it) |
| `cloud/src/engine/` | Audit + proposal logic. Pure where possible, unit-tested |
| `cloud/src/cron/` | Scheduled sweeps (`keyedSweep.ts`, `analyticsIngest.ts`) |
| `cloud/src/crypto/credentialVault.ts` | Envelope crypto (KEK→DEK). Pure; `cloud/src/credentialStore.ts` is the D1 + env glue |
| `cloud/web/` | The web app (Vite + TanStack Router/Query). **This is the site** — its `dist/` is the Pages deploy root |
| `cloud/web/public/` | Ships verbatim: `_headers`, `config.js`, `/auth/m` magic-link landing, `.well-known/*` association files |
| `mobile/` | Expo app. **Jest**, not vitest |
| `packages/` | Shared spine: `tokens` (design tokens), `honesty` (pure helpers), `api` (typed client), `docpaths` (this file's linter) |
| `lib/`, `scripts/` | Python screenshot renderer + local tooling |

## Testing

| Workspace | Runner | Command | Count |
|---|---|---|---|
| `cloud` | vitest | `npm test` | ~2160 |
| `cloud/web` | vitest | `npx vitest run` | ~560 |
| `cloud/web` E2E | Playwright | `npx playwright test` | 14 |
| `mobile` | **jest** | `npm test` | ~365 |
| `packages` | `node --test` | `npm test` | tokens + honesty + docpaths |

Conventions: `*.spec.ts` in cloud, `*.test.tsx` in web and mobile — match the
directory you are in. TDD is expected: scaffold, write the failing test, verify
it fails **for the right reason**, then implement.

A guard test that has never been seen red is not yet a guard. `rejects.toThrow(SomeClass)`
passes vacuously when the class is `undefined`; assert `instanceof` instead.

E2E runs against the **built** `dist/` via `cloud/web/tests-e2e/serve.mjs`, with
a Playwright-routed mock backend (`tests-e2e/mocks.ts`). No live Worker or D1.
`cloud/web/tests-e2e/honestyFlows.e2e.ts` guards the invariants above end to end.

## Gates

`.githooks/pre-push` runs typecheck → unit → (build → E2E if the push touches
`cloud/web/`). CI mirrors it across four jobs: `check`, `web`, `mobile`, `spine`.
Merging to `main` deploys the Worker, applies D1 migrations, and publishes both
Pages projects.

## Traps this repo has actually hit

- **`resolveSurface`'s string arm is a prefix match.** Use a RegExp for exact
  route ownership in `cloud/web/src/shell/edgeRoutes.ts`.
- **CSS specificity in `cloud/web/src/app.css`**: `.a.b` (0,2,0) beats `.a`.
  Never redeclare a canonical token there — `cloud/web/src/tokenSourceOfTruth.test.ts`
  enforces it.
- **`vi.spyOn(Storage.prototype, …)` silently no-ops** in this jsdom setup; stub
  the global directly.
- **KEK rotation is additive.** Add `CRED_KEK_V2`; never overwrite `CRED_KEK_V1`.
  Overwriting orphans every stored credential — see `docs/prd/credential-storage/00-design.md`.
- **Check secrets by name**: `npx wrangler secret list | grep CRED_KEK`. The
  bare list is long enough to scroll past, which is how an incident started.
- **Stale docs beat stale code.** Several modules have described work as
  unbuilt long after it shipped. Verify against the source before trusting a
  comment, an issue, or this file.

## Deliberate absences

Things that look missing but are not:

- **No `sharedTerms` count** on competitors — rival-vs-our-keyword rank is never
  persisted, so the number could only be estimated. An absent count is honest.
- **No keyword volume/difficulty** — no measured source. Apple Search Ads
  popularity is built but dark behind `ASA_POPULARITY_ENABLED`, pending live
  verification.
- **No experiment-create or screenshot-upload write.** Screenshot *planning* and
  rendering exist; the two ASC writes that would ship an A/B test do not.

# Loop — the MCP is the front door (scoped 2026-09-05)

**Scoped by:** Adam, 2026-09-05 ("You make the goal and exit criteria. Main
branch. Same stuff that's usually off limits.") · **Runs while he sleeps.**
**Ceiling, not a floor** — finishing early and stopping is correct.

## The finding this loop acts on

ShipASO has 31 plugin skills, 13 MCP tools live in production, and one GitHub
star. No stranger has ever walked the funnel. The hosted MCP server
(`cloud/src/mcp/`, mounted at `POST /mcp`) shipped with #93 and works — but
`docs/prd/mcp-server.md` still says *"deferred, not in launch scope"*, the
landing page never mentions it, the README mentions it in a blockquote on
line 49, and **the whole route sits behind `requireUser`**: a stranger with no
account cannot even run `tools/list`.

Meanwhile `POST /preview` and `GET /proof` are already public, account-free
HTTP routes that run the same engine. The two surfaces never met.

## Goal

**A stranger can add the ShipASO MCP with one command and no account, get a
real measured preview of any App Store app, and be told exactly how to unlock
the rest.**

```
claude mcp add shipaso --transport http https://api.shipaso.com/mcp
```

— no `--header`, no key, no sign-up — and it works.

## Exit criteria (each verifiable, each fails today)

1. **Anonymous `initialize` and `tools/list` succeed** on `POST /mcp` with no
   `Authorization` header. Today: 401 before the transport is reached.
2. **The public tier runs without a key.** Exactly the tools that are already
   public over HTTP: `preview_app` (the `/preview` teaser) and `proof` (the
   `/proof` aggregate). No new tier is invented — the product's existing
   try-before-signup policy is mirrored, not widened.
3. **Every other tool stays keyed, fail-closed.** Called anonymously, a keyed
   tool returns a JSON-RPC *tool error* (so the client stays connected) whose
   text says where to mint a free key and how to re-add the server with it.
   A spec iterates the whole registry and asserts each non-public tool rejects
   an anonymous context — a detector that can return "no".
4. **A present-but-invalid key is a 401, never a silent downgrade.** A typo'd
   key must not make a paying user think the product is limited.
5. **Anonymous `preview_app` is cost-bounded the same way `/report` is:** the
   six-hour `publicReportGuard` cache (the real bound) plus the app-keyed
   `REPORT_LIMITER` damper (fails open, per its documented caveats — never
   described as a spend cap).
6. **The repo says what is true.** `docs/prd/mcp-server.md` status flips from
   "deferred" to shipped-with-facts; the README's install section leads with
   the keyless `claude mcp add`; the landing page has an MCP section; the
   registry gets a row. Guarded where a guard is cheap.
7. **A registry listing is prepared, not published.** The MCP registry
   `server.json` lands in-repo; submitting it is a public act and is Adam's.
8. **All gates green on every PR:** cloud `tsc --noEmit` + `vitest run`,
   `packages` `node --test`, docpaths linter.

## Off limits (from the standing rules + this scoping)

- Never merge; never push `main`. Merging is what deploys the Worker and the
  Pages sites, so production stays untouched by construction.
- No secrets, no `wrangler secret`, no live config edits. `wrangler.toml` is
  code and may change in a PR; it deploys only on Adam's merge.
- No public posts, no directory submissions, no store actions.
- No work outside this document. A bug found that does not block an exit
  criterion is filed as an issue, not fixed.

## PRs (small, each reviewable alone)

| # | Branch | What |
|---|---|---|
| 1 | `loop/mcp-front-door-scope` | This document |
| 2 | `loop/mcp-public-tier` | Criteria 1–5: anonymous MCP with the public tier, keyed tools fail-closed, cache + damper reuse |
| 3 | `loop/mcp-front-door-docs` | Criterion 6: PRD, README, landing, registry, a drafted (unposted) story beat |
| 4 | `loop/mcp-registry-manifest` | Criterion 7: `server.json` for the MCP registry, unsubmitted |

## Log

- 2026-09-05 01:41Z — (before the loop) 0.1.1 submitted to App Review; PR #527
  opened with the shipaton work. Loop scoped.
- 2026-09-05 — #528 (this scope) opened.
- 2026-09-05 — Criteria 1–5: `loop/mcp-public-tier` → **#529**. Registry-level
  `keyed()` gate; `optionalUser` in the router (no credential → anonymous;
  presented-but-invalid → 401); anonymous `preview_app` reuses the `/report`
  cache + damper. `publicTier.spec.ts` (12) + `mcpAuth.spec.ts` (5) +
  guard spec (5); cloud suite 2918/2918; `tsc` clean.
- 2026-09-05 — Criterion 6: `loop/mcp-front-door-docs` → **#530**. PRD status
  corrected with a "what shipped vs the plan" table; README "Zero install"
  section; landing `#mcp` section. Registry row + journey entry + drafted
  (unposted) story beat went to #527's branch instead, because it already
  reshapes those files.
- 2026-09-05 — Criterion 7: `loop/mcp-registry-manifest` → **#531**.
  `server.json` validated against the registry's JSON schema (0 errors;
  negative control 2 errors); guard pins version + URL; publish runbook.
  Not published.
- 2026-09-05 — Criterion 8: gates green on every PR at open time.

## Status at hand-off

| Criterion | PR | State |
|---|---|---|
| 1–5 public tier, fail-closed keys, cost bound | #529 | open, green locally |
| 6 the repo says what is true | #530 (+ #527 for registry/feed) | open |
| 7 registry manifest, unpublished | #531 | open |
| 8 gates | all | green at open; CI is the final word |

**Not done, by the rules:** nothing merged, nothing deployed, nothing posted,
nothing submitted to the registry. **Found and filed nowhere because it does
not block a criterion:** none.

**Reading order for review:** #528 → #529 → #530 → #531; #527 is the separate
shipaton branch (0.1.1 resubmission) and carries the journey entry.

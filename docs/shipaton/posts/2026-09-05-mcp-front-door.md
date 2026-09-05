# Story beat — "The MCP shipped in July. The roadmap still said deferred."

Drafted 2026-09-05 by the overnight loop. **Not posted.** Post to X first, then
Bluesky, then the Shipaton Discord #post-engagement-boost. Record the post URL
in `docs/landing/journey/feed.json` (the 2026-09-05 entry) under `links.post`.
Post only after the PRs it describes are merged, or say plainly they are open.

Every claim below is verified — see "Receipts". Do not add a number that is
not in that list.

---

## The thread (X)

**1/**
Took stock of ShipASO tonight before the growth push.

31 plugin skills. 12 live MCP tools. One GitHub star.

That's not a product problem. 🧵

**2/**
While reading the roadmap I found our own second distribution channel — a
hosted MCP server — marked "deferred, not in launch scope."

It has been running in production since July.

The docs described it as unbuilt for two months.

**3/**
Worse: the whole endpoint sat behind login. A stranger who ran
`claude mcp add` couldn't even list the tools without an account.

Meanwhile the website already gave away a real audit preview with no signup.
Two surfaces, same engine, never met.

**4/**
So tonight:

`claude mcp add shipaso --transport http https://api.shipaso.com/mcp`

No key. No account. Your agent gets a measured preview of any App Store app.
Every other tool tells you where a free key comes from.

**5/**
Rules that didn't move: no MCP tool writes to a store. Ever. The registry
literally cannot hold one — a test forbids it.

Approving is still your click. An agent drafts; a human ships.

**6/**
Four PRs, all open, all reviewable. The registry listing is written but not
published — that's a human's button.

The lesson I keep re-learning: check what's deployed before you trust what's
documented. shipaso.com/journey

---

## Short version (Bluesky)

Audited my own roadmap tonight. Found the "deferred" MCP server had been live
in production since July — and locked behind login, so nobody could try it.

Now: `claude mcp add shipaso --transport http https://api.shipaso.com/mcp` — no
key, no account, a real measured preview of any App Store app. Nothing on that
surface can write to a store. Four PRs open. shipaso.com/journey

---

## Receipts (verified 2026-09-05)

- 31 skills: `ls skills/ | wc -l`. 12 MCP tools: `cloud/src/mcp/tools.spec.ts`
  pins the set. 1 star / 1 fork: GitHub API, 2026-09-04.
- MCP live in production before any change: `POST https://api.shipaso.com/mcp`
  → **401** (authenticating, not absent). Shipped with #93.
- `docs/prd/mcp-server.md` read "Status: deferred. Not in the launch scope."
  until PR #530.
- Public tier PR #529: 2918/2918 cloud tests; `publicTier.spec.ts` proves every
  keyed tool refuses an anonymous caller without touching the network.
- No write tool: `tools.spec.ts` rejects any tool whose name implies a write.
- Manifest PR #531: validated against the registry's JSON schema, 0 errors,
  negative control 2 errors. Not published.

## Do NOT claim

- That any of it is merged or deployed until Adam merges it.
- Any usage number. Anonymous vs keyed calls are not measured.
- That 0.1.1 is approved. It is **in review** (submitted 2026-09-05 01:41Z).
- That the agent ships to a store on its own. Approving is not shipping.

---
name: shipaso-mcp
description: Connect your AI agent to the hosted ShipASO MCP server and drive the ASO loop over it — audit a live listing, find keyword gaps, check ranks, watch competitors, and score screenshots, all as agent tools. Use when you want to run ShipASO from Claude Code / Cursor / any MCP client instead of the local plugin, or to wire up a `shipaso_` API key. Read/draft only — nothing pushes to a live store from here. Use when the user says "connect the ShipASO MCP", "add the shipaso mcp server", "set up my shipaso key", "run ShipASO from Claude Code", or "use the hosted ShipASO tools".
---

# shipaso-mcp

The **local plugin** (the other 27 skills) runs the loop on your machine. The
**hosted MCP** runs the same engine on ShipASO's servers and exposes it to your
agent as tools — handy when you want the reasoning without installing the Python
libs, or want a teammate's agent to hit the same account.

> Read/draft only by construction: the MCP tools audit, rank, and propose — none
> of them writes to a live App Store / Play listing. Shipping stays a human,
> approved action in the ShipASO app.

## One-time setup

1. **Mint a key.** In the ShipASO app (app.shipaso.com) → Settings → Agent
   access → *Generate key*. The raw `shipaso_…` key is shown **once** — copy it
   then (only its hash is stored; it can never be shown again). Revoke any time;
   it doesn't touch your login.

2. **Add the MCP server to your agent.** In Claude Code:

   ```
   claude mcp add shipaso --transport http https://api.shipaso.com/mcp \
     --header "Authorization: Bearer <your shipaso_ key>"
   ```

   Cursor / other MCP clients: point them at `https://api.shipaso.com/mcp` with
   the same `Authorization: Bearer <key>` header. An invalid or missing key gets
   a 401 before any tool runs.

## The tools it exposes

All read-or-draft — safe to call freely.

| Tool | What |
|---|---|
| `preview_app` | A logged-out-style teaser audit for any app (grade, lead rank, sample). |
| `audit_app` | Score a live App Store listing field-by-field. |
| `audit_play_app` / `audit_play_app_owner` | The same for Google Play (public / owner-keyed). |
| `keyword_gaps` | Terms competitors rank for that you don't — the winnable set. |
| `rank_check` | Your organic App Store rank for given keywords (measured, "—" when unranked). |
| `screenshot_coverage` | Score a screenshot set (count, device coverage, aspect). |
| `competitor_watch` | Visible competitor listing changes over time. |
| `war_room` | Head-to-head rank grid vs. named competitors. |
| `localization_gaps` | Locales worth adding, ROI-sorted. |
| `propose_copy` | Draft optimized, char-limit-correct copy — a proposal only, never pushed. |
| `proof` | Public aggregate proof (measured rank movements). |

## How to drive the loop over MCP

Natural-language works — the tools are named for intent:

- *"Audit `<app>` and tell me the weakest field."* → `audit_app` → the score
  breakdown; follow up with `keyword_gaps` for the fix direction.
- *"What keywords could `<app>` realistically win?"* → `keyword_gaps` +
  `rank_check` to see where you stand today.
- *"How do I stack up against `<competitor>`?"* → `war_room`.

For the **execution** half (generate char-limit-correct copy, then push), use the
local plugin's `aso-metadata-optimization` + the `asc`/`gplay` CLIs, or the
hosted app's approve→push flow — the MCP surface is deliberately read/draft.

## Honesty + safety (load-bearing)

- **Nothing ships from the MCP.** Every tool is read-or-draft; there is no
  push/write tool on this surface. Shipping is a separate, human-approved action.
- **Measured or absent.** Ranks are the real position or an honest "—" (not in
  top 200) — never a fabricated number.
- **Your key is scoped + revocable.** It's tied to your account, reaches only the
  read/draft tools, and revoke is immediate — it can't touch your session or push
  anything.

## Honest limits

- The hosted MCP needs a ShipASO account + a `shipaso_` key (free to mint). The
  **local plugin needs neither** — if you'd rather run everything on your own
  machine with no account, use the plugin's skills directly (start with
  `aso-audit`).
- Read/draft only: to actually ship a change, take the proposal to the
  approve→push flow (hosted app) or the CLI handoff (plugin). That boundary is
  intentional — nothing writes to your live store without an explicit approval.

## No external dependency (beyond the account)

The MCP is ShipASO's own hosted endpoint on your own account data — no third
paid ASO API. The local plugin remains fully free + offline-capable.

> Prefer to keep everything on your machine? The **free plugin** is the whole
> loop, no account: `/plugin marketplace add airowe/store-ops`. The hosted MCP
> just lets an agent drive the same engine without a local install. →
> https://shipaso.com/install

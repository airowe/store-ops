# PRD — ShipASO MCP server (DEFERRED, post-launch)

> **Status: deferred. Not in the launch scope.** This plans a second
> distribution channel for *after* the current closed-loop product launches and
> shows early conversion. Motivated by the [AppKittie competitive
> read](../competitive/appkittie.md): a funded competitor ships a paid MCP with
> an ASO skill, proving MCP is a real channel for this exact buyer. We enter it
> on **our** terms — exposing the closed loop, not copying their breadth.

Slots into **Phase 3 (Expand — second acquisition channel)**. Do not start until
the Phase 3 trigger (Autopilot retains; multi-app pull is real) AND launch has
shown free→paid conversion.

## Thesis

The differentiator isn't "an MCP that suggests ASO copy" — AppKittie has that.
It's an MCP that **runs our closed loop from inside the agent**: audit a listing,
read the live metadata (via the user's `.p8`), propose an improvement that can't
regress a good listing, and — on approval — push and later prove the rank moved.
Intelligence tools tell you what to write; our MCP *ships it and verifies it*.

## Why it's the right second channel

- **Same buyer, same install motion** the free plugin already targets
  (Claude Code / Cursor / Windsurf users), now reachable as `claude mcp add`.
- **Reuses the engine we already built** — `src/engine/{agent,optimize,ascWrite}`
  and the REST API. The MCP is a thin protocol adapter over existing logic, not
  new product surface.
- **Monetization is natural**: the MCP authenticates as the hosted account, so
  tier gates (free/launch/autopilot/fleet) and billing already apply. No new
  credit system needed for v1 — reuse the account's plan limits.

## Scope (v1 — thin, loop-faithful)

Expose **only** what serves the closed loop. Resist breadth.

| Tool | Maps to | Notes |
|---|---|---|
| `audit_listing` | existing audit / `/preview` | name, description, rank sample, audit grade — the public read |
| `read_live_metadata` | `readAscLocalization` (#30 Mode A) | requires the user's `.p8`/keyId/issuerId; **ephemeral, never persisted** — same promise as the dashboard |
| `propose_metadata` | `optimizeCopy` | read-and-improve; live subtitle/keywords are a floor (no regression). Without a key: omit subtitle/keywords (honest, no blind overwrite) |
| `push_metadata` | `applyAscMetadata` / fastlane path | **gated behind explicit approval** — never auto-push; returns a diff for the human to confirm |
| `rank_deltas` | `/apps/:id/deltas` + `rankDeltasView` | week-over-week proof — the thing competitors can't show |

**Auth:** Bearer API key tied to a hosted ShipASO account (mirror AppKittie's
`appkittie_…` pattern → `shipaso_…`). Plan limits flow from the account.

**Skills (optional, v1.1):** one skill — *"Ship & verify an ASO change"* — that
chains audit → propose → (approve) → push → schedule-verify. The skill teaches
the loop; the tools execute it.

## Hard constraints (carry over from the product)

- **`.p8` is ephemeral.** Used per-request to mint the ASC JWT, never stored.
  Same as the dashboard's run-asc path. This is non-negotiable.
- **Never auto-push.** Any tool that writes to App Store Connect requires an
  explicit approval turn returning a reviewable diff first. The agent proposes;
  the human approves; only then do we touch their live listing.
- **No blind overwrites.** If we can't read a field (no key), we don't write it.
- **Don't rebuild their data moat.** No revenue estimates, no ad spy, no creator
  lists in v1 — those are breadth bets that need a data moat we don't have. Stay
  on the loop.

## Acceptance criteria (when we do build it)

- `claude mcp add shipaso …` connects with a `shipaso_…` key in under a minute.
- The five v1 tools work against the live API; `push_metadata` cannot fire
  without an approval diff; `.p8` is never persisted (verified).
- A real user runs audit → propose → push → rank_deltas end-to-end from inside
  their agent and sees the rank move on the next sweep.
- Tier limits and billing apply through the MCP exactly as on the dashboard.

## NOT in this PRD

- Revenue/download/ad-spend/creator/discovery breadth (that's AppKittie's game;
  not ours, not now).
- A separate credit-metering system — reuse account plan limits for v1.
- Anything that ships before launch converts. **This is deferred by design.**

# PRD 01 — MCP server: expose ShipASO as agent tools

**Status:** Proposed
**Priority:** P0 (highest-leverage parity item; also *widens* the wedge)
**Closes gap:** Appeeky ships an MCP server "exposing every data point as a tool"
for Claude/Cursor/Windsurf. We have none.

---

## Problem

Appeeky's MCP server lets a developer's coding agent call their ASO data directly
from the IDE. This is a real distribution channel: our buyers (indie devs) live in
Claude Code / Cursor. They get an agent-native ASO surface; we don't.

Critically, this is the *one* parity item that also strengthens our wedge: our
differentiator is the **closed prepare → approve → push → prove loop**. Exposing
that loop as MCP tools puts it where the buyer already works — and "prove the rank
moved, callable from your agent" is something Appeeky's *advice-only* surface
can't match even if they ship an MCP server.

## Goals

1. A ShipASO MCP server exposing **read-only, side-effect-free** ASO data + the
   proof surfaces as tools.
2. Reuse the existing, tested engine functions — no new ASO logic.
3. Auth via the user's existing ShipASO session/token; fail-closed.
4. The push step is **explicitly NOT** an MCP tool (see Non-goals).

## Non-goals

- **No write/push tools.** The store-push approval gate is a human-in-the-loop UI
  action by design (and #34 is never-auto-build). MCP exposes *preparation and
  proof*, never *execution*. An agent can draft and read; a human approves+pushes.
- No new ASO algorithms — this is a transport/adapter layer.
- Not bundling our own MCP client; we publish a server others' clients connect to.

## Proposed tools (all map to existing engine functions)

| MCP tool | Backing function | Side effects |
|---|---|---|
| `preview_app` | `engine/preview.ts` + `resolveApp.ts` | none (read) |
| `audit_app` | `engine/auditFindings.ts` | none (read) |
| `keyword_gaps` | `engine/keywordGap.ts` | none (read) |
| `rank_check` | `engine/rankCheck.ts` / `rankOpportunity.ts` | none (read) |
| `war_room` | `engine/rankWarRoom.ts` | none (read) |
| `competitor_watch` | `engine/competitorWatch.ts` | none (read) |
| `localization_gaps` | `engine/localizationExpansion.ts` | none (read) |
| `screenshot_coverage` | `engine/screenshotScore.ts` | none (read) |
| `proof` | `/proof` route logic | none (read) |
| `propose_copy` (draft only) | `engine/optimize.ts` + `api/proposalEdit.ts` | none — returns a draft, does **not** persist or push |

## Architecture

- New module: `cloud/src/mcp/server.ts` implementing the MCP server protocol
  (JSON-RPC over the transport the Worker exposes — streamable HTTP).
- A thin `cloud/src/mcp/tools.ts` registry mapping tool name → existing engine fn
  + a JSON Schema for inputs (mirrors how the Worker already validates API bodies).
- Auth: reuse the existing session token check from `api/index.ts`; an unauthed
  call returns an MCP error, never data. Read-only tools may allow the same
  public access the `/preview` route already grants.
- Served from the existing Worker under a `/mcp` route — no new deployment unit.

## Security / safety

- Inherits the Worker's fail-closed auth. No tool touches the `.p8`, ASC write
  paths, or the store-push flow.
- Rate-limit parity with existing API routes.
- All tools are read-or-draft; the irreversible action (push) stays a UI-gated,
  human-approved step. This must be stated in the tool descriptions so a calling
  agent can't misread `propose_copy` as "it will publish."

## Success criteria

- A developer can add ShipASO to Claude Code's MCP config and call `audit_app`,
  `keyword_gaps`, and `proof` against their own app.
- Zero write/push capability reachable via MCP (verified by a test asserting the
  tool registry contains no mutating tool).
- Each tool has a unit test asserting it delegates to the real engine fn and
  returns the same shape as the corresponding HTTP route.

## Open questions

- Token scoping: a dedicated MCP token vs. reusing the session token?
- Do we expose `propose_copy` at launch, or read-only tools first? (Lean:
  read-only first; add the draft tool once the description/safety wording is
  reviewed.)

## Rough size

**M** — bounded adapter over existing tested functions; the work is the MCP
transport + auth wiring + the tool registry, not new ASO logic.

# PRD — ShipASO MCP server (SHIPPED — it is the front door)

> **Status: shipped and live.** `POST /mcp` on `api.shipaso.com` serves the
> registry in `cloud/src/mcp/` (#93). Until 2026-09-05 this document said
> *"deferred, not in launch scope"* while the server had been answering in
> production for weeks — the repo's recurring failure of docs describing work as
> unbuilt long after it shipped. Corrected by the loop scoped in
> `docs/shipaton/loops/2026-09-05-mcp-front-door.md`.

## What is live (verified 2026-09-05, not read off a status doc)

| Fact | How it was checked |
|---|---|
| `POST /mcp` is deployed and authenticating | live call → 401 (not 404) before the front-door change; the transport answers after it |
| 12 tools registered, every one `readOnly: true` | `cloud/src/mcp/tools.ts`; `tools.spec.ts` asserts the invariant and pins the set |
| Streamable HTTP, stateless, official SDK | `cloud/src/mcp/server.ts` |
| Keys: `shipaso_…`, hashed at rest, revocable | `cloud/src/apiKeys.ts`; minted at app.shipaso.com → Settings → Agent access |
| Setup skill | `skills/shipaso-mcp/SKILL.md` |

## The front door (loop 2026-09-05)

A stranger can run

```
claude mcp add shipaso --transport http https://api.shipaso.com/mcp
```

with no key and no account. Anonymous callers get `initialize`, `tools/list`,
and the **public tier** — exactly the two tools that were already public over
HTTP: `preview_app` (≙ `POST /preview`) and `proof` (≙ `GET /proof`). Every
other tool is listed, and an anonymous call to one returns a tool error carrying
the mint instructions; the connection stays up. A presented-but-invalid key is a
401, never a silent downgrade. The anonymous preview is cost-bounded by the same
six-hour cache and per-app damper as the public report page.

The gate lives in the registry (`keyed()` in `tools.ts`), so it holds for any
caller of a handler — `publicTier.spec.ts` iterates every keyed tool and proves
it refuses an anonymous context before touching the network.

## Where it departs from the original plan, and why

| Planned (2026-07) | Shipped | Why |
|---|---|---|
| `push_metadata` "gated behind approval" | **No write tool at all** | Approval is the terminus. An MCP call is not a human approving a diff; the push stays a separate click in the app. `tools.spec.ts` forbids any tool whose name implies a write. |
| `read_live_metadata` with the user's `.p8` | Not exposed | Same reason: keep credential-bearing paths off the agent surface. The keyed audit runs the public read; `audit_play_app_owner` is the one owner-keyed read and opens-and-discards a Play edit. |
| Key required for everything | Public tier without a key | The MCP is the front door, not a Phase-3 channel. The public tier mirrors the site's try-before-signup policy rather than widening it. |
| "Do not start until launch converts" | Shipped before launch converted | It was thin (an adapter over the tested engine) and it was already built. The sequencing rule guarded *building*; it had nothing to say once the code existed. |

## Not built, deliberately

- Any tool that writes to a store. Approval is the terminus.
- Revenue / download / ad-spend / creator breadth. Not our data moat; not the loop.
- A separate credit system. Keyed calls run on the account's plan.

## Open

- **Registry listing.** A `server.json` for the MCP Registry is prepared at the
  repo root (the `mcp-publisher` convention); publishing it is a public act and
  stays a human step.
- **Usage is unmeasured.** No count of anonymous vs keyed calls exists yet.
  Per the measured-or-nothing rule this document states no number.

---

## The original plan (2026-07), kept for the record

> Motivated by the [AppKittie competitive read](../competitive/appkittie.md): a
> funded competitor ships a paid MCP with an ASO skill, proving MCP is a real
> channel for this exact buyer. We enter it on **our** terms — exposing the
> closed loop, not copying their breadth.

**Thesis.** The differentiator isn't "an MCP that suggests ASO copy" — AppKittie
has that. It's an MCP that runs our closed loop from inside the agent: audit a
listing, propose an improvement that can't regress a good listing, and prove the
rank moved. Intelligence tools tell you what to write; ours *verifies it*.

**Why the right channel.** Same buyer and install motion the free plugin
targets (Claude Code / Cursor / Windsurf), reachable as `claude mcp add`; a thin
adapter over the engine we already built; the account's tier gates apply as-is.

**Hard constraints (carried into what shipped).** `.p8` is never persisted.
Never auto-push. No blind overwrites. Don't rebuild their data moat.

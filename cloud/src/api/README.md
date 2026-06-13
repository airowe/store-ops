# src/api/ — the REST API (Worker fetch handler)

Routed from `src/index.ts` `fetch()` → `handleApi(request, env)`. Plain Workers
router, zero framework deps. Talks to D1 only via `../d1.ts`; runs the ASO loop
via the engine's `runAgent` (the global `fetch` is adapted to the engine's
`FetchFn` in `../fetchAdapter.ts`).

## Auth (STUBBED, demo)

Every request identifies the user by the **`X-User-Email`** header — a magic-link
stand-in. The value get-or-creates a `users` row (`upsertUser`). No password, no
session crypto on the demo path; `SESSION_SECRET` is reserved for signing real
tokens later. All app/run access is scoped to that user (you can't read another
user's app or run → 404).

## CORS

Preflight (`OPTIONS`) handled; `Origin` is echoed back with
`access-control-allow-{methods,headers}` for the Pages dashboard.

## Routes (BUILT)

| method + path             | request body                                  | response |
|---------------------------|-----------------------------------------------|----------|
| `POST /apps`              | `{bundle_id, name?, country?, keywords?, competitors?, baseCopy?}` | connects the app (resolves the live listing), runs the agent once, persists run+proposals+snapshots → `{app, runId, liveName, auditGrade}` (201) |
| `GET  /apps`              | —                                             | `{apps:[{id,bundleId,name,country,createdAt,latestRun:{id,status}}]}` |
| `GET  /apps/:id`          | —                                             | `{app, latestRun}` (latestRun is a full run view) |
| `POST /apps/:id/run`      | `{keywords?, competitors?, baseCopy?}` (all optional) | runs the agent (diffs vs last competitor snapshot), opens an `awaiting_approval` run → `{runId, status, digest}` (201) |
| `GET  /apps/:id/ranks`    | `?keyword=` (optional)                        | `{appId, series:{ [keyword]: [{rank,total,at}] }}` — trend chart data |
| `GET  /runs/:id`          | —                                             | `{run, audit, ranks, competitors, reasoning, proposedCopy, pushCommands, approval, trigger}` |
| `POST /runs/:id/approve`  | `{decision:"approve"\|"reject"}`              | approve → status `shipped` + returns the generated push commands; reject → status `rejected`. One decision per run (`UNIQUE(run_id)`); re-decide → 409 |

`keywords` items are `{keyword, volume, difficulty, relevance}` on 0–100 scales.
When omitted, seeds are derived from the app name (`runConfig.ts`) so a bare run
still does real work against live iTunes.

## The approval gate

`POST /runs/:id/approve` is the only place the irreversible step is unlocked.
On approve we return the **generated** `asc` / `gplay` commands for the human to
run — we NEVER execute a push and NEVER hold store credentials.

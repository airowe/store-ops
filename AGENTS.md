# AGENTS.md — running ShipASO from any agent

ShipASO is an App Store / Google Play optimization loop: **audit a live listing →
research keywords → write copy to exact character limits → prepare the push →
read the rank back.**

This file is the front door for coding agents. It is deliberately not
Claude-specific: the 31 skills in `skills/` are plain Markdown instructions over
plain CLI tools, and the engine in `lib/` is **standard-library Python** for the
whole audit → research → optimize → verify loop. Any agent that can read a file
and run a command can drive this repo.

Two skills reach beyond the stdlib, and only for image work: screenshot scoring
(`lib/aso_screenshot_score.py`) and screenshot rendering
(`lib/render_localized_shots.py`) need **Pillow**, and the orchestrator reads a
YAML config if **PyYAML** is present. All three are lazy imports behind
`try/except ImportError` — absent, those paths degrade or skip; nothing else in
the loop is affected, and `lib/run_tests.py` stays green either way.

## Which file your agent reads

Same content, several front doors — `AGENTS.md` is the source of truth and the
rest point at it:

| Agent | Reads |
|---|---|
| Codex, Amp, Jules, Cursor (2025+), most others | `AGENTS.md` natively |
| Claude Code | `CLAUDE.md` → defers here; `.claude-plugin/` installs the skills |
| Gemini CLI | `GEMINI.md` (symlink to this file) |
| Cursor (rules) | `.cursor/rules/shipaso.mdc` |
| GitHub Copilot | `.github/copilot-instructions.md` |

No agent needs a plugin system. Clone the repo, read this file, run the
commands.

## Two invariants — these override convenience everywhere

1. **Measured or nothing.** Every displayed number is measured or absent — `—`,
   never a placeholder, never `0` standing in for "unknown". There is
   deliberately no keyword "volume" or "difficulty" score, because no honest
   free source for them exists.
2. **Approval is the terminus.** Nothing in this repo publishes to a store on
   its own. Skills draft copy and *print* push commands; a human runs them.
   Approving is not shipping.

If you are generating output for a user, obey both. A fabricated number is worse
than a missing one, and an agent that pushes to a live listing has broken the
product's core promise.

## Start here, without credentials

The verify half runs on the free public iTunes API. Nothing below needs a key,
a login, or a paid data provider:

```bash
# organic App Store rank for keywords (any live app's bundle id)
python3 lib/aso_rank_check.py --bundle com.burbn.instagram "photo,stories,reels"

# score a live screenshot set against ASO best practice
python3 lib/aso_screenshot_score.py --app instagram --bundle com.burbn.instagram

# the full loop for one app
python3 lib/store_ops_orchestrator.py --app myapp --date 2026-07-30
```

Every command takes `--json` and prints machine-readable output — use it. That
is the portable interface; the human-readable table is for people.

```bash
python3 lib/aso_rank_check.py --bundle com.example.app "yoga,meditation" --json
```

Run the test suite (stdlib only, no network, no keys):

```bash
python3 lib/run_tests.py      # 200 tests across 16 suites
```

## The skills

`skills/<name>/SKILL.md` — 31 of them. Each is a self-contained Markdown
runbook: what it needs, what it does, what it refuses to do. They are written
for an agent to read and follow, and carry no vendor-specific frontmatter
(`name` and `description` only).

Read the one you need rather than all of them. `skills/store-ops/SKILL.md` is
the router — it maps a user's goal to the right skill.

Grouped by what they do:

| Group | Skills |
|---|---|
| **Router / setup** | `store-ops`, `aso-context`, `issue-verify` |
| **Research** | `aso-keyword-research`, `aso-review-mine`, `aso-offstore-mine`, `aso-localize-research`, `aso-competitor-watch` |
| **Audit & risk** | `aso-audit`, `aso-teardown`, `aso-screenshot-score`, `aso-review-risk`, `aso-rejection-assistant` |
| **Write (App Store)** | `aso-metadata-optimization`, `asc-metadata-write-lane`, `asc-metadata-sync`, `asc-localize-metadata`, `asc-submission-health`, `asc-id-resolver`, `asc-ppp-pricing`, `asc-shots-pipeline`, `asc-screenshot-write-lane`, `aso-goldie-config` |
| **Write (Google Play)** | `gplay-metadata-sync`, `gplay-review-management`, `gplay-rollout-management`, `gplay-vitals-monitoring`, `gplay-screenshot-automation`, `gplay-ppp-pricing` |
| **Verify** | `aso-rank-check`, `aso-rank-monitor`, `aso-ppo-treatment` |
| **Hosted** | `shipaso-mcp` |

## Before any write to a store

Every `asc-*` / `gplay-*` skill that writes reaches a **real** Apple or Google
account. Two rules:

1. **Ask which API key.** `asc` resolves credentials from a *default profile*,
   and anyone with a client key plus a personal key has more than one. A push
   through the wrong profile does not error — it succeeds, against the wrong
   account, and stays invisible until it lands on someone's live listing. Run
   `asc auth status`, show the user the profiles, have them name the one that
   owns the app.
2. **Never handle key material.** `.p8` private keys are passed by **path**
   (`asc auth login --private-key /path/to/AuthKey.p8`), never pasted into a
   conversation. Apple lets you download a key exactly once; key material in a
   transcript is leaked key material, and the only remedy is revoking it.

See `skills/asc-metadata-write-lane/SKILL.md` for the full write lane — it
creates an editable version, attaches a build, pushes metadata, and **stops
before submission**.

## Executing commands

Skills print push commands rather than running them. When a skill emits a
command, show it to the user and let them run it. Do not execute a store write
on their behalf, even when asked in the same breath — that is the deliberate
human step the whole design is built around.

Reading is different: audits, rank checks, and competitor watches are read-only
and safe to run directly.

## Optional accelerators — never gates

Every credentialed source has a free fallback, and the free path is the default:

| Want | Bring | Without it |
|---|---|---|
| Real search volume | Your own Apple Search Ads / Google Keyword Planner key | An honest autocomplete-rank proxy |
| Clean competitor scraping | A context.dev key | WebFetch / Crawl4AI |
| Your live listing fields | `asc` / `gplay` CLI auth | The public listing only |

You bring your own keys — it is your data, and the plugin never resells any.

## The hosted loop (MCP)

`https://api.shipaso.com/mcp` exposes the same engine as **12 MCP tools** over
HTTP: `audit_app`, `keyword_gaps`, `rank_check`, `competitor_watch`,
`screenshot_coverage`, `localization_gaps`, and others. MCP is vendor-neutral,
so this works from any MCP client, not just one editor.

It is **read/draft only** — nothing pushes to a live store through it. Needs a
scoped `shipaso_…` key, created in the dashboard under Agent access. See
`skills/shipaso-mcp/SKILL.md`.

## Repo layout

| Path | What |
|---|---|
| `skills/` | The 31 skill runbooks |
| `lib/` | The Python engine — stdlib only, 200 tests |
| `cloud/` | The hosted agent (Cloudflare Workers + D1); TypeScript port of the engine |
| `packages/` | Shared tokens, API types, doc-path linting |
| `marketing/aso/<app>/` | Per-app deliverables the skills write |

## Verify before you claim

Issues, comments, and docs in this repo have repeatedly described work as
unbuilt long after it shipped. Check the source before reporting that something
is missing.

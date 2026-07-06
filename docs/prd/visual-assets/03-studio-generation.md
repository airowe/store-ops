# PRD 03 — Screenshot studio (Phase B, future — design DECIDED, build deferred)

> **Not scheduled; design settled 2026-07.** In-product generation of store
> screenshot sets tied to the audit + keywords — the premium "Studio" tier.
> Tracked as GitHub issues #153 (pipeline) and #154 (CPP add-on, depends on
> this) — supersedes the open decision in #26. Build after the web-migration
> (cloud/web) dashboard ships, since the studio UI lands there.

## The decided architecture (brainstormed + approved by owner)

**LLM plans, deterministic renderer executes — the LLM never paints pixels.**

```
run audit + findings ─► Worker planner ─► ScreenshotPlan (JSON, validated)
   + copy/keywords         (Workers AI          │
                            + fallback)         ▼
                              cloud/web "Screenshot studio"
                              (DOM templates → PNG in-browser)
                                                │
                              inline headline edits ─► export zip
```

### Engine (pure): `cloud/src/engine/screenshotPlan.ts`
- `ScreenshotPlan` schema: set-level `narrative` + `style: "clean" | "bold"`;
  ~6 shots of `{ sourceScreen | "MISSING", headline, subline?, templateId, accent? }`.
- `validatePlan()`: schema + honesty lint — headline ≤ 6 words; unmeasured-claim
  patterns ("#1", "best", "N million users") rejected; every `sourceScreen`
  must exist in the provided screen list or be an explicit `MISSING` with a
  description (never a fabricated screen).
- Deterministic fallback planner (no AI binding / invalid AI output → a
  serviceable plan from findings + current copy). House safe-degrade pattern,
  mirrors `keywordReasoner`/`localizeCopy`.

### Worker planner: `cloud/src/api/aiShotPlanner.ts` + routes
- Same provider seam as `aiReasoner`/`aiLocalizer`; `@cf/meta/llama-3.1-8b-instruct`.
- `POST /runs/:id/shots/plan` (owned run with an audit): grounds the prompt on
  findings, findingsSummary, current/proposed copy, keyword + rank data, and the
  audit's `screenshotUrls`. Invalid AI output → fallback, never a broken plan.
- Plans persist in a new D1 `shot_plans` table
  (`run_id, plan_json, source: 'ai'|'fallback', created_at`) — regeneration is
  unlimited and versioned (feeds the RLHF loop later); `GET` returns the latest.
- Every plan carries `machineGenerated: true` (same honest labeling as
  machine-translated localization drafts).

### Renderer: cloud/web "Screenshot studio" (route under run detail)
- Templates are code (DOM/CSS at exact store dimensions, bundled webfont);
  previews scaled, export renders offscreen at full resolution → PNG → zip
  named for ASC upload. 6.7" (1290×2796) first; other sizes fast-follow.
- Two template families at launch (reference images from owner, 2026-07):
  - **`clean`** — appkittie/PeptidePal look: benefit headline above a straight
    device frame on a soft neutral background. Default.
  - **`bold`** — editorial look: full-bleed brand-color background, stacked
    display type with accent-colored line, cropped/angled device frame,
    optional floating category chips.
- Source images: the app's existing store screenshots (Apple CDN) by default,
  or raw screens the user drops in — **which never leave the browser** (a
  privacy story appshots-class tools can't tell).
- Headlines editable inline (the proposals edit-before-approve pattern); style
  flippable; everything re-renders live.
- **Honest laurel badge**: the "#1 app" badge every competitor fakes is allowed
  ONLY when bound to a measured rank from our own snapshots ("#1 for
  'weatherthere'" + date). Unmeasured badge → lint rejects. Our rank data makes
  us the only tool that can render this claim honestly.

### The gate
Export mutates nothing (download only) — the human editing pass + explicit
export click is the gate; no new approval machinery. When #154 adds "create the
CPP via ASC API", that write goes behind the real run-approval flow.

## Why still deferred
- The studio UI belongs in cloud/web, which hasn't shipped to users yet.
- Phase A (PRD 01/02 link-out + brief) still delivers most of the value at ~no
  build cost and validates demand for Phase B.
- Zero new infra when it does build: Workers AI binding + one D1 table +
  in-browser rendering. The from-scratch vs. wire-existing question from #26 is
  resolved: build the thin pipeline ourselves; the PRD-02 brief is the planner
  prompt's grounding, not a separate product.

## Competitive context (2026-07)
appshots.me charges $8–49/mo for upload → auto-style → export with zero
knowledge of rankings or findings; appkittie/appgrowkit ship generators and are
racing to MCP surfaces. One-prompt screenshot generation is commoditizing —
generation grounded in measured findings, honest claims, and approval is the
moat. See ../mcp-server.md for the agent-access adjacency.

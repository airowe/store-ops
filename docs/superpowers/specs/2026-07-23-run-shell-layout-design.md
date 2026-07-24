# Run Shell Layout — Design Spec

**Date:** 2026-07-23
**Status:** Approved for planning
**Supersedes prototype:** `run-shell-prototype.html` (artifact d38a3c7c) — this is the production translation.

## Goal

Replace the run page's single long scrolling column with a three-zone **app shell**: a top status bar (app-at-a-glance), an active master-detail rail (one section on screen at a time), and the existing sticky decision pane. Directly fixes the two logged UX defects: **#325** (918-word wall / text-heavy) and partially previews **#324** (findings actionability).

## Scope decisions (locked with the user)

1. **Frontend-only this branch.** The status bar shows *measured* data as real and *unmeasured* data as honest placeholders / CTAs. No backend/audit-read change here. The audit-read extension that would make rating/version/rank *measured* is filed as a **follow-up issue** (Phase 2), not built in this branch.
2. **Master-detail rail.** Clicking a rail item shows ONLY that section in the main pane. This is the actual #325 fix — one section visible at a time — not a scroll-spy over a stacked column. Existing "every card renders" tests are rewritten to "the selected card renders; siblings do not."
3. **#324 is NOT folded in.** Findings' `fix` prose renders as today inside the detail pane. Turning `fix` into deep-links/actions stays #324's own scope. This branch only re-homes the finding cards into the new shell.

## Honesty invariant (load-bearing)

**Measured-or-absent, never fabricated.** Every status-bar stat is either a real value from `RunDetail` or an explicit honest placeholder. No stat is ever invented.

What `RunDetail` measures today (the only real values available this branch):
- **App name** — `run.result.audit.liveName` (fallback `run.result.currentCopy.name`).
- **Screenshot grade** — `run.result.audit.screenshots.grade` (or `null` = unmeasured, shown as "—", never "F").
- **Coverage score** — `run.result.coverage.score` when present.
- **Status** — `run.status` via existing `runStatusLabel`.

What is NOT in `RunDetail` and therefore renders as an honest placeholder this branch:
- **Live version string** → `v— live` (dash; name is known, version is not).
- **Rating (★ + count)** → `★— no rating data` (not measured anywhere in the run).
- **Category rank** → `#— rank` (the run has keyword lead-rank via portfolio, not App-Store category rank; do not conflate them — show the dash).
- **Downloads** → `↓— connect analytics →` CTA (downloads are Analytics-pipeline only, never in the keyed read; the CTA calls the existing `onConnect` handler when provided, else links to `/settings`).

## Architecture

Three zones, composed by `RunView`, only when the run is **pending** (the shell is the decision surface; terminal/decided runs stay in the current linear read-only render — no behavioral change there).

```
┌─────────────────────────────────────────────────────────┐
│ RunStatusBar   Heathen · v— live · ★— · #— · ↓ connect → │  ← new
├──────────────┬──────────────────────────────────────────┤
│ SectionRail  │  RunDetailPane                            │
│ (grouped,    │  renders ONLY the selected section        │  ← rail rewritten
│  selectable) │  (Changes / Audit / Metadata / …)         │    pane new
│ Needs you    │                                           │
│  • Screenshots                                           │
│  Changes     │                                           │
│  FYI         │                                           │
│  Healthy     │                                           │
├──────────────┴──────────────────────────────────────────┤
│ decision-bar (existing, unchanged)                       │  ← unchanged
└─────────────────────────────────────────────────────────┘
```

### Components

**`RunStatusBar`** (new, `RunStatusBar.tsx`)
- Props: `{ appName: string; version?: string; grade?: string | null; coverageScore?: number | null; status: string; onConnectAnalytics?: () => void }`.
- Pure presentational. Renders a horizontal bar of stat cells. Each unmeasured stat renders its honest placeholder; the downloads cell is a button/link (CTA) not a static value.
- One responsibility: show app-at-a-glance. No data fetching.

**`SectionRail`** (rewritten, same file)
- New shape: `RailItem = { id: string; label: string; group: RailGroup }` where `RailGroup = "needs" | "changes" | "fyi" | "healthy"`.
- Becomes **controlled + selectable**: props `{ items: RailItem[]; activeId: string; onSelect: (id: string) => void }`. No more IntersectionObserver / anchor jumps — selection is state owned by `RunView`.
- Renders group headers ("Needs you", "Changes", "FYI", "Healthy") with their items beneath; only non-empty groups render a header. Active item highlighted. Clicking calls `onSelect`.
- Keyboard: items are `<button>`s; focus-visible outline; up/down arrow moves selection (roving via native focus is acceptable — no custom keymap required beyond buttons being focusable and Enter/Space activating).

**`RunDetailPane`** (new, `RunDetailPane.tsx`)
- Props: `{ activeId: string; sections: Record<string, ReactNode> }` — a map from section id to its already-composed card.
- Renders only `sections[activeId]`. If the id is missing (defensive), renders nothing.
- `RunView` builds the `sections` map (Changes → `CopyDiff`, Audit → `FindingsCard`, Metadata → `CoverageCard`, Keywords → `OpportunitiesCard`, Markets → `LocalizationExpansionCard`, Screenshots → `ScreenshotPlanCard`/`CppSetsCard`) exactly as today; it just no longer stacks them.

**`RunView`** (modified)
- Owns `activeId` state (default: first rail item, which is the first non-empty group's first item; "changes" is always present so that is the default).
- Rail grouping logic: map each present section to a group.
  - `changes` → group `changes`.
  - `audit` → derive from findings: if any finding is `severity==="critical" || "warn"` and not `context`, the Audit item goes in `needs`; else `fyi`. (One Audit item; its group reflects the most-severe actionable finding.)
  - `metadata`, `keywords`, `markets` → `fyi`.
  - `screenshots` → if the screenshot grade is below a strong bar (grade not starting with "A"/"B"), `needs`; else `healthy`. Absent grade → `fyi`.
- Renders `RunStatusBar` (top) + `run-shell` grid (rail + `RunDetailPane`) + existing `decision-bar` (bottom), for pending runs only.
- **Terminal/decided runs**: unchanged — keep the current linear render (approved push cards, handoff, etc.). The shell is a pending-run affordance.

### Data flow

`RunView` → `getRun` (unchanged) → derive rail items + group + sections map → local `activeId` state selects which section the pane shows. Decision mutations unchanged. No new API calls, no new endpoints.

### Layout / CSS

Extend the existing tokens and `run-layout` system in `app.css`:
- `.run-shell` — grid `grid-template-rows: auto 1fr; grid-template-columns: 200px minmax(0,1fr)` on `min-width: 900px`; status bar spans both columns (row 1), rail + pane on row 2. Below 900px: single column, status bar first, then the rail renders as a **horizontal, wrap-friendly row of the same selectable buttons** (grouped labels inline), then the pane. No `<select>` — the buttons stay buttons so the tests and keyboard model are identical across breakpoints.
- `.run-status-bar` — flex row of stat cells, `font-family: var(--mono)` for the values, `tabular-nums` on any digits. Placeholder cells use `--faint`; the downloads CTA uses `--brand`.
- Rail: reuse `.section-rail` / `.rail-link`; add `.rail-group-label` (uppercase, letter-spaced, `--faint`) and `.rail-link.active` stays as-is. Group headers are non-interactive.
- Keep `.decision-bar` exactly as-is.
- Respect `prefers-reduced-motion` for any pane-swap transition (a fade is optional; if added, gate it).
- Both themes: derive every color from existing tokens (already dual-theme). No new hard-coded hex.

## Error handling

- Loading / error states: unchanged (the existing early returns before the shell).
- Missing `activeId` in sections map: `RunDetailPane` renders nothing (never throws).
- Empty rail (no sections at all): "changes" is always present, so the rail always has ≥1 item; no empty-rail branch needed, but `RunDetailPane` guards anyway.
- Unmeasured status-bar values: render placeholders — never throw, never fabricate.

## Testing

Vitest + Testing Library (`*.test.tsx`), colocated. Strong assertions, parameterized where natural.

- **`RunStatusBar.test.tsx`**: renders app name; shows `v— live` when no version; shows `★—` placeholder when no rating; downloads cell is a CTA that calls `onConnectAnalytics` on click; measured grade/coverage render as their real values when provided.
- **`SectionRail.test.tsx`** (rewritten): renders only non-empty group headers; renders items under the right group; calls `onSelect(id)` on click; marks `activeId` item active; items are focusable buttons.
- **`RunDetailPane.test.tsx`** (new): renders only the section for `activeId`; renders nothing for an unknown id; swapping `activeId` swaps the rendered section.
- **`RunView.test.tsx`** (updated): for a pending run, the status bar renders; the rail groups the Audit item into "Needs you" when a critical/warn finding is present and into "FYI" otherwise; only the selected section is in the document (a sibling section is NOT); clicking a rail item swaps the visible section; the decision bar still renders and Approve/Reject still call `decide`. Terminal-run render is unchanged (existing assertions kept).

## Follow-up (out of scope, filed as issue)

**Phase 2 — measure the status-bar stats.** Extend `RunAudit` (and the keyed/public read agent) to carry live **version string**, **rating average + count**, and **category rank**, so the status bar shows real numbers instead of placeholders. Downloads remain a CTA (Analytics-pipeline only). File as a GitHub issue at plan time and link it from the status bar's placeholder comments.

## What this branch does NOT change

- No backend, no new endpoints, no `RunDetail` shape change.
- No change to the approval/push/handoff flow or its honesty guarantees.
- No change to terminal/decided-run rendering.
- Does not implement #324 (findings deep-linking) — only re-homes the cards.

# Run Shell Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the run page's single scrolling column with a three-zone app shell — top status bar, active master-detail rail (one section on screen at a time), existing sticky decision bar — fixing the #325 text-heavy defect.

**Architecture:** Frontend-only. `RunView` gains local `activeId` state; a rewritten `SectionRail` (controlled, grouped, selectable) drives which section a new `RunDetailPane` renders. A new `RunStatusBar` shows measured stats as real and unmeasured stats (version/rating/rank/downloads) as honest placeholders/CTAs. No backend, no `RunDetail` shape change. The shell renders for **pending runs only**; terminal/decided runs keep today's linear render.

**Tech Stack:** React 18, TypeScript strict, @tanstack/react-query, Vitest + @testing-library/react. Web app under `cloud/web/`; shared types in `packages/api/types.ts` (path alias `@shipaso/api`). Tests are `*.test.tsx`, colocated. Test command: `node node_modules/.bin/vitest run` from `cloud/web/`. Typecheck: `npx tsc --noEmit` from `cloud/web/` (authoritative over editor diagnostics).

## Global Constraints

- **Honesty invariant — measured-or-absent, never fabricated.** Every status-bar stat is a real `RunDetail` value or an explicit honest placeholder. Never invent a number. Placeholders this branch: version `v— live`, rating `★—`, category rank `#—`, downloads `↓— connect analytics →` (CTA).
- **Frontend-only.** No change to `packages/api/types.ts`, no new endpoints, no backend files. Only `cloud/web/src/features/run/` and `cloud/web/src/app.css`.
- **Shell is a pending-run affordance.** `pending = !approved && !rejected && !superseded`. Terminal/decided-run rendering is unchanged — do not touch the approved push/handoff/localization cards' behavior.
- **Master-detail:** exactly one section renders in the pane at a time. Not a scroll-spy.
- **Both themes, tokens only.** Every color derives from existing CSS custom properties in `app.css`. No new hard-coded hex.
- **TypeScript strict.** No `any` in new code. `exactOptionalPropertyTypes` is on — spread optional props conditionally (`...(x ? { prop: x } : {})`), matching the existing RunView pattern.
- **Branch guard:** before any commit, run `git branch --show-current` and confirm it is `feat/run-shell-layout`.
- **Conventional Commits**; no AI-tool references in messages; end every commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: RunStatusBar component

**Files:**
- Create: `cloud/web/src/features/run/RunStatusBar.tsx`
- Test: `cloud/web/src/features/run/RunStatusBar.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks (leaf component).
- Produces:
  ```ts
  export type RunStatusBarProps = {
    appName: string;
    version?: string;
    grade?: string | null;
    coverageScore?: number | null;
    status: string;
    onConnectAnalytics?: () => void;
  };
  export function RunStatusBar(props: RunStatusBarProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `cloud/web/src/features/run/RunStatusBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunStatusBar } from "./RunStatusBar.js";

describe("<RunStatusBar />", () => {
  it("renders the app name", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Heathen");
  });

  it("shows the honest version placeholder when no version is measured", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-version")).toHaveTextContent("v— live");
  });

  it("shows the measured version when provided", () => {
    render(<RunStatusBar appName="Heathen" version="1.2.1" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-version")).toHaveTextContent("v1.2.1 live");
  });

  it("shows the rating placeholder — rating is never measured this branch", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-rating")).toHaveTextContent("★—");
  });

  it("shows the rank placeholder", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" />);
    expect(screen.getByTestId("sb-rank")).toHaveTextContent("#—");
  });

  it("renders downloads as a CTA that calls onConnectAnalytics", () => {
    const onConnect = vi.fn();
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" onConnectAnalytics={onConnect} />);
    const cta = screen.getByTestId("sb-downloads");
    expect(cta).toHaveTextContent("connect analytics");
    fireEvent.click(cta);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("renders the measured grade and coverage when provided", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" grade="B+" coverageScore={95.6} />);
    expect(screen.getByTestId("sb-grade")).toHaveTextContent("B+");
    expect(screen.getByTestId("sb-coverage")).toHaveTextContent("95.6");
  });

  it("shows a dash for grade/coverage when unmeasured, never fabricates", () => {
    render(<RunStatusBar appName="Heathen" status="awaiting_approval" grade={null} coverageScore={null} />);
    expect(screen.getByTestId("sb-grade")).toHaveTextContent("—");
    expect(screen.getByTestId("sb-coverage")).toHaveTextContent("—");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud/web && node node_modules/.bin/vitest run src/features/run/RunStatusBar.test.tsx`
Expected: FAIL — cannot resolve `./RunStatusBar.js`.

- [ ] **Step 3: Write minimal implementation**

Create `cloud/web/src/features/run/RunStatusBar.tsx`:

```tsx
/**
 * RunStatusBar — the app at a glance, above the decision. Honesty is
 * load-bearing: measured values (name, screenshot grade, coverage) render as
 * real; everything the run does NOT measure this branch — live version string,
 * rating, category rank, downloads — renders as an explicit placeholder or a
 * connect-analytics CTA, NEVER a fabricated number. Phase 2 (a filed follow-up)
 * extends the audit read so version/rating/rank become measured. Pure
 * presentational.
 */
import { runStatusLabel } from "../../lib/status.js";

export type RunStatusBarProps = {
  appName: string;
  version?: string;
  grade?: string | null;
  coverageScore?: number | null;
  status: string;
  onConnectAnalytics?: () => void;
};

export function RunStatusBar({
  appName, version, grade, coverageScore, status, onConnectAnalytics,
}: RunStatusBarProps) {
  return (
    <div className="run-status-bar" data-testid="status-bar">
      <span className="sb-app">{appName}</span>
      <span className="sb-cell" data-testid="sb-version">v{version ?? "—"} live</span>
      {/* rating is not measured anywhere in RunDetail this branch — honest dash */}
      <span className="sb-cell faint" data-testid="sb-rating">★—</span>
      {/* category rank is not on the run's audit — do not conflate with keyword lead-rank */}
      <span className="sb-cell faint" data-testid="sb-rank">#—</span>
      <span className="sb-cell" data-testid="sb-grade">shots {grade ?? "—"}</span>
      <span className="sb-cell" data-testid="sb-coverage">
        coverage {coverageScore == null ? "—" : coverageScore}
      </span>
      {onConnectAnalytics ? (
        <button
          type="button"
          className="sb-cta"
          data-testid="sb-downloads"
          onClick={onConnectAnalytics}
        >
          ↓— connect analytics →
        </button>
      ) : (
        <a className="sb-cta" data-testid="sb-downloads" href="/settings">
          ↓— connect analytics →
        </a>
      )}
      <span className="sb-cell sb-status" data-testid="sb-status">{runStatusLabel(status)}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cloud/web && node node_modules/.bin/vitest run src/features/run/RunStatusBar.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: no errors from `RunStatusBar.tsx`/`.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/run-shell-layout
git add cloud/web/src/features/run/RunStatusBar.tsx cloud/web/src/features/run/RunStatusBar.test.tsx
git commit -m "feat(run): RunStatusBar — measured stats real, unmeasured as honest placeholders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: SectionRail rewrite — controlled, grouped, selectable

**Files:**
- Modify: `cloud/web/src/features/run/SectionRail.tsx` (full rewrite)
- Modify: `cloud/web/src/features/run/SectionRail.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type RailGroup = "needs" | "changes" | "fyi" | "healthy";
  export type RailItem = { id: string; label: string; group: RailGroup };
  export function SectionRail(props: {
    items: RailItem[];
    activeId: string;
    onSelect: (id: string) => void;
  }): JSX.Element | null;
  ```
- **Breaking change:** `RailItem` gains a required `group`; `SectionRail` is now controlled (`activeId` + `onSelect`) and renders `<button>`s, not anchor `<a>`s. Task 4 (RunView) is the only consumer and is updated there. The old IntersectionObserver logic is removed entirely.

- [ ] **Step 1: Rewrite the test**

Replace `cloud/web/src/features/run/SectionRail.test.tsx` entirely:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { SectionRail, type RailItem } from "./SectionRail.js";

const ITEMS: RailItem[] = [
  { id: "changes", label: "Changes", group: "changes" },
  { id: "audit", label: "Audit", group: "needs" },
  { id: "metadata", label: "Metadata", group: "fyi" },
  { id: "screenshots", label: "Screenshots", group: "healthy" },
];

describe("<SectionRail />", () => {
  it("renders only the group headers that have items", () => {
    render(<SectionRail items={ITEMS} activeId="changes" onSelect={vi.fn()} />);
    const rail = screen.getByTestId("section-rail");
    expect(rail).toHaveTextContent("Needs you");
    expect(rail).toHaveTextContent("Changes");
    expect(rail).toHaveTextContent("FYI");
    expect(rail).toHaveTextContent("Healthy");
  });

  it("omits a group header when no item belongs to it", () => {
    const noNeeds = ITEMS.filter((i) => i.group !== "needs");
    render(<SectionRail items={noNeeds} activeId="changes" onSelect={vi.fn()} />);
    expect(screen.getByTestId("section-rail")).not.toHaveTextContent("Needs you");
  });

  it("renders each item as a focusable button", () => {
    render(<SectionRail items={ITEMS} activeId="changes" onSelect={vi.fn()} />);
    const buttons = within(screen.getByTestId("section-rail")).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Changes", "Audit", "Metadata", "Screenshots"]);
  });

  it("marks the active item", () => {
    render(<SectionRail items={ITEMS} activeId="audit" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Audit" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "Changes" })).not.toHaveClass("active");
  });

  it("calls onSelect with the item id on click", () => {
    const onSelect = vi.fn();
    render(<SectionRail items={ITEMS} activeId="changes" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Metadata" }));
    expect(onSelect).toHaveBeenCalledWith("metadata");
  });

  it("renders nothing when given no items", () => {
    render(<SectionRail items={[]} activeId="" onSelect={vi.fn()} />);
    expect(screen.queryByTestId("section-rail")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud/web && node node_modules/.bin/vitest run src/features/run/SectionRail.test.tsx`
Expected: FAIL — `group` missing / `onSelect` prop not used / buttons not found.

- [ ] **Step 3: Rewrite the implementation**

Replace `cloud/web/src/features/run/SectionRail.tsx` entirely:

```tsx
/**
 * SectionRail — a grouped, selectable index of the run's sections. Controlled:
 * the caller owns `activeId` and gets `onSelect` on click. Selecting a section
 * swaps the single detail pane (master-detail) — this is the text-heavy fix
 * (#325): one section on screen at a time, not a stacked wall. Only non-empty
 * groups render a header. Pure presentational; items are buttons for keyboard
 * reach. Hidden-narrow handling lives in CSS.
 */
export type RailGroup = "needs" | "changes" | "fyi" | "healthy";
export type RailItem = { id: string; label: string; group: RailGroup };

/** Fixed display order + human labels for the groups. */
const GROUPS: { key: RailGroup; label: string }[] = [
  { key: "needs", label: "Needs you" },
  { key: "changes", label: "Changes" },
  { key: "fyi", label: "FYI" },
  { key: "healthy", label: "Healthy" },
];

export function SectionRail({
  items, activeId, onSelect,
}: {
  items: RailItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <nav className="section-rail" data-testid="section-rail" aria-label="Run sections">
      {GROUPS.map(({ key, label }) => {
        const groupItems = items.filter((it) => it.group === key);
        if (groupItems.length === 0) return null;
        return (
          <div key={key} className="rail-group">
            <div className="rail-group-label">{label}</div>
            {groupItems.map((it) => (
              <button
                key={it.id}
                type="button"
                className={"rail-link" + (activeId === it.id ? " active" : "")}
                aria-current={activeId === it.id ? "true" : undefined}
                onClick={() => onSelect(it.id)}
              >
                {it.label}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cloud/web && node node_modules/.bin/vitest run src/features/run/SectionRail.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck (expect a known RunView break)**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: errors ONLY in `RunView.tsx` (it still passes the old `RailItem` shape / old props). That is expected and fixed in Task 4. No errors in `SectionRail.tsx`/`.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/run-shell-layout
git add cloud/web/src/features/run/SectionRail.tsx cloud/web/src/features/run/SectionRail.test.tsx
git commit -m "feat(run): rewrite SectionRail as a controlled, grouped, selectable rail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Note: the tree does not typecheck cleanly after this task alone (RunView still uses the old API). Task 4 restores green. This is an intentional mid-sequence break; do not "fix" RunView here.

---

### Task 3: RunDetailPane component

**Files:**
- Create: `cloud/web/src/features/run/RunDetailPane.tsx`
- Test: `cloud/web/src/features/run/RunDetailPane.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  import type { ReactNode } from "react";
  export function RunDetailPane(props: {
    activeId: string;
    sections: Record<string, ReactNode>;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `cloud/web/src/features/run/RunDetailPane.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunDetailPane } from "./RunDetailPane.js";

const SECTIONS = {
  changes: <div data-testid="sec-changes">changes body</div>,
  audit: <div data-testid="sec-audit">audit body</div>,
};

describe("<RunDetailPane />", () => {
  it("renders only the active section", () => {
    render(<RunDetailPane activeId="audit" sections={SECTIONS} />);
    expect(screen.getByTestId("sec-audit")).toBeInTheDocument();
    expect(screen.queryByTestId("sec-changes")).toBeNull();
  });

  it("renders nothing (no throw) for an unknown active id", () => {
    render(<RunDetailPane activeId="nope" sections={SECTIONS} />);
    expect(screen.queryByTestId("sec-changes")).toBeNull();
    expect(screen.queryByTestId("sec-audit")).toBeNull();
    expect(screen.getByTestId("run-detail-pane")).toBeInTheDocument();
  });

  it("swaps the rendered section when activeId changes", () => {
    const { rerender } = render(<RunDetailPane activeId="changes" sections={SECTIONS} />);
    expect(screen.getByTestId("sec-changes")).toBeInTheDocument();
    rerender(<RunDetailPane activeId="audit" sections={SECTIONS} />);
    expect(screen.getByTestId("sec-audit")).toBeInTheDocument();
    expect(screen.queryByTestId("sec-changes")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud/web && node node_modules/.bin/vitest run src/features/run/RunDetailPane.test.tsx`
Expected: FAIL — cannot resolve `./RunDetailPane.js`.

- [ ] **Step 3: Write minimal implementation**

Create `cloud/web/src/features/run/RunDetailPane.tsx`:

```tsx
/**
 * RunDetailPane — renders exactly one section (master-detail). The caller
 * (RunView) composes each section's card into the `sections` map and selects
 * one via `activeId`. An unknown id renders an empty pane, never a throw.
 */
import type { ReactNode } from "react";

export function RunDetailPane({
  activeId, sections,
}: {
  activeId: string;
  sections: Record<string, ReactNode>;
}) {
  return (
    <div className="run-detail-pane" data-testid="run-detail-pane">
      {sections[activeId] ?? null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cloud/web && node node_modules/.bin/vitest run src/features/run/RunDetailPane.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: no NEW errors from `RunDetailPane.tsx`/`.test.tsx` (the Task-2 RunView break may still show — that is fixed in Task 4).

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/run-shell-layout
git add cloud/web/src/features/run/RunDetailPane.tsx cloud/web/src/features/run/RunDetailPane.test.tsx
git commit -m "feat(run): RunDetailPane — render one section at a time (master-detail)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Integrate the shell into RunView

**Files:**
- Modify: `cloud/web/src/features/run/RunView.tsx`
- Modify: `cloud/web/src/features/run/RunView.test.tsx`

**Interfaces:**
- Consumes: `RunStatusBar` (Task 1), `SectionRail` + `RailItem`/`RailGroup` (Task 2), `RunDetailPane` (Task 3).
- Produces: nothing downstream.

**Context for the implementer (how the current RunView works):**
- `RunView` already computes presence booleans (`hasAudit`, `hasMetadata`, `hasKeywords`, `hasMarkets`, `hasScreenshots`) and a `railItems` memo, and already renders `<SectionRail>`, `<DecisionSummary>`, the section cards (each wrapped in `<div id="...">`), and the `<div className="decision-bar">` for pending runs.
- `pending = !approved && !rejected && !superseded`. The shell applies to **pending only**. For non-pending runs, leave the current linear render exactly as it is (do not wrap it in the shell).
- `onConnect?: () => void` is already a prop — reuse it as the status bar's `onConnectAnalytics`.
- `exactOptionalPropertyTypes` is on: spread optional props conditionally.

**Changes to make:**
1. Import `RunStatusBar`, `RunDetailPane`, and update the `SectionRail` import to also bring `RailGroup`.
2. Add `const [activeId, setActiveId] = useState("changes");` alongside the other hooks (ABOVE the loading/error early returns, to keep hook order stable).
3. Rewrite the `railItems` memo to produce grouped items (`{ id, label, group }`). Grouping rules (from the spec):
   - `changes` → group `"changes"` (always present).
   - `audit` → `"needs"` if any finding is actionable (`!f.context`) and `f.severity === "critical" || "warn"`, else `"fyi"`.
   - `metadata`, `keywords`, `markets` → `"fyi"`.
   - `screenshots` → `"needs"` if the grade is present and does NOT start with "A" or "B"; `"healthy"` if it starts with "A"/"B"; `"fyi"` if grade absent.
   The memo's dependency array must include the values the grouping reads (presence booleans + the derived audit-severity flag + the screenshot grade), so it recomputes correctly.
4. Build a `sections` map (`Record<string, ReactNode>`) of the SAME cards rendered today, keyed by section id (`changes`, `audit`, `metadata`, `keywords`, `markets`, `screenshots`). Reuse the exact existing JSX for each card — do not restyle them. (The `<div id="...">` anchor wrappers are no longer needed inside the pane; the pane provides the container.)
5. For **pending** runs, render:
   - `<RunStatusBar ...>` at the top (app name from `r.audit?.liveName ?? r.currentCopy.name ?? "—"`, `grade` from `r.audit?.screenshots?.grade ?? null`, `coverageScore` from `r.coverage?.score ?? null`, `status` from `run.status`, and `onConnectAnalytics` spread conditionally from `onConnect`; version omitted this branch).
   - the `<DecisionSummary>` (keep it — it can live above the pane or inside the "changes" section; put it directly under the status bar so the verdict stays first).
   - a `<div className="run-shell">` containing `<SectionRail items={railItems} activeId={activeId} onSelect={setActiveId} />` and `<RunDetailPane activeId={activeId} sections={sections} />`.
   - the existing `<div className="decision-bar">` (unchanged).
6. For **non-pending** runs, keep the current linear render untouched (the approved push card, localization card, github PR card, handoff, mcp handoff, and the run-status line). Do NOT route these through the pane.
7. Remove the now-unused `run-layout--railed` / `has-decision-bar` wrappers for the pending branch if they conflict with `.run-shell`; keep whatever the non-pending branch needs. The `IntersectionObserver` no-op in the test's `beforeAll` can stay (harmless) or be removed.

- [ ] **Step 1: Update the RunView test for the shell**

In `cloud/web/src/features/run/RunView.test.tsx`, add a describe block (keep all existing tests that assert non-pending behavior; adjust any pending-run test that assumed all cards render at once — under master-detail only the selected section renders). Add:

```tsx
describe("<RunView /> — run shell (pending)", () => {
  it("renders the status bar with the live app name", async () => {
    const { client } = makeClient({
      extra: { audit: { liveName: "Heathen" }, coverage: { score: 95.6 } },
    });
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("status-bar")).toBeInTheDocument());
    expect(screen.getByTestId("status-bar")).toHaveTextContent("Heathen");
    expect(screen.getByTestId("sb-coverage")).toHaveTextContent("95.6");
  });

  it("groups a critical/warn finding's Audit item under Needs you", async () => {
    const { client } = makeClient({
      extra: {
        findings: [
          { id: "f1", surface: "screenshots", severity: "warn", impact: "conversion",
            title: "Only 3 screenshots", detail: "d", fix: "add more" },
        ],
      },
    });
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("section-rail")).toBeInTheDocument());
    const rail = screen.getByTestId("section-rail");
    expect(rail).toHaveTextContent("Needs you");
    expect(within(rail).getByRole("button", { name: "Audit" })).toBeInTheDocument();
  });

  it("shows only the selected section, and swaps on rail click", async () => {
    const { client } = makeClient({
      extra: {
        coverage: { score: 90, budgets: [] },
        findings: [
          { id: "f1", surface: "screenshots", severity: "warn", impact: "conversion",
            title: "Only 3 screenshots", detail: "d", fix: "add more" },
        ],
      },
    });
    renderView(client);
    // default section is "changes" — the diff is visible, the coverage card is not
    await waitFor(() => expect(screen.getByTestId("diff-name")).toBeInTheDocument());
    expect(screen.queryByTestId("coverage-card")).toBeNull();
    // click Metadata → coverage shows, diff hides
    fireEvent.click(screen.getByRole("button", { name: "Metadata" }));
    expect(screen.getByTestId("coverage-card")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-name")).toBeNull();
  });

  it("still renders the decision bar and Approve/Reject on a pending run", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("decision-bar")).toBeInTheDocument());
    expect(screen.getByTestId("approve")).toBeInTheDocument();
    expect(screen.getByTestId("reject")).toBeInTheDocument();
  });
});
```

> The implementer must confirm the real testids the cards expose (e.g. the coverage card's root testid) via the existing card tests and use the real ones. If `CoverageCard` has no root testid, add a minimal `data-testid="coverage-card"` to its root (a one-line, behavior-neutral change) so the swap assertion can target it. Use `within` — add it to the import from `@testing-library/react` if missing.

- [ ] **Step 2: Run the updated tests to verify they fail**

Run: `cd cloud/web && node node_modules/.bin/vitest run src/features/run/RunView.test.tsx`
Expected: FAIL — status bar / grouped rail / master-detail not implemented yet.

- [ ] **Step 3: Implement the RunView changes**

Apply changes 1–7 above. Follow the existing card JSX verbatim when moving each into the `sections` map; only the container wrapping changes. Keep every conditional-spread pattern (`{...(x ? { p: x } : {})}`) intact.

- [ ] **Step 4: Run the full run-feature suite**

Run: `cd cloud/web && node node_modules/.bin/vitest run src/features/run/`
Expected: PASS — all run-feature tests (RunStatusBar, SectionRail, RunDetailPane, RunView, and the untouched card tests).

- [ ] **Step 5: Typecheck the whole web app**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: no errors. (This is the task that restores green after Task 2's intentional break.)

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/run-shell-layout
git add cloud/web/src/features/run/RunView.tsx cloud/web/src/features/run/RunView.test.tsx cloud/web/src/features/run/CoverageCard.tsx
git commit -m "feat(run): compose the three-zone shell in RunView (status bar + master-detail + decision)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Shell styling

**Files:**
- Modify: `cloud/web/src/app.css`

**Interfaces:** none (CSS only). Class names consumed: `.run-status-bar`, `.sb-app`, `.sb-cell`, `.sb-cta`, `.sb-status` (Task 1); `.section-rail`, `.rail-group`, `.rail-group-label`, `.rail-link`, `.rail-link.active` (Task 2, `.section-rail`/`.rail-link` already exist); `.run-shell`, `.run-detail-pane` (Tasks 3–4).

- [ ] **Step 1: Add the shell CSS**

Append to `cloud/web/src/app.css` (after the existing `.decision-bar` block near line 328). Derive every color from existing tokens; add no new hex.

```css
/* ── Run shell (three-zone layout) ─────────────────────────────────────── */
.run-status-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  padding: 10px 14px; margin-bottom: 16px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  font-family: var(--mono); font-size: 12px; font-variant-numeric: tabular-nums;
}
.run-status-bar .sb-app {
  font-family: var(--sans); font-weight: 600; font-size: 14px; color: var(--ink);
  margin-right: auto;
}
.run-status-bar .sb-cell { color: var(--dim); }
.run-status-bar .sb-cell.faint { color: var(--faint); }
.run-status-bar .sb-status { color: var(--ink); }
.run-status-bar .sb-cta {
  font-family: var(--mono); font-size: 12px; color: var(--brand);
  background: none; border: none; padding: 0; cursor: pointer; text-decoration: none;
}
.run-status-bar .sb-cta:hover { text-decoration: underline; }

.run-shell { display: grid; grid-template-columns: 1fr; gap: 20px; align-items: start; }
@media (min-width: 900px) {
  .run-shell { grid-template-columns: 200px minmax(0, 1fr); }
}
.rail-group { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
.rail-group-label {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--faint); padding: 4px 10px 2px;
}
/* the rail buttons reuse .rail-link; reset button chrome so they match the old anchors */
.section-rail .rail-link {
  display: block; width: 100%; text-align: left; background: none; cursor: pointer;
  font-family: var(--mono); font-size: 12px;
}
.run-detail-pane { min-width: 0; }

/* Below the rail breakpoint, the rail lays out as a horizontal wrap of the same
   buttons (no <select>) so the keyboard model and tests are identical. */
@media (max-width: 899px) {
  .section-rail { flex-direction: row; flex-wrap: wrap; position: static; }
  .rail-group { flex-direction: row; flex-wrap: wrap; align-items: center; margin-bottom: 6px; }
}

@media (prefers-reduced-motion: no-preference) {
  .run-detail-pane { animation: pane-in .16s ease-out; }
  @keyframes pane-in { from { opacity: 0; } to { opacity: 1; } }
}
```

> The existing `@media (max-width: 900px) { .section-rail { display: none; } }` rule (near line 328) HIDES the rail on narrow screens — that was correct for the old scroll-spy but WRONG for the master-detail rail (hiding it would strand the user with no way to switch sections). **Delete that rule** as part of this step.

- [ ] **Step 2: Delete the rail-hiding rule**

Find and remove: `@media (max-width: 900px) { .section-rail { display: none; } }` in `app.css`.

- [ ] **Step 3: Verify the suite still passes (CSS is not unit-tested, but guard against a typo breaking the build)**

Run: `cd cloud/web && node node_modules/.bin/vitest run src/features/run/ && npx tsc --noEmit`
Expected: PASS + no type errors (unchanged from Task 4 — CSS doesn't affect them, this is a regression guard).

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/run-shell-layout
git add cloud/web/src/app.css
git commit -m "style(run): three-zone shell — status bar, grouped rail, detail pane

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: File the Phase-2 follow-up issue

**Files:** none (GitHub only).

- [ ] **Step 1: Create the issue**

Run:

```bash
gh-axi issue create \
  --title "Run status bar: measure version / rating / category rank (Phase 2 of run-shell)" \
  --body "The run-shell status bar (shipped frontend-only) renders live version string, rating (★ + count), and category rank as honest placeholders because RunDetail does not measure them today. Extend RunAudit and the keyed/public read agent to carry these so the bar shows real numbers.

Scope:
- Add to RunAudit: liveVersion (string), rating { average: number|null, count: number|null }, categoryRank { rank: number|null, category: string }.
- Populate them in the read agent (keyed + public paths), measured-or-null — never fabricated.
- Wire RunStatusBar to the new fields; keep the honest placeholders as the null fallback.
- Downloads stays a connect-analytics CTA (Analytics-pipeline only, out of scope here).

Design ref: docs/superpowers/specs/2026-07-23-run-shell-layout-design.md (Follow-up section).
Honesty invariant holds: every new field is measured-or-null, never invented."
```

- [ ] **Step 2: Record the issue number**

Note the created issue number in the final review handoff so the status bar's placeholder comments can reference it. (No code change.)

---

## Self-Review

**Spec coverage:**
- Status bar (measured real / unmeasured placeholder + downloads CTA) → Task 1. ✓
- Master-detail rail (grouped, selectable, controlled) → Task 2. ✓
- One-section-at-a-time pane → Task 3. ✓
- RunView composition (pending-only shell, grouping rules, onConnect reuse, terminal render unchanged) → Task 4. ✓
- CSS / both themes via tokens / narrow-screen rail / delete stale hide rule → Task 5. ✓
- Phase-2 follow-up filed → Task 6. ✓
- Honesty invariant → Global Constraints + Task 1 tests. ✓

**Placeholder scan:** No TBDs. Every code step shows complete code. Grouping thresholds are concrete (grade starts A/B; critical/warn actionable finding). The one deliberate underspecification — the exact card testids in Task 4 — is called out with a fallback instruction (add a one-line testid), because those live in unchanged files the implementer must read.

**Type consistency:** `RailItem`/`RailGroup` defined in Task 2, consumed in Task 4. `RunStatusBarProps` defined in Task 1, consumed in Task 4. `sections: Record<string, ReactNode>` consistent between Task 3 and Task 4. `onConnect`/`onConnectAnalytics` naming: RunView's existing `onConnect` prop maps to RunStatusBar's `onConnectAnalytics` — noted explicitly in Task 4 change 5.

**Ordering note:** Task 2 intentionally leaves the tree non-green (RunView still uses the old SectionRail API); Task 4 restores it. This is flagged in Task 2's Step 5/6 so a reviewer does not treat the mid-sequence typecheck error as a defect.

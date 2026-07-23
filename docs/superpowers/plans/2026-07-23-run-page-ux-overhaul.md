# Run Page UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the run page from a 4.3-screen report into an actionable decision surface — 7 client-only presentation changes across the run-view cards.

**Architecture:** Each finding is one card/component change plus, where needed, small new presentational helpers (`DecisionSummary`, `SectionRail`, a keyword-diff split, a winnability bar). `RunView.tsx` orchestrates; `app.css` gets scoped new classes. No API/DB/engine change — all data already arrives in the run detail response.

**Tech Stack:** React 18 + TypeScript (strict), Vitest 2 + jsdom 25 + `@testing-library/react`. Run all commands from `cloud/web/`.

## Global Constraints

- **Import extensions:** relative imports use `.js` even from `.tsx` (e.g. `from "./DecisionSummary.js"`).
- **Test naming:** colocated `*.test.tsx` (NOT `.spec`). Use `@testing-library/react` (`render`, `screen`), assert via `data-testid` and text.
- **Named exports only**; each new file opens with a short doc-comment header matching sibling cards.
- **Design tokens only — NO new hardcoded hex.** Use `var(--signal)`, `var(--warn)`, `var(--bad)` (danger), `var(--ink)`, `var(--dim)`, `var(--faint)`, `var(--panel)`, `var(--line)`, `var(--signal-dim)`, `var(--signal-glow)`. The #320 contrast guard must still pass. Existing code uses fallback form `var(--bad, #f87171)` etc. — match that idiom.
- **Honesty invariant:** never fabricate or silently hide a signal. A collapsed "healthy checks" disclosure MUST state its count; an unscored keyword shows "not enough data to score", never a number.
- **Additive-safe:** every existing `data-testid` and behavior is preserved unless a task explicitly changes it. The full web suite (currently 217) stays green; `tsc --noEmit` clean.
- **Accessibility:** new interactive controls are real `<button>`/`<a>` with visible focus; wrap transitions in `@media (prefers-reduced-motion: no-preference)` or guard them.
- **Types (verbatim, from `@shipaso/api`):**
  - `Finding = { id; surface; severity: "critical"|"warn"|"good"|"info"; impact; title; detail; fix; evidence?; context?: true }`
  - `Opportunity = { keyword; rank: number|null; opportunityScore: number; scored?: boolean; why; reachability: "now"|"soon"|"longshot" }`
  - `LocaleRecommendation = { locale; rationale; storefrontTier: "large"|"mid"|"long-tail"; effort: "translate"|"new" }`
  - `CopyFields` has string fields `name|subtitle|keywords|promo`.

---

## File Structure

- **Create** `cloud/web/src/features/run/DecisionSummary.tsx` + test (Finding 2)
- **Create** `cloud/web/src/features/run/SectionRail.tsx` + test (Finding 7)
- **Create** `cloud/web/src/features/run/keywordDiff.ts` + test (Finding 5 helper — pure)
- **Modify** `cloud/web/src/features/run/RunView.tsx` (Findings 1, 2, 7)
- **Modify** `cloud/web/src/features/run/FindingsCard.tsx` (Finding 3)
- **Modify** `cloud/web/src/features/run/OpportunitiesCard.tsx` (Finding 4)
- **Modify** `cloud/web/src/features/run/CopyDiff.tsx` (Finding 5)
- **Modify** `cloud/web/src/features/run/LocalizationExpansionCard.tsx` (Finding 6)
- **Modify** `cloud/web/src/app.css` (Findings 1, 3, 4, 5, 6, 7 — scoped classes)

Order rationale: pure helper (Task 1) → leaf cards (Tasks 2–5) → new components (Tasks 6–7) → RunView wiring (Task 8). This lets each card's change be reviewed before the orchestration that composes them.

---

## Task 1: Keyword-diff helper (pure) — Finding 5 core

**Files:**
- Create: `cloud/web/src/features/run/keywordDiff.ts`
- Test: `cloud/web/src/features/run/keywordDiff.test.ts`

**Interfaces:**
- Produces: `type KeywordDiff = { added: string[]; removed: string[]; kept: string[] }` and `diffKeywords(before: string | undefined, after: string | undefined): KeywordDiff`.

- [ ] **Step 1: Write the failing test**

Create `cloud/web/src/features/run/keywordDiff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diffKeywords } from "./keywordDiff.js";

describe("diffKeywords", () => {
  it("splits on comma, trims, and classifies added/removed/kept", () => {
    const d = diffKeywords("mindfulness,calm,stress", "mindfulness, stress, sleep");
    expect(d.removed).toEqual(["calm"]);
    expect(d.added).toEqual(["sleep"]);
    expect(d.kept).toEqual(["mindfulness", "stress"]);
  });

  it("treats undefined/empty sides as no terms", () => {
    expect(diffKeywords(undefined, "a,b")).toEqual({ added: ["a", "b"], removed: [], kept: [] });
    expect(diffKeywords("a,b", "")).toEqual({ added: [], removed: ["a", "b"], kept: [] });
    expect(diffKeywords("", "")).toEqual({ added: [], removed: [], kept: [] });
  });

  it("dedupes and ignores empty terms from stray commas", () => {
    const d = diffKeywords("a,,a, b ", "a, b, b");
    expect(d.kept).toEqual(["a", "b"]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("preserves the after-order for kept+added and before-order for removed", () => {
    const d = diffKeywords("z,y,x", "y,z,w");
    expect(d.kept).toEqual(["y", "z"]); // after-order
    expect(d.added).toEqual(["w"]);
    expect(d.removed).toEqual(["x"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/run/keywordDiff.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `cloud/web/src/features/run/keywordDiff.ts`:

```ts
/**
 * Pure keyword-list diff for the CopyDiff keywords field. Splits two comma
 * lists into added / removed / kept term sets so the UI can render a token diff
 * instead of two strings the reader must compare by eye. Framework-free +
 * unit-tested.
 */
export type KeywordDiff = { added: string[]; removed: string[]; kept: string[] };

function terms(list: string | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const raw of list.split(",")) {
    const t = raw.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function diffKeywords(before: string | undefined, after: string | undefined): KeywordDiff {
  const b = terms(before);
  const a = terms(after);
  const bSet = new Set(b);
  const aSet = new Set(a);
  return {
    // after-order for kept + added; before-order for removed
    kept: a.filter((t) => bSet.has(t)),
    added: a.filter((t) => !bSet.has(t)),
    removed: b.filter((t) => !aSet.has(t)),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd cloud/web && npx vitest run src/features/run/keywordDiff.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/run/keywordDiff.ts cloud/web/src/features/run/keywordDiff.test.ts
git commit -m "feat(run): pure keyword-list diff helper (added/removed/kept)"
```

---

## Task 2: Token keyword diff in CopyDiff — Finding 5

**Files:**
- Modify: `cloud/web/src/features/run/CopyDiff.tsx`
- Modify: `cloud/web/src/app.css`
- Test: `cloud/web/src/features/run/CopyDiff.test.tsx`

**Interfaces:**
- Consumes: `diffKeywords` from `./keywordDiff.js` (Task 1).

**Context:** In `CopyDiff.tsx`, the render maps `changedFields`. Currently the `keywords` field renders like every other field: `<div className="diffside now">{after}</div>` with the `was` side struck. Replace ONLY the `keywords` field body with a token diff; name/subtitle/promo keep the existing string rendering. The char-count (`count-keywords`) and over-limit flag (`over-keywords`) MUST remain.

- [ ] **Step 1: Write the failing test**

Append to `cloud/web/src/features/run/CopyDiff.test.tsx` (inside its existing `describe`). Reuse the file's existing render setup / `CopyFields` import:

```ts
it("renders the keywords field as a token diff: removed struck, added highlighted, kept quiet", () => {
  render(
    <CopyDiff
      current={{ keywords: "mindfulness,calm,stress" }}
      proposed={{ keywords: "mindfulness,stress,sleep" }}
    />,
  );
  const row = screen.getByTestId("diff-keywords");
  // token chips present
  expect(within(row).getByTestId("kw-removed-calm")).toBeInTheDocument();
  expect(within(row).getByTestId("kw-added-sleep")).toBeInTheDocument();
  expect(within(row).getByTestId("kw-kept-mindfulness")).toBeInTheDocument();
  // summary line
  expect(row).toHaveTextContent("1 added");
  expect(row).toHaveTextContent("1 removed");
  // char budget still shown
  expect(within(row).getByTestId("count-keywords")).toBeInTheDocument();
});
```

Ensure `within` is imported: `import { render, screen, within } from "@testing-library/react";` (add `within` if absent).

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/run/CopyDiff.test.tsx`
Expected: the new test FAILS (no `kw-*` testids); existing CopyDiff tests still PASS.

- [ ] **Step 3: Implement**

In `CopyDiff.tsx`, add the import:

```ts
import { diffKeywords } from "./keywordDiff.js";
```

Inside the `changedFields.map`, before the `return`, special-case keywords. Replace the single `return (...)` block so that when `f === "keywords"`, the `diffcols` region renders the token diff instead of the plain `was → now`. Concretely, extract the per-field body: keep the outer `.diffrow` + `.dfield` (with `count-${f}`/`over-${f}`) unchanged, and swap the middle:

```tsx
{f === "keywords" ? (
  (() => {
    const d = diffKeywords(before, after);
    return (
      <div className="kwdiff" data-testid="kwdiff">
        <div className="kwchips">
          {d.removed.map((t) => (
            <span key={t} className="kwchip removed" data-testid={`kw-removed-${t}`}>{t}</span>
          ))}
          {d.added.map((t) => (
            <span key={t} className="kwchip added" data-testid={`kw-added-${t}`}>{t}</span>
          ))}
          {d.kept.map((t) => (
            <span key={t} className="kwchip kept" data-testid={`kw-kept-${t}`}>{t}</span>
          ))}
        </div>
        <p className="micro muted kwdiff-sum" style={{ margin: "6px 0 0" }}>
          {d.added.length} added · {d.removed.length} removed · {d.kept.length} kept
        </p>
      </div>
    );
  })()
) : (
  <div className="diffcols">
    <div className="diffside was">
      {before !== undefined ? (
        <span className={changed ? "strike" : ""}>{before || "—"}</span>
      ) : (
        <span className="faint">(was unread)</span>
      )}
    </div>
    <div className="darrow">→</div>
    <div className={"diffside now" + (over ? " invalid" : "")} data-testid={`now-${f}`}>{after || "—"}</div>
  </div>
)}
```

In `app.css` add:

```css
.kwdiff { margin-top: 2px; }
.kwchips { display: flex; flex-wrap: wrap; gap: 6px; }
.kwchip {
  font-family: var(--mono); font-size: 12px; padding: 3px 9px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--dim);
}
.kwchip.removed { color: var(--bad, #f87171); border-color: var(--bad, #f87171); text-decoration: line-through; }
.kwchip.added { color: var(--signal, #34d399); border-color: var(--signal-dim, #1f8f66); }
.kwchip.kept { color: var(--faint); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd cloud/web && npx vitest run src/features/run/CopyDiff.test.tsx`
Expected: PASS (existing + new).

- [ ] **Step 5: Typecheck**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/run/CopyDiff.tsx cloud/web/src/app.css cloud/web/src/features/run/CopyDiff.test.tsx
git commit -m "feat(run): render the keywords diff as add/remove/keep chips"
```

---

## Task 3: Severity stripes + collapse healthy — Finding 3

**Files:**
- Modify: `cloud/web/src/features/run/FindingsCard.tsx`
- Modify: `cloud/web/src/app.css`
- Test: `cloud/web/src/features/run/FindingsCard.test.tsx`

**Context:** `FindingsCard` splits `actionable` (`!context`) from `context`. Each actionable finding is a `FindingRow`. `Finding.severity` is `critical|warn|good|info`. Add: a severity stripe per row, a severity sort within actionable, and collapse of "healthy" rows (severity `good`, plus `info` with empty `fix`) behind a disclosure. Blockers (`critical`/`warn`, and any finding with a non-empty `fix`) stay expanded. Context strip + unlock CTA unchanged.

- [ ] **Step 1: Write the failing test**

Append to `FindingsCard.test.tsx` (reuse its `Finding` builders / import):

```ts
const mk = (over: Partial<Finding> = {}): Finding => ({
  id: over.id ?? "f", surface: "s", severity: "info", impact: "ranking",
  title: "T", detail: "D", fix: "", ...over,
});

it("shows a severity stripe and sorts blockers above healthy rows", () => {
  render(
    <FindingsCard
      findings={[
        mk({ id: "good1", severity: "good", title: "All good", fix: "" }),
        mk({ id: "crit1", severity: "critical", title: "Blocker", fix: "Fix it" }),
        mk({ id: "warn1", severity: "warn", title: "Warning", fix: "Do this" }),
      ]}
    />,
  );
  const list = screen.getByTestId("findings-list");
  const rows = within(list).getAllByTestId(/^finding-/);
  // critical first, then warn (blockers sorted up)
  expect(rows[0]).toHaveAttribute("data-severity", "critical");
  expect(rows[1]).toHaveAttribute("data-severity", "warn");
});

it("collapses healthy (good/info-no-fix) findings behind a counted disclosure", () => {
  render(
    <FindingsCard
      findings={[
        mk({ id: "crit1", severity: "critical", title: "Blocker", fix: "Fix it" }),
        mk({ id: "good1", severity: "good", title: "Healthy one", fix: "" }),
        mk({ id: "good2", severity: "good", title: "Healthy two", fix: "" }),
      ]}
    />,
  );
  // blocker visible immediately
  expect(screen.getByText("Blocker")).toBeInTheDocument();
  // healthy hidden until expanded, but the count is stated honestly
  const toggle = screen.getByTestId("healthy-toggle");
  expect(toggle).toHaveTextContent("2 healthy checks");
  expect(screen.queryByText("Healthy one")).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText("Healthy one")).toBeInTheDocument();
});
```

Ensure imports include `within` and `fireEvent` from `@testing-library/react`, and `useState` is available in the component.

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/run/FindingsCard.test.tsx`
Expected: new tests FAIL; existing PASS.

- [ ] **Step 3: Implement**

In `FindingsCard.tsx`:

Add `import { useState } from "react";` (top).

Add a severity rank + healthy predicate near the top of the module:

```ts
const SEV_RANK: Record<Finding["severity"], number> = { critical: 0, warn: 1, info: 2, good: 3 };
/** "Healthy" = nothing to act on: a good finding, or an info with no fix. */
function isHealthy(f: Finding): boolean {
  return f.severity === "good" || (f.severity === "info" && f.fix.trim() === "");
}
```

Update `FindingRow` to carry the stripe + severity attr:

```tsx
function FindingRow({ f }: { f: Finding }) {
  return (
    <div
      className={"finding-row sev-" + f.severity}
      data-testid={`finding-${f.id}`}
      data-severity={f.severity}
    >
      <p style={{ margin: 0 }}>
        <span className="sev-chip" style={{ color: SEVERITY_COLOR[f.severity], fontSize: 12, marginRight: 8 }}>
          {f.severity}
        </span>
        <b>{f.title}</b>
      </p>
      <p className="micro" style={{ margin: "2px 0 0" }}>{f.detail}</p>
      {f.fix ? <p className="micro" style={{ margin: "2px 0 0" }}>→ {f.fix}</p> : null}
      {f.evidence ? <p className="micro muted" style={{ margin: "2px 0 0" }}>{f.evidence}</p> : null}
    </div>
  );
}
```

In the component body, after computing `actionable`, split + sort + add collapse state:

```tsx
const [showHealthy, setShowHealthy] = useState(false);
const blockers = actionable.filter((f) => !isHealthy(f)).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
const healthy = actionable.filter(isHealthy);
```

Replace the `findings-list` block:

```tsx
<div data-testid="findings-list">
  {blockers.length === 0 && healthy.length === 0 ? (
    <p className="micro muted">No fixes found on the surfaces we could read.</p>
  ) : (
    blockers.map((f) => <FindingRow key={f.id} f={f} />)
  )}
  {healthy.length > 0 ? (
    <div className="healthy-block" style={{ marginTop: 8 }}>
      <button
        type="button"
        className="healthy-toggle"
        data-testid="healthy-toggle"
        aria-expanded={showHealthy}
        onClick={() => setShowHealthy((v) => !v)}
      >
        {showHealthy ? "▾" : "▸"} {healthy.length} healthy check{healthy.length === 1 ? "" : "s"}
      </button>
      {showHealthy ? healthy.map((f) => <FindingRow key={f.id} f={f} />) : null}
    </div>
  ) : null}
</div>
```

In `app.css` add:

```css
.finding-row { position: relative; margin: 10px 0; padding-left: 12px; }
.finding-row::before {
  content: ""; position: absolute; left: 0; top: 2px; bottom: 2px; width: 3px; border-radius: 2px;
  background: var(--dim);
}
.finding-row.sev-critical::before { background: var(--bad, #f87171); }
.finding-row.sev-warn::before { background: var(--warn, #fbbf24); }
.finding-row.sev-good::before { background: var(--signal, #34d399); }
.finding-row.sev-info::before { background: var(--dim); }
.healthy-toggle {
  appearance: none; background: transparent; border: 0; cursor: pointer; padding: 4px 0;
  font: inherit; font-size: 13px; color: var(--dim);
}
.healthy-toggle:hover { color: var(--ink); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd cloud/web && npx vitest run src/features/run/FindingsCard.test.tsx`
Expected: PASS (existing + new).

- [ ] **Step 5: Typecheck**

Run: `cd cloud/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/run/FindingsCard.tsx cloud/web/src/app.css cloud/web/src/features/run/FindingsCard.test.tsx
git commit -m "feat(run): severity stripes, sort blockers up, collapse healthy checks"
```

---

## Task 4: Winnability bar in OpportunitiesCard — Finding 4

**Files:**
- Modify: `cloud/web/src/features/run/OpportunitiesCard.tsx`
- Modify: `cloud/web/src/app.css`
- Test: `cloud/web/src/features/run/OpportunitiesCard.test.tsx`

**Context:** The score span currently renders `score {N}` when `scored !== false`, else `not enough data to score`. Keep that text, but for a SCORED keyword also render a small winnability bar (0–100 fill). The unscored branch renders NO bar. Existing testid `opp-score-${keyword}` stays.

- [ ] **Step 1: Write the failing test**

Append to `OpportunitiesCard.test.tsx`:

```ts
it("shows a winnability bar for a scored keyword and none for an unscored one", () => {
  render(<OpportunitiesCard opportunities={[reachable, unscored]} />);
  // scored → bar present, width reflects the score
  const bar = screen.getByTestId(`opp-bar-${reachable.keyword}`);
  expect(bar).toBeInTheDocument();
  expect(bar).toHaveStyle({ width: "82%" });
  // unscored → no bar
  expect(screen.queryByTestId(`opp-bar-${unscored.keyword}`)).toBeNull();
  // and still the honest text
  expect(screen.getByTestId(`opp-score-${unscored.keyword}`)).toHaveTextContent("not enough data to score");
});
```

(`reachable` has `opportunityScore: 82`; `unscored` has `scored: false` — both already defined in the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/run/OpportunitiesCard.test.tsx`
Expected: new test FAILS; existing PASS.

- [ ] **Step 3: Implement**

In `OpportunitiesCard.tsx`, inside the `.map`, after the score span, add a bar for scored rows. Replace the score `<span>` region with:

```tsx
<span className="micro muted" style={{ marginLeft: 8 }} data-testid={`opp-score-${o.keyword}`}>
  {o.scored === false ? "not enough data to score" : `score ${Math.round(o.opportunityScore)}`}
</span>
{o.scored !== false ? (
  <span className="winbar" aria-hidden="true">
    <span
      className="winbar-fill"
      data-testid={`opp-bar-${o.keyword}`}
      style={{ width: `${Math.max(0, Math.min(100, Math.round(o.opportunityScore)))}%` }}
    />
  </span>
) : null}
```

In `app.css`:

```css
.winbar {
  display: inline-block; vertical-align: middle; width: 64px; height: 5px; margin-left: 8px;
  background: var(--line-soft); border-radius: 999px; overflow: hidden;
}
.winbar-fill { display: block; height: 100%; background: var(--signal, #34d399); border-radius: 999px; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd cloud/web && npx vitest run src/features/run/OpportunitiesCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck** — `cd cloud/web && npx tsc --noEmit` → No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/run/OpportunitiesCard.tsx cloud/web/src/app.css cloud/web/src/features/run/OpportunitiesCard.test.tsx
git commit -m "feat(run): winnability bar for scored keyword opportunities"
```

---

## Task 5: Markets ranked table — Finding 6

**Files:**
- Modify: `cloud/web/src/features/run/LocalizationExpansionCard.tsx`
- Modify: `cloud/web/src/app.css`
- Test: `cloud/web/src/features/run/LocalizationExpansionCard.test.tsx`

**Context:** Currently each locale renders its full `rationale` sentence. Replace with: one shared rationale line at top, then a compact ranked table (locale + tier tag + effort + a relative size bar). Rows keep received order (ROI sort). Tier→size mapping is presentational: `large`=100, `mid`=60, `long-tail`=30 (relative bar only, NOT a fabricated metric — it mirrors the tier the data already states). Keep `loc-rec-${locale}` testids.

- [ ] **Step 1: Write the failing test**

Append to `LocalizationExpansionCard.test.tsx`:

```ts
it("states the rationale once and renders a compact ranked table with size bars", () => {
  render(
    <LocalizationExpansionCard
      recommendations={[
        { locale: "de-DE", rationale: "German", storefrontTier: "large", effort: "translate" },
        { locale: "pt-BR", rationale: "Portuguese", storefrontTier: "mid", effort: "new" },
      ]}
    />,
  );
  // one shared rationale line (heuristic disclosure kept)
  expect(screen.getByTestId("loc-rationale")).toBeInTheDocument();
  // rows present, in order, with size bars scaled by tier
  const de = screen.getByTestId("loc-rec-de-DE");
  const pt = screen.getByTestId("loc-rec-pt-BR");
  expect(de).toHaveTextContent("large market");
  expect(pt).toHaveTextContent("net-new metadata");
  expect(screen.getByTestId("loc-bar-de-DE")).toHaveStyle({ width: "100%" });
  expect(screen.getByTestId("loc-bar-pt-BR")).toHaveStyle({ width: "60%" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud/web && npx vitest run src/features/run/LocalizationExpansionCard.test.tsx`
Expected: new test FAILS. **Known existing-test conflict:** the current test
(`"renders each locale with its tier, effort, and honest rationale"`) asserts
`screen.getByText(/Large Spanish-speaking market/)` — the per-row rationale
sentence this task removes (rationale now appears once at the top). That
assertion WILL break and must be updated to match the new structure: assert the
row still shows its tier + effort + size bar, and that the shared rationale line
(`loc-rationale`) is present, instead of the per-row sentence. This is a
legitimate structural update, NOT test-weakening — call it out in the commit
message. Keep the tier/effort assertions (lines ~24–26, ~32) as-is.

- [ ] **Step 3: Implement**

Rewrite `LocalizationExpansionCard.tsx` body:

```tsx
const TIER_LABEL: Record<StorefrontTier, string> = {
  large: "large market", mid: "mid market", "long-tail": "long-tail",
};
const TIER_SIZE: Record<StorefrontTier, number> = { large: 100, mid: 60, "long-tail": 30 };

export function LocalizationExpansionCard({ recommendations }: { recommendations: LocaleRecommendation[] }) {
  if (recommendations.length === 0) return null;
  return (
    <div className="card" data-testid="localization-expansion-card">
      <b>Markets to expand into</b>
      <p className="micro muted" data-testid="loc-rationale" style={{ margin: "2px 0 8px" }}>
        ROI-sorted locales you don’t list in yet — translate your existing copy to claim them.
        A market-size heuristic, not live install data.
      </p>
      <div className="loc-table">
        {recommendations.map((r) => (
          <div key={r.locale} className="loc-row" data-testid={`loc-rec-${r.locale}`}>
            <span className="loc-code">{r.locale}</span>
            <span className="loc-size">
              <span className="loc-size-fill" data-testid={`loc-bar-${r.locale}`}
                style={{ width: `${TIER_SIZE[r.storefrontTier]}%` }} />
            </span>
            <span className="micro muted loc-tier">{TIER_LABEL[r.storefrontTier]}</span>
            <span className="micro muted loc-effort">
              {r.effort === "translate" ? "translate existing copy" : "net-new metadata"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

In `app.css`:

```css
.loc-table { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.loc-row {
  display: grid; grid-template-columns: 68px 90px 1fr auto; gap: 10px; align-items: center;
  padding: 6px 0; border-bottom: 1px solid var(--line-soft);
}
.loc-code { font-family: var(--mono); font-size: 13px; color: var(--ink); }
.loc-size { height: 6px; background: var(--line-soft); border-radius: 999px; overflow: hidden; }
.loc-size-fill { display: block; height: 100%; background: var(--signal, #34d399); border-radius: 999px; }
.loc-effort { text-align: right; }
@media (max-width: 560px) {
  .loc-row { grid-template-columns: 56px 1fr; }
  .loc-size, .loc-effort { display: none; }
}
```

- [ ] **Step 4: Run to verify it passes** — `cd cloud/web && npx vitest run src/features/run/LocalizationExpansionCard.test.tsx` → PASS.

- [ ] **Step 5: Typecheck** — `cd cloud/web && npx tsc --noEmit` → No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/run/LocalizationExpansionCard.tsx cloud/web/src/app.css cloud/web/src/features/run/LocalizationExpansionCard.test.tsx
git commit -m "feat(run): compact ranked markets table with size bars, rationale once"
```

---

## Task 6: DecisionSummary component — Finding 2

**Files:**
- Create: `cloud/web/src/features/run/DecisionSummary.tsx`
- Modify: `cloud/web/src/app.css`
- Test: `cloud/web/src/features/run/DecisionSummary.test.tsx`

**Interfaces:**
- Consumes: `diffKeywords` (Task 1).
- Produces: `DecisionSummary({ current, proposed, findings }: { current: CopyFields; proposed: CopyFields; findings: Finding[] })`.

- [ ] **Step 1: Write the failing test**

Create `cloud/web/src/features/run/DecisionSummary.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Finding } from "@shipaso/api";
import { DecisionSummary } from "./DecisionSummary.js";

const f = (severity: Finding["severity"], id: string): Finding => ({
  id, surface: "s", severity, impact: "ranking", title: id, detail: "", fix: "",
});

describe("<DecisionSummary />", () => {
  it("summarizes keyword delta and blocker count at a glance", () => {
    render(
      <DecisionSummary
        current={{ keywords: "a,b,c" }}
        proposed={{ keywords: "a,c,d" }}
        findings={[f("critical", "c1"), f("warn", "w1"), f("good", "g1"), f("info", "i1")]}
      />,
    );
    expect(screen.getByTestId("decision-summary")).toBeInTheDocument();
    // +1 (d) / -1 (b)
    expect(screen.getByTestId("ds-keywords")).toHaveTextContent("+1");
    expect(screen.getByTestId("ds-keywords")).toHaveTextContent("−1");
    // 2 blockers (critical + warn)
    expect(screen.getByTestId("ds-blockers")).toHaveTextContent("2 need you");
    // remaining checks
    expect(screen.getByTestId("ds-rest")).toHaveTextContent("2 more checks");
  });

  it("names the single blocker when exactly one", () => {
    render(
      <DecisionSummary current={{ keywords: "a" }} proposed={{ keywords: "a" }}
        findings={[f("critical", "only-blocker")]} />,
    );
    expect(screen.getByTestId("ds-blockers")).toHaveTextContent("only-blocker");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module not found → FAIL.

- [ ] **Step 3: Implement**

Create `cloud/web/src/features/run/DecisionSummary.tsx`:

```tsx
/**
 * DecisionSummary — the verdict, before the detail. On an open run it states the
 * net keyword delta and how many findings actually need the user, so a reviewer
 * can decide without reading all the cards. Honest: counts are derived from the
 * same data the cards render; nothing is invented. Pure presentational.
 */
import type { CopyFields, Finding } from "@shipaso/api";
import { diffKeywords } from "./keywordDiff.js";

const isBlocker = (f: Finding) => f.severity === "critical" || f.severity === "warn";

export function DecisionSummary({
  current, proposed, findings,
}: { current: CopyFields; proposed: CopyFields; findings: Finding[] }) {
  const kw = diffKeywords(current.keywords, proposed.keywords);
  const actionable = findings.filter((f) => !f.context);
  const blockers = actionable.filter(isBlocker);
  const rest = actionable.length - blockers.length;

  return (
    <div className="decision-summary" data-testid="decision-summary">
      <span className="ds-pill kw" data-testid="ds-keywords">
        keywords <b className="add">+{kw.added.length}</b> / <b className="rem">−{kw.removed.length}</b>
      </span>
      <span className={"ds-pill " + (blockers.length ? "warn" : "ok")} data-testid="ds-blockers">
        {blockers.length === 0
          ? "no blockers"
          : blockers.length === 1
            ? `1 needs you · ${blockers[0]!.title}`
            : `${blockers.length} need you`}
      </span>
      {rest > 0 ? (
        <span className="ds-pill quiet" data-testid="ds-rest">{rest} more check{rest === 1 ? "" : "s"}</span>
      ) : null}
    </div>
  );
}
```

In `app.css`:

```css
.decision-summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 18px; }
.ds-pill {
  font-family: var(--mono); font-size: 12px; padding: 5px 11px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--dim);
}
.ds-pill .add { color: var(--signal, #34d399); } .ds-pill .rem { color: var(--bad, #f87171); }
.ds-pill.warn { color: var(--warn, #fbbf24); border-color: var(--warn, #fbbf24); }
.ds-pill.ok { color: var(--signal, #34d399); border-color: var(--signal-dim, #1f8f66); }
.ds-pill.quiet { color: var(--faint); }
```

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Typecheck** — No errors.
- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/run/DecisionSummary.tsx cloud/web/src/app.css cloud/web/src/features/run/DecisionSummary.test.tsx
git commit -m "feat(run): DecisionSummary — keyword delta + blocker count at a glance"
```

---

## Task 7: SectionRail component — Finding 7

**Files:**
- Create: `cloud/web/src/features/run/SectionRail.tsx`
- Modify: `cloud/web/src/app.css`
- Test: `cloud/web/src/features/run/SectionRail.test.tsx`

**Interfaces:**
- Produces: `type RailItem = { id: string; label: string }` and `SectionRail({ items }: { items: RailItem[] })` — renders a sticky nav of jump links (`href="#${id}"`), skipping none (caller passes only present sections). Active-on-scroll via IntersectionObserver, guarded so it no-ops when the API is absent (jsdom).

- [ ] **Step 1: Write the failing test**

Create `cloud/web/src/features/run/SectionRail.test.tsx`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SectionRail } from "./SectionRail.js";

beforeAll(() => {
  // jsdom lacks IntersectionObserver — provide a no-op so the component mounts.
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    class { observe() {} disconnect() {} unobserve() {} };
});

describe("<SectionRail />", () => {
  it("renders a jump link per section, in order", () => {
    render(<SectionRail items={[{ id: "changes", label: "Changes" }, { id: "audit", label: "Audit" }]} />);
    const rail = screen.getByTestId("section-rail");
    const links = within(rail).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#changes", "#audit"]);
    expect(rail).toHaveTextContent("Changes");
    expect(rail).toHaveTextContent("Audit");
  });

  it("renders nothing when given no sections", () => {
    render(<SectionRail items={[]} />);
    expect(screen.queryByTestId("section-rail")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module not found).

- [ ] **Step 3: Implement**

Create `cloud/web/src/features/run/SectionRail.tsx`:

```tsx
/**
 * SectionRail — a slim sticky index of the run's sections, so a long report is
 * navigable instead of a linear wall. Jump links to each section anchor; the
 * active one highlights on scroll (IntersectionObserver, guarded for SSR/jsdom).
 * Hidden on narrow viewports via CSS (the sticky action bar carries the decision
 * there). Pure presentational; the caller passes only the sections present.
 */
import { useEffect, useState } from "react";

export type RailItem = { id: string; label: string };

export function SectionRail({ items }: { items: RailItem[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || items.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const it of items) {
      const el = document.getElementById(it.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [items]);

  if (items.length === 0) return null;
  return (
    <nav className="section-rail" data-testid="section-rail" aria-label="Run sections">
      {items.map((it) => (
        <a
          key={it.id}
          href={`#${it.id}`}
          className={"rail-link" + (active === it.id ? " active" : "")}
        >
          {it.label}
        </a>
      ))}
    </nav>
  );
}
```

In `app.css`:

```css
.section-rail {
  position: sticky; top: 24px; display: flex; flex-direction: column; gap: 2px;
  font-family: var(--mono); font-size: 12px;
}
.rail-link {
  color: var(--faint); text-decoration: none; padding: 4px 10px; border-left: 2px solid var(--line-soft);
}
.rail-link:hover { color: var(--dim); }
.rail-link.active { color: var(--ink); border-left-color: var(--signal, #34d399); }
@media (max-width: 900px) { .section-rail { display: none; } }
```

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Typecheck** — No errors.
- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/run/SectionRail.tsx cloud/web/src/app.css cloud/web/src/features/run/SectionRail.test.tsx
git commit -m "feat(run): SectionRail — sticky jump nav for the run sections"
```

---

## Task 8: Wire it all into RunView — Findings 1, 2, 7 + composition

**Files:**
- Modify: `cloud/web/src/features/run/RunView.tsx`
- Modify: `cloud/web/src/app.css`
- Test: `cloud/web/src/features/run/RunView.test.tsx`

**Context:** Compose the new pieces into `RunView`. The `pending` boolean already gates the current inline Approve/Reject. Changes:
1. **Sticky action bar** replacing the inline `.btn-row` when `pending && !tierLimited`. Same `decide.mutate` wiring, same `approve`/`reject` testids (so existing tests pass). Add bottom padding to the section so content clears the bar.
2. **DecisionSummary** rendered right after `<CopyDiff>` when `pending`.
3. **SectionRail** + section anchors: give each rendered card a wrapping anchor `id` (`changes`, `audit`, `metadata`, `keywords`, `markets`, `screenshots`) and pass the present ones to `SectionRail`. Layout: rail in a left gutter on wide screens, content column centered.

Preserve ALL existing behavior: approved/rejected/superseded paths, push cards, handoff, MCP — untouched.

- [ ] **Step 1: Write the failing test**

Append to `RunView.test.tsx` (reuse its existing render harness / mock client that returns an open run). Add:

The file already has `makeClient()` (default `status = "awaiting_approval"`, i.e.
open) and `renderView(client)`, and an existing test *"pending: shows the diff +
Approve/Reject…"* that renders an open run. Model the new tests on that one:

```ts
it("shows the sticky decision bar with Approve/Reject on an open run", async () => {
  renderView(makeClient());
  expect(await screen.findByTestId("decision-bar")).toBeInTheDocument();
  // buttons still carry their original testids + wiring (unchanged)
  expect(screen.getByTestId("approve")).toBeInTheDocument();
  expect(screen.getByTestId("reject")).toBeInTheDocument();
});

it("renders the decision summary and a section rail on an open run", async () => {
  renderView(makeClient());
  expect(await screen.findByTestId("decision-summary")).toBeInTheDocument();
  expect(screen.getByTestId("section-rail")).toBeInTheDocument();
});
```

Match the ACTUAL helper names in the file (`makeClient`/`renderView` per the
current setup; if they differ, use whatever the existing open-run test uses —
do not invent a `renderOpenRun`). Add a `beforeAll` installing the jsdom
`IntersectionObserver` no-op (as in SectionRail's test) since RunView now mounts
SectionRail. The section rail also needs the run to have sections — the default
open run from `makeClient` renders `CopyDiff` (→ `changes` anchor), so
`section-rail` will have at least one item; if the default fixture has no
findings/opportunities, the rail still renders the `changes` item and the test
holds.

- [ ] **Step 2: Run to verify it fails** — new tests FAIL; existing RunView tests PASS.

- [ ] **Step 3: Implement**

Imports:

```ts
import { DecisionSummary } from "./DecisionSummary.js";
import { SectionRail, type RailItem } from "./SectionRail.js";
```

Compute the present sections + rail items (after `const r = run.result;`):

```tsx
const railItems: RailItem[] = [
  { id: "changes", label: "Changes" },
  ...(r.findings?.length || r.locks?.length ? [{ id: "audit", label: "Audit" }] : []),
  ...(r.coverage ? [{ id: "metadata", label: "Metadata" }] : []),
  ...(r.opportunities?.length ? [{ id: "keywords", label: "Keywords" }] : []),
  ...(r.localizationExpansion?.length ? [{ id: "markets", label: "Markets" }] : []),
  ...(r.audit?.screenshots ? [{ id: "screenshots", label: "Screenshots" }] : []),
];
```

Wrap the return in a rail + content layout, add anchor ids to each card wrapper, render `DecisionSummary` after `CopyDiff`, and replace the inline `.btn-row` with a sticky bar. Skeleton:

```tsx
return (
  <div className="run-layout">
    {pending ? <aside className="run-rail-col"><SectionRail items={railItems} /></aside> : null}
    <section className={pending ? "run-main has-decision-bar" : "run-main"}>
      <h1>Proposed changes</h1>
      <div id="changes"><CopyDiff current={r.currentCopy} proposed={r.proposedCopy} /></div>
      {pending ? (
        <DecisionSummary current={r.currentCopy} proposed={r.proposedCopy} findings={r.findings ?? []} />
      ) : null}

      {(r.findings?.length || r.locks?.length) ? (
        <div id="audit"><FindingsCard /* …existing props… */ /></div>
      ) : null}
      {r.coverage ? <div id="metadata"><CoverageCard coverage={r.coverage} /></div> : null}
      {r.opportunities?.length ? <div id="keywords"><OpportunitiesCard opportunities={r.opportunities} /></div> : null}
      {r.localizationExpansion?.length ? <div id="markets"><LocalizationExpansionCard recommendations={r.localizationExpansion} /></div> : null}
      {/* ppo / screenshots (wrap screenshots card in id="screenshots") / cpp — unchanged otherwise */}

      {/* existing approved/rejected/superseded status, push cards, handoff, MCP — UNCHANGED */}
    </section>

    {pending && !tierLimited ? (
      <div className="decision-bar" data-testid="decision-bar">
        <span className="db-summary micro muted">
          {(() => {
            const added = (r.proposedCopy.keywords ?? "").split(",").map((s) => s.trim()).filter(Boolean).length;
            return `${r.findings?.filter((f) => !f.context && (f.severity === "critical" || f.severity === "warn")).length ?? 0} to review · ${added} keywords`;
          })()}
        </span>
        <span className="db-actions">
          <button type="button" className="btn ghost" data-testid="reject" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>Reject</button>
          <button type="button" className="btn primary" data-testid="approve" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
            {decide.isPending ? "Approving…" : "Approve changes"}
          </button>
        </span>
      </div>
    ) : null}
  </div>
);
```

IMPORTANT: remove the old inline `.btn-row` (the `pending ?` block that rendered inline approve/reject) — the sticky bar replaces it. Keep the non-pending status line exactly as-is (render it inside `.run-main` where the old ternary's `else` was).

In `app.css`:

```css
.run-layout { display: grid; grid-template-columns: 1fr; gap: 24px; }
@media (min-width: 900px) {
  .run-layout { grid-template-columns: 160px minmax(0, 1fr); align-items: start; }
}
.run-main.has-decision-bar { padding-bottom: 88px; }
.decision-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  display: flex; align-items: center; gap: 16px;
  padding: 12px max(16px, calc((100% - 940px) / 2));
  background: var(--panel); border-top: 1px solid var(--line);
}
.decision-bar .db-summary { margin-right: auto; }
.decision-bar .db-actions { display: flex; gap: 10px; }
@media (prefers-reduced-motion: no-preference) {
  .decision-bar { animation: db-in .18s ease-out; }
  @keyframes db-in { from { transform: translateY(100%); } to { transform: none; } }
}
```

- [ ] **Step 4: Run the RunView suite** — `cd cloud/web && npx vitest run src/features/run/RunView.test.tsx` → PASS (existing + new).

- [ ] **Step 5: Typecheck** — `cd cloud/web && npx tsc --noEmit` → No errors.

- [ ] **Step 6: Commit**

```bash
git add cloud/web/src/features/run/RunView.tsx cloud/web/src/app.css cloud/web/src/features/run/RunView.test.tsx
git commit -m "feat(run): sticky decision bar + summary + section rail in RunView"
```

---

## Task 9: Full suite + typecheck gate

**Files:** none (verification only).

- [ ] **Step 1: Full web suite** — `cd cloud/web && npx vitest run` → all green, no regressions from the 217 baseline (new tests add to it).
- [ ] **Step 2: Typecheck** — `cd cloud/web && npx tsc --noEmit` → No errors.
- [ ] **Step 3: Token contrast guard still passes** — `cd packages/tokens && npm test` → OK (confirms no new hardcoded muted hex broke the #320 guard; our new colors all use tokens).

No commit — final gate before whole-branch review.

---

## Self-Review

- **Spec coverage:** F1 sticky bar (Task 8), F2 DecisionSummary (Task 6 + wired Task 8), F3 severity stripes+collapse (Task 3), F4 winnability bar (Task 4), F5 token keyword diff (Tasks 1+2), F6 markets table (Task 5), F7 SectionRail (Task 7 + wired Task 8). All 7 covered. ✅
- **Placeholder scan:** none — every step has concrete code/commands. The Task 8 skeleton references "existing props unchanged" for cards already shown verbatim in the plan's context; the implementer keeps them as-is. ✅
- **Type consistency:** `diffKeywords` signature identical across Tasks 1, 2, 6. `Finding.severity`/`Opportunity.scored`/`LocaleRecommendation.storefrontTier` used exactly per the API types. `RailItem` defined in Task 7, consumed in Task 8. All new colors use existing tokens (no new hex) so the #320 guard holds. ✅
- **Honesty:** collapsed healthy states its count (Task 3); unscored keyword shows no bar + honest text (Task 4); markets size bar mirrors the stated tier, not an invented metric (Task 5); DecisionSummary counts derive from rendered data (Task 6). ✅

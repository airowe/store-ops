# PRD 05 — `/apps/:id` (app detail + chart entry)

> Migrate the app-detail route: identity, the **rank sparkline** (+ #62
> what-changed annotations), the listing audit (findings + grade), the metadata
> **coverage gauge**, screenshot gallery/levers, opportunities, keyword table,
> and localization. This is the first chart-bearing route, so it lands together
> with the web chart primitive from PRD 08. Honesty-dense — many unseen/empty/
> zero states live here.

## The move
Port `viewApp(id, query)` (`app.js`, incl. the `?asc=1` scroll-and-flash and the
`sparkline()` render) to `/apps/:id`, faithful to Expo `(app)/apps/[id].tsx`.

## Deliverables
- `cloud/web/app/routes/apps.$id.tsx` + section components:
  - **Rank trend** — the sparkline via PRD 08's uPlot primitive, fed by
    `@shipaso/honesty` `buildSparkGeometry`; #62 annotation markers (▲ push /
    ◆ competitor) with hover provenance.
  - **Listing audit** — findings list (critical/warn/good treatments) + grade
    chip; the `--bad` critical treatment (the exact one the CI test pins).
  - **Coverage gauge** — score + per-field fill + itemized waste; `unseen` vs
    `empty` vs filled states rendered distinctly.
  - **Screenshots** — gallery + improvement levers; **opportunities**; **keyword
    table** (bucketed); **localization** recommendations.
  - ASC-unlock CTA on a no-key run.
- Data via `@shipaso/api`: `getApp`, `getRanks`, `getDeltas`, audit/coverage
  payloads.

## UI
- Preserve `?asc=1` deep-link → scroll to + flash the ASC run panel (`.asc-flash`).
- Chart is theme-aware (reads token CSS vars), reduced-motion safe.

## Honesty
- Coverage: an **unseen** field (no-key run) reads "UNKNOWN / not read" — never a
  false `0/limit`; **empty** (read-but-blank) is a distinct "opportunity" state.
- Sparkline plots a null rank at the floor labeled **#200+**, never `0`; a
  single snapshot draws no fabricated trend.
- Audit grades and impact chips carry the existing framing (heuristic, not a rank
  guarantee).

## TDD
- Port coverage-state tests (`CoverageGauge` unseen/empty/filled) and the
  sparkline geometry tests.
- Route test: audit findings render the correct severity treatment from fixtures.

## Acceptance
- `/apps/:id` served by the new app; visual + behavioral parity.
- `flows.e2e.ts` "a critical finding renders in the `--bad` treatment" and the
  coverage/audit specs pass pre-flip (dark-default, so the pinned `rgb(248,113,113)`
  holds).
- `?asc=1` flash works.

## Coexistence / rollback
- Flip `/apps/:id`. War room still lives on the legacy run view until PRD 06/07;
  ensure the war-room entry point routes correctly during the interim. Rollback =
  revert the entry.

## Dependencies
- **PRD 01, 02, 04**, and **PRD 08** (chart primitive) land together.

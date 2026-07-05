# `packages/` — the shared spine (PRD 01 spike)

Proof-of-shape for [PRD 01](../docs/prd/web-migration/01-shared-spine.md): the
framework-agnostic packages both surfaces will import, so consistency is
**structural**, not policed after the fact. **Additive** — nothing in `mobile/`
or `cloud/public/` is rewired yet.

| Package | What | Status in this spike |
|---------|------|----------------------|
| `@shipaso/tokens` | Canonical `tokens.json` → generates web CSS custom properties + RN palette | **real + verified**: `verify.mjs` proves the generated dark+light palettes match the live `cloud/public/styles.css` (30/30 values) |
| `@shipaso/honesty` | Pure `formatRank` / `classifyDelta` / `buildSparkGeometry` (+ `format`, `timeAgo`) | **real + tested**: `node --test` (5 suites), logic ported verbatim from the mobile app |
| `@shipaso/api` | Transport-agnostic REST client + types (injected `fetch` + auth) | **typed shape**: compiles under `packages/tsconfig.json`; types are a representative subset |

## Run it
```bash
# tokens: regenerate + prove parity with the shipped stylesheet
node packages/tokens/build.mjs && node packages/tokens/verify.mjs

# honesty: pure-logic tests
cd packages/honesty && node --test

# api + generated tokens + honesty typings: typecheck
mobile/node_modules/.bin/tsc -p packages/tsconfig.json
```

## Why this is the right first step
- **Kills token drift at the source.** Today `styles.css :root` and
  `mobile/src/theme/tokens.ts` are hand-maintained and a CI test polices the
  seam. `verify.mjs` shows `tokens.json` reproduces both exactly — the production
  step generates both artifacts and retires the drift test.
- **One definition of the honesty rules.** `formatRank`/`classifyDelta`/
  `buildSparkGeometry` are load-bearing (unseen ≠ 0, no fabricated count-up,
  #200+ floor, inverted axis). Sharing them means web and native can't diverge.
- **One API client.** The transport seam (`createClient({ fetchImpl, authHeaders,
  credentials })`) lets native (token) and web (cookie) share every endpoint call.

## Production wiring (out of spike scope)
1. Make `styles.css` consume `@shipaso/tokens/css` and `mobile/src/theme/tokens.ts`
   re-export the generated TS; delete the hand-maintained values + the drift test.
2. Repoint `mobile/src/{lib/format,components/Sparkline}` and the web at
   `@shipaso/honesty`.
3. Repoint `mobile/src/api` at `@shipaso/api`; lift the full `types/api.ts`.
4. Adopt npm/pnpm workspaces so `mobile/` and `cloud/web/` (PRD 02) resolve
   `@shipaso/*`.

Each step is independently shippable and reversible.

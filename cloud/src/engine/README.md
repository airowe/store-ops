# src/engine/ — the ported ASO loop (TypeScript)

Pure, testable logic ported faithfully from the Python libs in
`../../lib/`. No Worker/D1 imports here — keep it pure so it unit-tests in
`vitest` without a runtime. The api/ and cron/ layers call into this.

Planned modules (NOT built yet — scaffold only):

| module                | ports from (lib/)              | does |
|-----------------------|--------------------------------|------|
| `constants.ts` ✅      | `aso_copy_stub`, `aso_rank_check`, `aso_screenshot_score` | char limits, endpoints, weights, buckets |
| `itunes.ts`           | `aso_rank_check`, `aso_competitor_watch` | iTunes Search/Lookup fetch w/ retry+backoff; lenient JSON parse (raw control chars) |
| `rank.ts`             | `aso_rank_check`               | `rankFor` / `ranksFor` — 1-based organic rank, absent => not top 200 |
| `competitor.ts`       | `aso_competitor_watch`         | lookup by id/bundle, resolve name→id via search, diff snapshots |
| `screenshots.ts`      | `aso_screenshot_score`         | score from screenshotUrls[]; aspect from "1290x2796bb.png" token |
| `keywords.ts`         | (new) keyword reasoning        | score = volume*0.4 + (100-difficulty)*0.3 + relevance*0.3; bucket |
| `optimize.ts`         | `aso_copy_stub` LIMITS         | emit copy within CHAR_LIMITS; keyword field comma-joined no spaces, no dupes |
| `loop.ts`             | `store_ops_orchestrator`       | audit → research → optimize → prepare push; produce a run + proposals |

Tests live colocated as `*.spec.ts` (per user TDD standard).

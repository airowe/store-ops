/**
 * Category-corpus collection cron step (#63). Piggybacked on the daily snapshot
 * (the runAnalyticsIngest precedent), it collects a broad, category-tagged sample
 * of the top-N apps per fixed seed keyword and banks it into `corpus_snapshots`.
 *
 * OFF by default: does nothing unless `CATEGORY_CORPUS_ENABLED` is set. Broad
 * systematic iTunes collection is a different egress/ToS scale than the product's
 * per-app reads, so it stays dark until the owner reviews acceptable-use + cost.
 *
 * Conservative caps (the enabled footprint): a small FIXED seed set (CORPUS_SEEDS,
 * not user-driven) × topN 20 × once/day ≈ 200 rows/day. The report is logged so
 * the footprint is never silent. Failures are self-contained — this must never
 * break the daily snapshot it rides on.
 */
import { collectCorpus, CORPUS_SEEDS, DEFAULT_COUNTRY, DEFAULT_TOP_N } from "../engine/corpusCollect.js";
import { persistCorpusSnapshots } from "../d1.js";
import { fetchForEnv } from "../fetchAdapter.js";
import type { Env } from "../index.js";

const flagOn = (v: string | undefined): boolean => v === "1" || v?.toLowerCase() === "true";

export type CorpusReport = {
  enabled: boolean;
  seedsProcessed: number;
  rowsPersisted: number;
};

/**
 * Run one corpus collection pass. Inert (enabled:false) unless the flag is on.
 * When on: search the fixed seeds via the env's FetchFn (TinyFish in prod),
 * persist the observations, and return a small report for the cron log.
 */
export async function runCorpusCollection(env: Env): Promise<CorpusReport> {
  if (!flagOn(env.CATEGORY_CORPUS_ENABLED)) {
    return { enabled: false, seedsProcessed: 0, rowsPersisted: 0 };
  }
  const fetchFn = fetchForEnv(env);
  const observations = await collectCorpus(fetchFn, CORPUS_SEEDS, {
    country: DEFAULT_COUNTRY,
    topN: DEFAULT_TOP_N,
  });
  await persistCorpusSnapshots(env.DB, observations);
  return { enabled: true, seedsProcessed: CORPUS_SEEDS.length, rowsPersisted: observations.length };
}

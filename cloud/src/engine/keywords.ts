/**
 * Keyword reasoning — scoring + bucketing. (New: this formula is specified by
 * the product, not yet present in a Python lib, so it's authored here against
 * the shared KEYWORD_WEIGHTS / KEYWORD_BUCKETS constants.)
 *
 *   score = volume*0.4 + (100 - difficulty)*0.3 + relevance*0.3
 *
 * Inputs are 0–100 scales (volume, difficulty, relevance); score is 0–100.
 * Bucketing maps the ranked keywords to store fields:
 *   Primary → name (title) · Secondary → subtitle · Long-tail → keyword field ·
 *   Aspirational → tracked only (not placed in metadata).
 */
import { BUCKET_TO_FIELD, KEYWORD_WEIGHTS, type KeywordBucket } from "./constants.js";

export type KeywordInput = {
  keyword: string;
  volume: number; // 0–100 search-volume proxy
  difficulty: number; // 0–100 (higher = harder to rank)
  relevance: number; // 0–100 fit to the app
};

export type ScoredKeyword = KeywordInput & {
  score: number; // 0–100 composite
  bucket: KeywordBucket;
  field: ReturnType<typeof bucketField>;
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** The composite keyword score (rounded to 2 dp). */
export function scoreKeyword(k: KeywordInput): number {
  const v = clamp(k.volume);
  const d = clamp(k.difficulty);
  const r = clamp(k.relevance);
  const raw =
    v * KEYWORD_WEIGHTS.volume +
    (100 - d) * KEYWORD_WEIGHTS.difficulty +
    r * KEYWORD_WEIGHTS.relevance;
  return Math.round(raw * 100) / 100;
}

function bucketField(b: KeywordBucket) {
  return BUCKET_TO_FIELD[b];
}

/**
 * Bucket by rank within the scored set: the strongest keyword anchors the title
 * (Primary), the next the subtitle (Secondary), the bulk feed the keyword field
 * (Long-tail), and weak/broad terms are Aspirational (tracked, not placed).
 *
 * `primaryN`/`secondaryN` default to 1 each (title and subtitle each lead with
 * one anchor term); everything above the `aspirationalFloor` score goes Long-tail,
 * the rest Aspirational.
 */
export function bucketize(
  inputs: KeywordInput[],
  {
    primaryN = 1,
    secondaryN = 1,
    aspirationalFloor = 40,
  }: { primaryN?: number; secondaryN?: number; aspirationalFloor?: number } = {},
): ScoredKeyword[] {
  const scored = inputs
    .map((k) => ({ ...k, score: scoreKeyword(k) }))
    .sort((a, b) => b.score - a.score);

  return scored.map((k, i) => {
    let bucket: KeywordBucket;
    if (i < primaryN) bucket = "Primary";
    else if (i < primaryN + secondaryN) bucket = "Secondary";
    else if (k.score >= aspirationalFloor) bucket = "Long-tail";
    else bucket = "Aspirational";
    return { ...k, bucket, field: bucketField(bucket) };
  });
}

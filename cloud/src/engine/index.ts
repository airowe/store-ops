/**
 * store-ops engine — public surface. The api/ and cron/ layers import from here.
 * Pure TypeScript (no Cloudflare bindings); every network call goes through an
 * injected `FetchFn`, so the whole engine unit-tests without a runtime.
 */
export * from "./constants.js";
export {
  type FetchFn,
  ItunesError,
  type ItunesResult,
  type ItunesResponse,
  lenientJsonParse,
  fetchJson,
  buildUrl,
} from "./itunes.js";

export { type Rank, rankFor, ranksFor } from "./rankCheck.js";
export {
  type Listing as CompetitorListing,
  type Change,
  type WatchField,
  WATCH_FIELDS,
  lookup,
  lookupAll,
  resolveNameToId,
  diff as diffCompetitors,
  digestLine as competitorDigest,
  watched,
} from "./competitorWatch.js";
export {
  type Listing as ScreenshotListing,
  type ShotScore,
  type Grade,
  score as scoreScreenshots,
  aspectFromUrl,
  aspectLabel,
} from "./screenshotScore.js";
export {
  type KeywordInput,
  type ScoredKeyword,
  scoreKeyword,
  bucketize,
} from "./keywords.js";
export {
  type CopyFields,
  type CopyValidation,
  type FieldCheck,
  type ProposedCopy,
  validateCopy,
  buildKeywordField,
  optimizeCopy,
} from "./optimize.js";
export {
  type AppInput,
  type AgentResult,
  type Audit,
  type PushCommand,
  runAgent,
  buildPushCommands,
  competitorLookup,
} from "./agent.js";
export {
  type Query,
  type AppCandidate,
  type ResolveResult,
  MAX_CANDIDATES,
  classifyQuery,
  resolveAppQuery,
} from "./resolveApp.js";
export {
  type InAppPurchase,
  type AppPricing,
  mapInAppPurchase,
  resolvePriceSchedule,
  readAscPricingAndIAP,
} from "./ascRead.js";
export {
  type VersionState,
  type AscVersionStateResult,
  readAscVersionState,
  type AscAgeRatingResult,
  readAscAgeRating,
  mapAgeRatingDeclaration,
} from "./ascWrite.js";

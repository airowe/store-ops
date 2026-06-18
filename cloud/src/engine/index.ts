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
  resolveNameToBundle,
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
export { type AscSnapshot, readAscSnapshot, ascScreenshotsToListing } from "./ascRead.js";
export {
  type Finding,
  type FindingSeverity,
  type FindingImpact,
  type FindingsSummary,
  type AuditFindingsInput,
  auditFindings,
  summarizeFindings,
  scoreFinding,
} from "./auditFindings.js";
export { type AscContext, buildAscContext, FORBIDDEN_CONTEXT_KEYS } from "./ascContext.js";
export {
  type Opportunity,
  type OpportunityDrivers,
  type Reachability,
  type RankSnapshot,
  type RankOpportunityInput,
  rankOpportunities,
} from "./rankOpportunity.js";
export {
  type KeywordGap,
  type FindKeywordGapsInput,
  findKeywordGaps,
} from "./keywordGap.js";
export {
  type RankMovement,
  type AttributedChange,
  type AttributionConfidence,
  type MovementDirection,
  type PushInput,
  attributeRankMovements,
} from "./rankAttribution.js";
export {
  type CoverageReport,
  type CoverageWaste,
  type CoverageOptions,
  metadataCoverage,
} from "./metadataCoverage.js";
export {
  type LocaleRecommendation,
  type StorefrontTier,
  type RecommendLocalesInput,
  recommendLocales,
  rankAll as rankAllLocales,
} from "./localizationExpansion.js";
export {
  type RankSnapshot as WarRoomRankSnapshot,
  type HeadToHead,
  type WarTrend,
  type BuildWarRoomInput,
  buildWarRoom,
} from "./rankWarRoom.js";

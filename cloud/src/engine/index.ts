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
  type Lever,
  type FamilyShotScore,
  type DeviceFamilyShot,
  score as scoreScreenshots,
  scoreScreenshotGroups,
  shotLevers,
  gradeFor,
  aspectFromUrl,
  aspectLabel,
} from "./screenshotScore.js";
export {
  type StoreId,
  type SurfaceRole,
  type RankingSurface,
  type DeviceFamily,
  type StoreProfile,
  type ScreenshotGroup,
  type NormalizedListing,
  type StoreAdapter,
} from "./store/types.js";
export {
  PLAY_CHAR_LIMITS,
  APP_STORE_PROFILE,
  GOOGLE_PLAY_PROFILE,
  STORE_PROFILES,
  profileFor,
  getSurface,
  surfaceByRole,
  surfacesByRole,
  indexedSurfaces,
  primaryDeviceFamily,
} from "./store/profiles.js";
// Our own Google Play data provider (web-source fetch + standards-based parse).
export {
  type PlayPageOpts,
  type PlayPageSource,
  PlayError,
  PLAY_DETAIL_URL,
  PLAY_SEARCH_URL,
  playDetailUrl,
  playSearchUrl,
  fetchText as fetchPlayText,
  playWebSource,
} from "./play/playWebSource.js";
export {
  type PlayDetailRaw,
  extractLdJson,
  extractOgMeta,
  parsePlayDetail,
} from "./play/playListingParse.js";
export { mapPlayDetailToListing, readPlayListing } from "./play/readPlayListing.js";
export {
  type PlayFieldFill,
  type PlayCoverageWaste,
  type PlayCoverageReport,
  type PlayCoverageOptions,
  playCoverage,
} from "./play/playCoverage.js";
export {
  type PlayTermCoverage,
  type PlayKeywordReport,
  type PlayKeywordInput,
  type PlayKeywordOptions,
  analyzePlayKeywords,
} from "./play/playKeywordModel.js";
export {
  type PlayFindingsInput,
  playFindings,
  playSurfaceLocks,
} from "./play/playFindings.js";
// Store-agnostic findings primitives (shared by iOS + Play rule sets).
export { findingsLabel, sortFindings, mk as mkFinding } from "./findings/core.js";
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
  type ReleaseVoice,
  type HumanizeReleaseNotesInput,
  type HumanizedReleaseNotes,
  RELEASE_NOTES_LIMIT,
  humanizeReleaseNotes,
} from "./releaseNotes.js";
export {
  type Finding,
  type FindingSeverity,
  type FindingImpact,
  type FindingsSummary,
  type AuditFindingsInput,
  type SurfaceLock,
  auditFindings,
  summarizeFindings,
  scoreFinding,
  surfaceLocks,
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
  withReviewCandidates,
} from "./keywordGap.js";
export {
  type Review,
  type ReviewSentiment,
  type Topic,
  type TopicSentiment,
  type ReviewKeywordCandidate,
  type Reasoner as ReviewReasoner,
  MIN_CONFIDENT_SAMPLE,
  fetchReviews,
  fetchReviewsForBundle,
  parseReviewsFeed,
  analyzeSentiment,
  extractTopics,
  reviewKeywordCandidates,
  buildReviewsPrompt,
} from "./reviewSentiment.js";
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
export { type PpoTreatmentPlan, buildPpoTreatmentPlan } from "./ppoTreatment.js";
export {
  type LanguageCoverage,
  coverageFromLanguages,
  recommendLocalesFromLanguages,
} from "./languageCoverage.js";
export {
  type ChartRank,
  chartRankFromEntries,
  parseChartFeed,
  fetchChartRank,
} from "./chartRank.js";
export {
  type RankSnapshot as WarRoomRankSnapshot,
  type HeadToHead,
  type WarTrend,
  type BuildWarRoomInput,
  buildWarRoom,
} from "./rankWarRoom.js";
export { appStoreAdapter, mapItunesToListing } from "./appStoreAdapter.js";
export { playAdapter } from "./play/playAdapter.js";
export {
  type PlayAudit,
  type AuditPlayListingOptions,
  auditPlayListing,
} from "./play/auditPlayListing.js";
export {
  type PlayApiTransport,
  type PlayApiListing,
  PlayApiError,
  mapPlayApiListing,
  selectListing,
  readPlayListingViaApi,
  playDeveloperApiAdapter,
} from "./play/playDeveloperApi.js";
export {
  type FetchLike,
  type GoogleServiceAccount,
  type GoogleAccessToken,
  GoogleAuthError,
  ANDROIDPUBLISHER_SCOPE,
  buildServiceAccountAssertion,
  mintGoogleAccessToken,
  playApiTransport,
  playApiTransportForServiceAccount,
  type PlayVerifyResult,
  verifyPlayServiceAccount,
} from "./play/googleAuth.js";

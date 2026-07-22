/**
 * The per-app keyed (or public-fallback) sweep — extracted from the weekly
 * cron (`scheduled.ts`) so the ASC webhook receiver (`api/webhookReceiver.ts`)
 * can trigger the IDENTICAL sweep machinery on a fresh, debounced delivery.
 * Both callers converge here so there is exactly ONE place that decides
 * whether a week's (or a webhook-triggered) pass warrants a human's attention.
 *
 * NEVER pushes. This only PREPARES an app's next run — either opening a NEW
 * `awaiting_approval` run (when the threshold crosses and none is already
 * open) or recording a `detected` snapshot (no run needed / already gated).
 * The irreversible push step stays behind human approval in the API, exactly
 * as the cron has always guaranteed.
 */
import { type AgentResult, runAgent } from "../engine/index.js";
import {
  confirmedCompetitorKeys,
  getLatestCompetitorMap,
  getLatestRanks,
  getThresholds,
  hasOpenRun,
  latestRunTraceForApp,
  persistRun,
  type AppRow,
} from "../d1.js";
import { buildAppInput, descriptionFromTrace } from "../api/runConfig.js";
import { keyedAscPass } from "../api/index.js";
import { mintAscJwt } from "../engine/ascJwt.js";
import { credentialsEnabled, useCredential } from "../credentialStore.js";
import { reasonerForEnv } from "../api/aiReasoner.js";
import { fetchForEnv } from "../fetchAdapter.js";
import { notifyRunAwaitingApproval } from "../push.js";
import type { Env } from "../index.js";
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from "../thresholds.js";

/** Result of evaluating whether this week's data crosses the re-draft threshold. */
export type ThresholdDecision = {
  crossed: boolean;
  reasons: string[];
};

/**
 * Decide if the agent result warrants opening an awaiting_approval run.
 * Pure (testable). Default config = the historical behavior: unranked target
 * keyword OR competitor movement. #53 makes each trigger configurable, adds an
 * optional week-over-week rank-drop trigger, and lets specific keywords /
 * competitors be muted. Thresholds gate what OPENS A RUN — never what the
 * agent measures.
 */
export function evaluateThreshold(
  result: AgentResult,
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
  previousRanks: Array<{ keyword: string; rank: number | null }> = [],
): ThresholdDecision {
  const reasons: string[] = [];
  const mutedKw = new Set(config.mutedKeywords);
  const mutedComp = new Set(config.mutedCompetitors);
  const kwMuted = (kw: string) => mutedKw.has(kw.trim().toLowerCase());

  // (a) any TARGETED keyword still unranked (not in top 200)
  if (config.unranked) {
    const unranked = result.ranks.filter(
      (r) => r.error === "" && r.rank === null && !kwMuted(r.keyword),
    );
    if (unranked.length > 0) {
      reasons.push(
        `${unranked.length} targeted keyword(s) unranked: ${unranked
          .map((r) => r.keyword)
          .join(", ")}`,
      );
    }
  }

  // (a2) #53: rank DROPPED ≥ N places week-over-week (off unless configured).
  // A keyword that fell out of the top 200 entirely (prev ranked → now null)
  // counts as crossing any drop threshold.
  if (config.rankDropAtLeast != null) {
    const prevByKw = new Map(
      previousRanks.map((p) => [p.keyword.trim().toLowerCase(), p.rank] as const),
    );
    for (const r of result.ranks) {
      if (r.error !== "" || kwMuted(r.keyword)) continue;
      const prev = prevByKw.get(r.keyword.trim().toLowerCase());
      if (prev == null) continue; // no baseline — a drop can't be asserted
      if (r.rank === null) {
        reasons.push(`"${r.keyword}" dropped out of the top ${r.limit ?? 200} (was #${prev})`);
      } else if (r.rank - prev >= config.rankDropAtLeast) {
        reasons.push(`"${r.keyword}" dropped ${r.rank - prev} places (#${prev} → #${r.rank})`);
      }
    }
  }

  // (b) competitor movement — a new competitor or a changed visible listing
  if (config.competitorChanges) {
    for (const c of result.competitors.changes) {
      const muted =
        mutedComp.has(String(c.key).trim().toLowerCase()) ||
        ("name" in c && c.name ? mutedComp.has(c.name.trim().toLowerCase()) : false);
      if (muted) continue;
      if (c.status === "new") {
        reasons.push(`new competitor surfaced: ${c.name || c.key}`);
      } else if (c.status === "changed") {
        const fields = Object.keys(c.fields).join(", ");
        reasons.push(`competitor "${c.name || c.key}" changed (${fields})`);
      }
    }
  }

  return { crossed: reasons.length > 0, reasons };
}

/**
 * Full detail of one app's sweep pass — everything the weekly cron's report
 * needs beyond the bare runId. Optional so callers that only care about the
 * runId (the webhook receiver) can ignore it entirely.
 */
export type KeyedSweepDetail = {
  keyed: boolean;
  decision: ThresholdDecision;
  alreadyOpen: boolean;
  opened: boolean;
  runId: string;
};

/**
 * Run ONE app's keyed (or public-fallback) sweep and either open a NEW
 * awaiting_approval run (threshold crossed, none already open, not
 * notify-only) or persist a `detected` snapshot. NEVER pushes. Shared by the
 * weekly cron AND the webhook receiver so both converge on identical run
 * machinery. Returns the OPENED run's id, or null when no new run was opened
 * (a `detected` snapshot may still have been persisted — see `onDetail` for
 * the full picture, used by the cron's report).
 */
export async function runKeyedSweepForApp(
  env: Env,
  app: AppRow,
  opts: { onDetail?: (detail: KeyedSweepDetail) => void } = {},
): Promise<string | null> {
  // #67 Phase 2: AUTONOMOUS KEYED SWEEP. When the owner OPTED IN to storing
  // an ASC key for this app, the sweep runs the FULL read-and-improve pass
  // (real subtitle/keyword proposals, real findings) instead of the public
  // iTunes-only audit — the product's core loop finally running unattended.
  // Still approval-gated: this only PREPARES the run; nothing is pushed. A
  // stored-key read failure degrades to the public pass (never strands the
  // sweep). The stored key's plaintext is a transient here, never persisted
  // onto the run.
  const previous = await getLatestCompetitorMap(env.DB, app.id);
  const cronReasoner = reasonerForEnv(env.AI);
  const confirmed = await confirmedCompetitorKeys(env.DB, app.id);
  const storedAsc = credentialsEnabled(env)
    ? await useCredential(env, app.user_id, app.id, "asc")
    : null;
  let passed: { result: AgentResult; resultWithSnapshot: AgentResult } | null = null;
  if (storedAsc) {
    try {
      const token = await mintAscJwt({
        p8: storedAsc.plaintext,
        keyId: storedAsc.meta.keyId,
        issuerId: storedAsc.meta.issuerId,
      });
      passed = await keyedAscPass(env, app, token, "en-US", {
        ...(confirmed.length ? { competitors: confirmed } : {}),
      });
    } catch {
      passed = null; // stored-key read failed → fall back to the public pass
    }
  }
  const keyed = passed !== null;
  if (!passed) {
    // The public pass builds its input BEFORE the agent reads the live
    // listing, so the keyword reasoner would have no description and would
    // tokenize the name ("Who Got Cooked" → "who"/"got"/"cooked"). Thread
    // the PRIOR run's stored live description in as a reasoning-only hint;
    // an app with no prior run keeps the name-seeded floor.
    const priorTrace = (await latestRunTraceForApp(env.DB, app.id))?.trace;
    const descriptionHint = descriptionFromTrace(priorTrace);
    const input = await buildAppInput(
      app,
      {
        ...(cronReasoner ? { reasoner: cronReasoner } : {}),
        ...(confirmed.length ? { competitors: confirmed } : {}),
        ...(descriptionHint ? { descriptionHint } : {}),
      },
      previous,
    );
    const r = await runAgent(fetchForEnv(env), input);
    passed = { result: r, resultWithSnapshot: r };
  }
  const result = passed.result;
  const resultWithSnapshot = passed.resultWithSnapshot;

  // #53: per-app threshold config (fail-open → historical behavior) + last
  // week's ranks (read BEFORE this pass persists) for the drop trigger.
  const thresholds = await getThresholds(env.DB, app.id);
  const previousRanks =
    thresholds.rankDropAtLeast != null ? await getLatestRanks(env.DB, app.id) : [];
  const decision = evaluateThreshold(result, thresholds, previousRanks);
  const alreadyOpen = await hasOpenRun(env.DB, app.id);
  const openRun = decision.crossed && !alreadyOpen && !thresholds.notifyOnly;

  let runId: string;
  if (openRun) {
    // Open an awaiting_approval run (this also records the snapshots +
    // proposals + generated push commands in one atomic write).
    runId = await persistRun(env.DB, {
      appId: app.id,
      country: app.country,
      status: "awaiting_approval",
      result: resultWithSnapshot,
      trigger: {
        source: "cron",
        reasons: keyed ? [...decision.reasons, "read via your saved App Store Connect key"] : decision.reasons,
      },
    });
    // Notify the owner on their phone — the whole point of push: a run opened
    // while they were away. Best-effort (no tokens / blocked egress → no-op);
    // a notification failure never affects the recorded run.
    await notifyRunAwaitingApproval(globalThis.fetch, env.DB, app, runId);
  } else {
    // No threshold crossed (or a run is already open, or the owner set
    // notify-only #53): still persist this week's snapshots as a recorded
    // pass, but mark the run rejected-equivalent status 'detected' so the
    // time-series stays complete without nagging.
    runId = await persistRun(env.DB, {
      appId: app.id,
      country: app.country,
      status: "detected",
      result: resultWithSnapshot,
      trigger: {
        source: "cron",
        reasons: alreadyOpen
          ? ["snapshot recorded — prior run still awaiting approval"]
          : decision.crossed && thresholds.notifyOnly
            ? [...decision.reasons, "notify-only mode — threshold crossed but no run opened (owner setting)"]
            : ["snapshot recorded — no threshold crossed"],
      },
    });
  }

  opts.onDetail?.({ keyed, decision, alreadyOpen, opened: openRun, runId });

  return openRun ? runId : null;
}

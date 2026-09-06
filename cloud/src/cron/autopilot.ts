/**
 * Autopilot execution — the I/O half (migration 0017).
 *
 * For every approved run whose owner turned `autopilot_execute` on, do what
 * the write routes do, in order, with the stored key, and record each step:
 *
 *   version     find the editable App Store version, or create the next patch
 *   metadata    push the approved copy to the storefront locale
 *   locale:*    push each approved localized draft (creating the localization
 *               when Apple has none for that locale)
 *   screenshots SKIPPED — no rendered asset exists server-side
 *   experiment  SKIPPED — a treatment needs those assets
 *
 * Every Apple call goes through the SAME engine functions the routes use
 * (applyAscMetadata, createAscVersion, createAscLocalization), so autopilot
 * cannot reach a write a person could not. The run becomes 'shipped' only when
 * the metadata write returned success. A failed step stops the strip; the
 * rows say what landed and what did not, and the run is not retried blindly.
 *
 * Runs from the hourly cron and, for a fast path, right after an approval
 * (ctx.waitUntil). Both call executeApprovedRun; the D1 uniqueness of "no
 * execution rows yet" keeps a double trigger from writing twice.
 */
import type { Env } from "../index.js";
import {
  getApp,
  getAscWriteOptIn,
  getAutopilotExecute,
  getTier,
  listApprovedRunsForAutopilot,
  listRunExecutions,
  markRunShipped,
  recordRunExecution,
  type ReasoningTrace,
  type RunRow,
} from "../d1.js";
import { credentialsEnabled, useCredential } from "../credentialStore.js";
import { loadStoredAscForApp } from "../api/ascCredentials.js";
import { mintAscJwt } from "../engine/ascJwt.js";
import {
  applyAscMetadata,
  AscWriteError,
  createAscLocalization,
  createAscVersion,
  EDITABLE_STATES,
  findAscAppId,
  readAscVersionState,
  type FetchLike,
} from "../engine/ascWrite.js";
import { autopilotGate, nextVersionString, planAutopilot, shippedFrom, type ExecutionRecord } from "../engine/autopilot.js";
import { isFlagOn } from "../flags.js";
import { storefrontLocale } from "../api/storefrontLocale.js";

export type AutopilotDeps = {
  fetchFn: FetchLike;
  findAscAppId: typeof findAscAppId;
  readAscVersionState: typeof readAscVersionState;
  createAscVersion: typeof createAscVersion;
  applyAscMetadata: typeof applyAscMetadata;
  createAscLocalization: typeof createAscLocalization;
};

const defaultDeps: AutopilotDeps = {
  fetchFn: fetch as unknown as FetchLike,
  findAscAppId,
  readAscVersionState,
  createAscVersion,
  applyAscMetadata,
  createAscLocalization,
};

export type ExecuteResult = {
  runId: string;
  /** false when the gate refused; `reason` says why and nothing was recorded unless autopilot was on. */
  ran: boolean;
  reason?: string;
  records: ExecutionRecord[];
  shipped: boolean;
};

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function executeApprovedRun(env: Env, run: RunRow, deps: AutopilotDeps = defaultDeps): Promise<ExecuteResult> {
  const out: ExecuteResult = { runId: run.id, ran: false, records: [], shipped: false };
  const app = await getApp(env.DB, run.app_id);
  if (!app) return { ...out, reason: "app not found" };

  const autopilot = await getAutopilotExecute(env.DB, app.user_id);
  if (!autopilot) return { ...out, reason: "autopilot execution is off for this account" };

  // Already attempted (a double trigger, or a run a person is looking at): leave it.
  if ((await listRunExecutions(env.DB, run.id)).length > 0) return { ...out, reason: "already attempted" };

  const stored = credentialsEnabled(env)
    ? await loadStoredAscForApp(
        () => useCredential(env, app.user_id, app.id, "asc"),
        () => useCredential(env, app.user_id, null, "asc"),
      ).catch(() => null)
    : null;

  const gate = autopilotGate({
    flagOn: isFlagOn(env.ASC_WRITE_ENABLED),
    tier: await getTier(env.DB, app.user_id),
    optedIn: await getAscWriteOptIn(env.DB, app.user_id),
    autopilot,
    runStatus: run.status,
    hasStoredKey: stored !== null,
  });
  const record = async (r: ExecutionRecord) => {
    out.records.push(r);
    await recordRunExecution(env.DB, { runId: run.id, ...r });
  };
  if (!gate.allowed) {
    // Autopilot is on and could not act: that is a fact the run page must show.
    await record({ step: "gate", status: "failed", detail: gate.reason });
    return { ...out, reason: gate.reason };
  }
  out.ran = true;

  let token: string;
  let ascAppId: string;
  try {
    token = await mintAscJwt({ p8: stored!.plaintext, keyId: stored!.meta.keyId, issuerId: stored!.meta.issuerId });
    ascAppId = await deps.findAscAppId(deps.fetchFn, token, app.bundle_id);
  } catch (e) {
    await record({ step: "gate", status: "failed", detail: `stored key could not reach App Store Connect: ${reasonOf(e)}` });
    return out;
  }

  const trace = JSON.parse(run.reasoning_json) as ReasoningTrace;
  const plan = planAutopilot(trace, storefrontLocale(app.country));

  let editableVersionId: string | null = null;
  let blocked: string | null = null;

  for (const step of plan) {
    if (blocked && step.step !== "screenshots" && step.step !== "experiment") {
      await record({ step: step.step, status: "skipped", detail: `not attempted: ${blocked}` });
      continue;
    }
    if (step.step === "version") {
      try {
        const state = await deps.readAscVersionState(deps.fetchFn, { token, appId: ascAppId });
        const editable = state.all.find((v) => (EDITABLE_STATES as readonly string[]).includes(v.appStoreState));
        if (editable) {
          editableVersionId = editable.id;
          await record({ step: "version", status: "done", detail: `using ${editable.versionString} (${editable.appStoreState}) ${editable.id}` });
        } else {
          const next = nextVersionString(state.all.map((v) => v.versionString));
          if (!next) throw new AscWriteError("no App Store version has a parseable version string; create one in App Store Connect");
          const created = await deps.createAscVersion(deps.fetchFn, { token, appId: ascAppId, versionString: next });
          editableVersionId = created.id;
          await record({ step: "version", status: "done", detail: `created ${created.versionString} (${created.appStoreState}) ${created.id}` });
        }
      } catch (e) {
        blocked = `version step failed: ${reasonOf(e)}`;
        await record({ step: "version", status: "failed", detail: reasonOf(e) });
      }
      continue;
    }
    if ("copy" in step) {
      const { locale, copy } = step;
      try {
        let result;
        try {
          result = await deps.applyAscMetadata(deps.fetchFn, { token, appId: ascAppId, copy, locale });
        } catch (e) {
          // A locale Apple has no localization for yet: create it once, then push.
          if (step.step !== "metadata" && editableVersionId && e instanceof AscWriteError && /No ".*" localization/.test(e.message)) {
            await deps.createAscLocalization(deps.fetchFn, { token, versionId: editableVersionId, locale });
            result = await deps.applyAscMetadata(deps.fetchFn, { token, appId: ascAppId, copy, locale });
          } else throw e;
        }
        await record({ step: step.step, status: "done", detail: `pushed ${result.fieldsPushed.join(", ") || "nothing"} to ${locale} (localization ${result.localizationId})` });
      } catch (e) {
        await record({ step: step.step, status: "failed", detail: reasonOf(e) });
        if (step.step === "metadata") blocked = `metadata push failed: ${reasonOf(e)}`;
      }
      continue;
    }
    if ("skip" in step) await record({ step: step.step, status: "skipped", detail: step.skip });
  }

  if (shippedFrom(out.records)) out.shipped = await markRunShipped(env.DB, run.id);
  return out;
}

/** The hourly pass: every approved run nobody has attempted yet. */
export async function runAutopilot(env: Env, deps: AutopilotDeps = defaultDeps): Promise<{ attempted: number; shipped: number }> {
  const runs = await listApprovedRunsForAutopilot(env.DB);
  let attempted = 0;
  let shipped = 0;
  for (const run of runs) {
    try {
      const r = await executeApprovedRun(env, run, deps);
      if (r.ran) attempted++;
      if (r.shipped) shipped++;
    } catch (e) {
      console.error(`[store-ops autopilot] run ${run.id}: ${reasonOf(e)}`);
    }
  }
  return { attempted, shipped };
}

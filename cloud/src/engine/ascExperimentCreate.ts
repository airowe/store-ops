/**
 * Create a Product Page Optimization experiment (#374, v2).
 *
 * THIS IS THE FIRST WRITE THAT CHANGES WHAT REAL VISITORS SEE. Every other write
 * in this codebase is pre-review and invisible until the developer submits:
 * metadata lands on a draft version, screenshots land in a draft's set. A PPO
 * experiment splits live App Store traffic.
 *
 * Two rules follow, and both are enforced here rather than left to callers:
 *
 *   1. CREATING IS NOT STARTING. Apple creates an experiment stopped. This
 *      module never sends `started` or `state`, so it cannot start one even by
 *      accident — pressing start stays a deliberate human act in App Store
 *      Connect. A test asserts the request body carries neither field.
 *
 *   2. NEVER WHILE ONE IS LIVE. `ppoTreatment.ts` already refuses to PROPOSE a
 *      test while one is running; creating one obeys the same rule, or the
 *      product would stay quiet about proposals while cheerfully creating a
 *      second experiment.
 *
 * The read side lives in ascExperiments.ts; the caller passes what it read so
 * this stays a pure decision over an injected fetch.
 */
import { ASC_BASE, ascError, type FetchLike } from "./ascWrite.js";

export type CreatePpoExperimentInput = {
  /** Short-lived ASC bearer token. Never persisted or logged. */
  token: string;
  /** The version the experiment hangs off. */
  appStoreVersionId: string;
  name: string;
  /** Share of traffic sent to the treatment, 1–100. */
  trafficProportion: number;
  /**
   * Experiments already read for this app (ascExperiments.ts). Passed in rather
   * than re-read so the "is one live?" decision is made from the SAME data the
   * caller showed the user.
   */
  runningExperiments: Array<{ state?: string | undefined; started?: boolean | undefined }>;
};

export type CreatePpoExperimentResult = {
  ok: true;
  id: string;
  name: string | undefined;
  /** Apple's own flag, quoted. Always false immediately after creation. */
  started: boolean;
  state: string | undefined;
};

/** Is any experiment actually live? Apple's `started` flag is the truth. */
function anyStarted(
  experiments: Array<{ state?: string | undefined; started?: boolean | undefined }>,
): boolean {
  return experiments.some((e) => e.started === true);
}

export async function createPpoExperiment(
  fetchFn: FetchLike,
  input: CreatePpoExperimentInput,
): Promise<CreatePpoExperimentResult> {
  // ── refusals, before Apple is touched ─────────────────────────────────────
  if (anyStarted(input.runningExperiments)) {
    throw new Error(
      "refusing to create a product page experiment: one is already running — let the live test finish before starting another",
    );
  }

  const name = input.name.trim();
  if (!name) throw new Error("the experiment needs a name");

  const proportion = input.trafficProportion;
  if (!Number.isInteger(proportion) || proportion < 1 || proportion > 100) {
    throw new Error(
      `traffic proportion must be a whole percentage between 1 and 100 (got ${proportion})`,
    );
  }

  // ── create, STOPPED ───────────────────────────────────────────────────────
  // `started` and `state` are deliberately absent from the payload. Apple
  // defaults a new experiment to not-started, and sending either would move the
  // decision to begin showing users a different page out of the human's hands.
  const res = await fetchFn(`${ASC_BASE}/appStoreVersionExperimentsV2`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      data: {
        type: "appStoreVersionExperimentsV2",
        attributes: { name, trafficProportion: proportion },
        relationships: {
          appStoreVersion: { data: { type: "appStoreVersions", id: input.appStoreVersionId } },
        },
      },
    }),
  });
  if (!res.ok) throw await ascError(res, "create product page experiment");

  const body = (await res.json().catch(() => ({}))) as {
    data?: { id?: string; attributes?: { name?: string; state?: string; started?: boolean } };
  };
  const id = body.data?.id;
  if (!id) throw new Error("App Store Connect returned no experiment id");

  return {
    ok: true,
    id,
    name: body.data?.attributes?.name,
    // Quoted from Apple, defaulted to false — never asserted as started.
    started: body.data?.attributes?.started === true,
    state: body.data?.attributes?.state,
  };
}

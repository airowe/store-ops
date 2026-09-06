import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Autopilot execution (migration 0017): with the owner's flag on, an approved
 * run's writes happen through the same engine functions the routes use, each
 * step recorded, 'shipped' only after the metadata write returned success.
 * D1, the credential store and the JWT are mocked at their module boundary;
 * every Apple-facing engine call is injected. Nothing reaches Apple.
 */

let autopilot = true;
let optedIn = true;
let tier = "startup";
let priorExecutions: unknown[] = [];
const recorded: { runId: string; step: string; status: string; detail: string }[] = [];
const shippedRuns: string[] = [];
let storedApp: unknown = null;
let storedAccount: unknown = { plaintext: "-----BEGIN-----", meta: { keyId: "K", issuerId: "I" } };

vi.mock("../d1.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getApp: async () => ({ id: "app-1", user_id: "u1", bundle_id: "meme.snagg.app", name: "Snagg", country: "US", created_at: "" }),
    getAutopilotExecute: async () => autopilot,
    getAscWriteOptIn: async () => optedIn,
    getTier: async () => tier,
    listRunExecutions: async () => priorExecutions,
    recordRunExecution: async (_db: unknown, r: { runId: string; step: string; status: string; detail: string }) => {
      recorded.push(r);
    },
    markRunShipped: async (_db: unknown, id: string) => {
      shippedRuns.push(id);
      return true;
    },
    listApprovedRunsForAutopilot: async () => [run()],
  };
});
vi.mock("../credentialStore.js", () => ({
  credentialsEnabled: () => true,
  useCredential: async (_e: unknown, _u: string, appId: string | null) => (appId === null ? storedAccount : storedApp),
}));
vi.mock("../engine/ascJwt.js", () => ({ mintAscJwt: async () => "tok" }));

const { executeApprovedRun, runAutopilot } = await import("./autopilot.js");
type Deps = import("./autopilot.js").AutopilotDeps & Record<string, ReturnType<typeof vi.fn>>;
const { AscWriteError } = await import("../engine/ascWrite.js");

const copy = { name: "Snagg", subtitle: "Meme keyboard", keywords: "meme,keyboard", validation: { pass: true } };
const de = { name: "Snagg", subtitle: "Meme-Tastatur", keywords: "meme", label: "draft" };
function run(status = "approved", trace: Record<string, unknown> = { proposedCopy: copy, localizedCopy: { "de-DE": de } }) {
  return { id: "run-1", app_id: "app-1", status, created_at: "2026-09-06", reasoning_json: JSON.stringify(trace) } as never;
}

const live = { id: "v-live", versionString: "1.0.0", appStoreState: "READY_FOR_SALE" };
const draft = { id: "v-draft", versionString: "1.0.1", appStoreState: "PREPARE_FOR_SUBMISSION" };

function deps(over: Partial<Record<string, unknown>> = {}) {
  return {
    fetchFn: vi.fn() as never,
    findAscAppId: vi.fn(async () => "6757125366"),
    readAscVersionState: vi.fn(async () => ({ current: draft, all: [live, draft] })),
    createAscVersion: vi.fn(async (_f: unknown, o: { versionString: string }) => ({ id: "v-new", versionString: o.versionString, appStoreState: "PREPARE_FOR_SUBMISSION" })),
    applyAscMetadata: vi.fn(async (_f: unknown, o: { locale: string }) => ({ ok: true as const, versionId: "v-draft", localizationId: `loc-${o.locale}`, fieldsPushed: ["subtitle", "keywords"] })),
    createAscLocalization: vi.fn(async (_f: unknown, o: { locale: string }) => ({ id: `loc-${o.locale}`, locale: o.locale })),
    ...over,
  } as unknown as Deps;
}

const env = { DB: {}, ASC_WRITE_ENABLED: "true" } as never;

beforeEach(() => {
  autopilot = true;
  optedIn = true;
  tier = "startup";
  priorExecutions = [];
  recorded.length = 0;
  shippedRuns.length = 0;
  storedApp = null;
  storedAccount = { plaintext: "-----BEGIN-----", meta: { keyId: "K", issuerId: "I" } };
});

describe("executeApprovedRun", () => {
  it("uses the editable version, pushes storefront metadata and each approved locale, records every step, and ships", async () => {
    const d = deps();
    const r = await executeApprovedRun(env, run(), d);
    expect(r.ran).toBe(true);
    expect(recorded.map((x) => `${x.step}:${x.status}`)).toEqual([
      "version:done",
      "metadata:done",
      "locale:de-DE:done",
      "screenshots:skipped",
      "experiment:skipped",
    ]);
    expect(recorded[0]!.detail).toContain("using 1.0.1");
    expect(d.applyAscMetadata).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ locale: "en-US", copy }));
    expect(d.applyAscMetadata).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ locale: "de-DE", copy: de }));
    expect(d.createAscVersion).not.toHaveBeenCalled();
    expect(r.shipped).toBe(true);
    expect(shippedRuns).toEqual(["run-1"]);
  });

  it("creates the next patch version when only a live one exists", async () => {
    const d = deps({ readAscVersionState: vi.fn(async () => ({ current: live, all: [live] })) });
    await executeApprovedRun(env, run(), d);
    expect(d.createAscVersion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ versionString: "1.0.1" }));
    expect(recorded[0]).toMatchObject({ step: "version", status: "done", detail: expect.stringContaining("created 1.0.1") });
  });

  it("creates a missing localization once and pushes into it", async () => {
    let deCalls = 0;
    const d = deps({
      applyAscMetadata: vi.fn(async (_f: unknown, o: { locale: string }) => {
        if (o.locale === "de-DE" && deCalls++ === 0) throw new AscWriteError('No "de-DE" localization on the editable version. Add it in App Store Connect first.');
        return { ok: true as const, versionId: "v-draft", localizationId: `loc-${o.locale}`, fieldsPushed: ["subtitle"] };
      }),
    });
    await executeApprovedRun(env, run(), d);
    expect(d.createAscLocalization).toHaveBeenCalledWith(expect.anything(), { token: "tok", versionId: "v-draft", locale: "de-DE" });
    expect(recorded.find((x) => x.step === "locale:de-DE")).toMatchObject({ status: "done" });
  });

  it("a failed metadata push is recorded, blocks the locales, and does NOT ship", async () => {
    const d = deps({ applyAscMetadata: vi.fn(async () => { throw new AscWriteError("App Store Connect rejected the update (409)"); }) });
    const r = await executeApprovedRun(env, run(), d);
    expect(recorded.map((x) => `${x.step}:${x.status}`)).toEqual([
      "version:done",
      "metadata:failed",
      "locale:de-DE:skipped",
      "screenshots:skipped",
      "experiment:skipped",
    ]);
    expect(recorded[1]!.detail).toContain("409");
    expect(r.shipped).toBe(false);
    expect(shippedRuns).toEqual([]);
  });

  it("a failed version step blocks everything after it", async () => {
    const d = deps({ readAscVersionState: vi.fn(async () => ({ current: live, all: [{ ...live, versionString: "beta" }] })) });
    const r = await executeApprovedRun(env, run(), d);
    expect(recorded[0]).toMatchObject({ step: "version", status: "failed", detail: expect.stringMatching(/parseable/) });
    expect(recorded.find((x) => x.step === "metadata")).toMatchObject({ status: "skipped" });
    expect(d.applyAscMetadata).not.toHaveBeenCalled();
    expect(r.shipped).toBe(false);
  });

  it("does nothing, and records nothing, when autopilot is off for the account", async () => {
    autopilot = false;
    const d = deps();
    const r = await executeApprovedRun(env, run(), d);
    expect(r.ran).toBe(false);
    expect(recorded).toEqual([]);
    expect(d.findAscAppId).not.toHaveBeenCalled();
  });

  it.each([
    ["no opt-in", () => { optedIn = false; }, /opted in/],
    ["free tier", () => { tier = "free"; }, /cannot write/],
    ["no stored key", () => { storedAccount = null; }, /no stored/],
  ])("with autopilot on but %s, records one failed gate row and touches nothing", async (_l, arrange, re) => {
    arrange();
    const d = deps();
    const r = await executeApprovedRun(env, run(), d);
    expect(r.ran).toBe(false);
    expect(recorded).toEqual([{ runId: "run-1", step: "gate", status: "failed", detail: expect.stringMatching(re) }]);
    expect(d.findAscAppId).not.toHaveBeenCalled();
  });

  it("never runs on a run that is not approved, and never twice", async () => {
    const d = deps();
    expect((await executeApprovedRun(env, run("awaiting_approval"), d)).ran).toBe(false);
    expect(recorded.at(-1)).toMatchObject({ step: "gate", status: "failed", detail: expect.stringMatching(/not approved/) });
    recorded.length = 0;
    priorExecutions = [{ step: "metadata" }];
    expect((await executeApprovedRun(env, run(), d))).toMatchObject({ ran: false, reason: "already attempted" });
    expect(recorded).toEqual([]);
    expect(d.applyAscMetadata).not.toHaveBeenCalled();
  });

  it("prefers the app's own stored key over the account key", async () => {
    storedApp = { plaintext: "-----APP-----", meta: { keyId: "APPK", issuerId: "I" } };
    const d = deps();
    await executeApprovedRun(env, run(), d);
    expect(recorded.find((x) => x.step === "metadata")).toMatchObject({ status: "done" });
  });
});

describe("runAutopilot", () => {
  it("attempts each approved untouched run and counts what shipped", async () => {
    const r = await runAutopilot(env, deps());
    expect(r).toEqual({ attempted: 1, shipped: 1 });
  });
});

/**
 * #374: create a Product Page Optimization experiment (v2).
 *
 * This is the FIRST write in the codebase that changes what real App Store
 * visitors see. Everything before it — metadata, screenshots into a draft — is
 * pre-review and invisible until the developer submits. A PPO experiment splits
 * live traffic.
 *
 * So the tests here are mostly refusals, and the central one is that creating an
 * experiment must NEVER start it. Apple's create is stopped-by-default; the code
 * must not opt into starting, and must not be changeable to without a test going
 * red.
 */
import { describe, expect, it, vi } from "vitest";
import { createPpoExperiment } from "./ascExperimentCreate.js";

const ok = (body: unknown) =>
  ({ ok: true, status: 201, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

const fail = (status: number, detail: string) =>
  ({
    ok: false,
    status,
    json: async () => ({ errors: [{ detail }] }),
    text: async () => JSON.stringify({ errors: [{ detail }] }),
  }) as unknown as Response;

const created = ok({
  data: { id: "exp-1", attributes: { name: "Outcome-led shots", state: "PREPARE_FOR_SUBMISSION", started: false } },
});

const base = {
  token: "t",
  appId: "6757125366",
  platform: "IOS" as const,
  name: "Outcome-led shots",
  trafficProportion: 50,
  runningExperiments: [] as Array<{ state?: string | undefined; started?: boolean | undefined }>,
};

describe("createPpoExperiment", () => {
  it("creates the experiment on the v2 resource, against the app and platform, and returns Apple's ids verbatim", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return created;
    });

    const res = await createPpoExperiment(fetchFn as never, base);
    expect(res).toMatchObject({ ok: true, id: "exp-1", started: false });

    const body = JSON.parse(String(calls[0]!.init?.body));
    // /v1/appStoreVersionExperimentsV2 is what Apple 404'd live on 2026-09-06
    expect(calls[0]!.url).toBe("https://api.appstoreconnect.apple.com/v2/appStoreVersionExperiments");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(body.data.type).toBe("appStoreVersionExperiments");
    expect(body.data.attributes.name).toBe("Outcome-led shots");
    expect(body.data.attributes.platform).toBe("IOS");
    expect(body.data.attributes.trafficProportion).toBe(50);
    expect(body.data.relationships).toEqual({ app: { data: { type: "apps", id: "6757125366" } } });
  });

  /**
   * THE critical assertion. Apple creates an experiment stopped; the moment we
   * send anything that starts it, ShipASO decides what live users see. Starting
   * traffic stays a deliberate human act in App Store Connect.
   */
  it("NEVER sends a field that would start the experiment", async () => {
    const calls: Array<{ init: RequestInit | undefined }> = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ init });
      return created;
    });
    await createPpoExperiment(fetchFn as never, base);

    const raw = String(calls[0]!.init?.body);
    const attrs = JSON.parse(raw).data.attributes as Record<string, unknown>;
    expect(attrs).not.toHaveProperty("started");
    expect(attrs).not.toHaveProperty("state");
    expect(raw).not.toMatch(/"started"\s*:\s*true/);
  });

  it("reports the created experiment as not started", async () => {
    const fetchFn = vi.fn(async () => created);
    const res = await createPpoExperiment(fetchFn as never, base);
    expect(res.ok && res.started).toBe(false);
  });

  /**
   * Inherited from ppoTreatment.ts, which already refuses to PROPOSE while a
   * test is live. Creating one must obey the same rule or the product proposes
   * nothing while happily creating a second experiment.
   */
  it("refuses when an experiment is already running, without calling Apple", async () => {
    const fetchFn = vi.fn();
    await expect(
      createPpoExperiment(fetchFn as never, {
        ...base,
        runningExperiments: [{ state: "ACCEPTED", started: true }],
      }),
    ).rejects.toThrow(/already running|live test/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("allows creation when prior experiments exist but none are started", async () => {
    const fetchFn = vi.fn(async () => created);
    const res = await createPpoExperiment(fetchFn as never, {
      ...base,
      runningExperiments: [{ state: "COMPLETED", started: false }, { state: "STOPPED", started: false }],
    });
    expect(res.ok).toBe(true);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["over 100", 101],
    ["fractional beyond Apple's grid", 12.5],
  ])("rejects %s traffic proportion before calling Apple", async (_label, proportion) => {
    const fetchFn = vi.fn();
    await expect(
      createPpoExperiment(fetchFn as never, { ...base, trafficProportion: proportion }),
    ).rejects.toThrow(/traffic/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    const fetchFn = vi.fn();
    await expect(createPpoExperiment(fetchFn as never, { ...base, name: "  " })).rejects.toThrow(
      /name/i,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("surfaces Apple's error rather than inventing success", async () => {
    const fetchFn = vi.fn(async () => fail(409, "an experiment already exists for this version"));
    await expect(createPpoExperiment(fetchFn as never, base)).rejects.toThrow(
      /create product page experiment|already exists/i,
    );
  });
});

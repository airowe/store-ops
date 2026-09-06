import { describe, expect, it, vi } from "vitest";
import { alreadyPresent, preflightShots, uploadScreenshotBatch, type BatchDeps, type BatchShot } from "./ascScreenshotBatch.js";
import { md5Hex } from "./ascUpload.js";

/**
 * #374 — the strip-level lane an agent can call with only what it has: a
 * bundle id, a locale, a device bucket, and files. Egress is a scripted fetch;
 * the three collaborators are injected. Nothing reaches Apple.
 */

const bytes = (s: string) => new TextEncoder().encode(s);
const shot = (fileName: string, body = fileName): BatchShot => ({ fileName, file: bytes(body) });

type Route = { match: RegExp; body?: unknown; status?: number };
function scriptedFetch(routes: Route[]) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    const r = routes.find((x) => x.match.test(u));
    if (!r) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  return { fetchFn, calls };
}

const versions = { data: [
  { id: "v-live", attributes: { appStoreState: "READY_FOR_SALE", versionString: "1.0.0" } },
  { id: "v-edit", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION", versionString: "1.0.1" } },
] };
const locs = { data: [{ id: "loc-de", attributes: { locale: "de-DE" } }, { id: "loc-en", attributes: { locale: "en-US" } }] };

function deps(over: Partial<BatchDeps> = {}): BatchDeps {
  return {
    findAscAppId: vi.fn(async () => "6757125366"),
    ensureScreenshotSet: vi.fn(async () => ({ id: "set-1", created: false })),
    uploadScreenshot: vi.fn(async (_f, i) => ({ ok: true as const, id: `id-${i.fileName}`, fileName: i.fileName, bytes: i.file.length, checksum: md5Hex(i.file), parts: 1 })),
    ...over,
  };
}

const base = { token: "t", bundleId: "meme.snagg.app", locale: "en-US", displayType: "APP_IPHONE_67" };

describe("preflightShots — every refusal before a single request", () => {
  it("names placeholders, empties, duplicates and an empty strip", () => {
    const p = preflightShots([shot("01_home.png"), shot("02_needsReview.png"), { fileName: "03.png", file: new Uint8Array() }, shot("01_HOME.png")]);
    expect(p).toEqual([
      '"02_needsReview.png" is a renderer placeholder (needsReview), not a real captured screen',
      '"03.png" is empty',
      '"01_HOME.png" appears twice',
    ]);
    expect(preflightShots([])).toEqual(["no shots given"]);
  });
  it("passes a clean strip", () => {
    expect(preflightShots([shot("01.png"), shot("02.png")])).toEqual([]);
  });
});

describe("alreadyPresent — same name and same bytes is a no-op, anything else is not", () => {
  const existing = [{ id: "x", fileName: "01.png", checksum: md5Hex(bytes("01.png")) }];
  it("matches on name (case-insensitive) and checksum", () => {
    expect(alreadyPresent(existing, shot("01.PNG", "01.png"))?.id).toBe("x");
  });
  it("a same-named file with different bytes is NOT present — it must be uploaded", () => {
    expect(alreadyPresent(existing, shot("01.png", "different"))).toBeUndefined();
  });
});

describe("uploadScreenshotBatch", () => {
  it("resolves app → editable version → locale → set, lists the set, uploads in order, reports every id", async () => {
    const { fetchFn, calls } = scriptedFetch([
      { match: /appStoreVersions\?/, body: versions },
      { match: /appStoreVersionLocalizations\?/, body: locs },
      { match: /appScreenshots\?/, body: { data: [] } },
    ]);
    const d = deps();
    const r = await uploadScreenshotBatch(fetchFn as never, { ...base, shots: [shot("01.png"), shot("02.png")] }, d);
    expect(r.ok).toBe(true);
    expect(r.version).toEqual({ id: "v-edit", versionString: "1.0.1", state: "PREPARE_FOR_SUBMISSION" });
    expect(r.localizationId).toBe("loc-en");
    expect(r.screenshotSetId).toBe("set-1");
    expect(r.uploaded.map((u) => u.fileName)).toEqual(["01.png", "02.png"]);
    expect(r.uploaded[0]).toMatchObject({ id: "id-01.png", parts: 1 });
    expect(r.skipped).toEqual([]);
    expect(r.remaining).toEqual([]);
    expect(d.ensureScreenshotSet).toHaveBeenCalledWith(expect.anything(), { token: "t", localizationId: "loc-en", displayType: "APP_IPHONE_67" });
    // the live version was never addressed
    expect(calls.some((c) => c.includes("v-live"))).toBe(false);
    expect(calls.filter((c) => c.startsWith("GET")).length).toBe(3);
  });

  it("skips a shot already in the set with the same bytes, and still uploads the rest — a retry is idempotent", async () => {
    const { fetchFn } = scriptedFetch([
      { match: /appStoreVersions\?/, body: versions },
      { match: /appStoreVersionLocalizations\?/, body: locs },
      { match: /appScreenshots\?/, body: { data: [{ id: "old", attributes: { fileName: "01.png", sourceFileChecksum: md5Hex(bytes("01.png")) } }] } },
    ]);
    const d = deps();
    const r = await uploadScreenshotBatch(fetchFn as never, { ...base, shots: [shot("01.png"), shot("02.png")] }, d);
    expect(r.skipped).toEqual([{ fileName: "01.png", id: "old", reason: "already present" }]);
    expect(r.uploaded.map((u) => u.fileName)).toEqual(["02.png"]);
    expect(d.uploadScreenshot).toHaveBeenCalledTimes(1);
  });

  it("stops at the first failure and says which landed, which failed, and which never started", async () => {
    const { fetchFn } = scriptedFetch([
      { match: /appStoreVersions\?/, body: versions },
      { match: /appStoreVersionLocalizations\?/, body: locs },
      { match: /appScreenshots\?/, body: { data: [] } },
    ]);
    const d = deps({
      uploadScreenshot: vi.fn(async (_f, i) => {
        if (i.fileName === "02.png") throw new Error("upload part 1 of 1: 500");
        return { ok: true as const, id: `id-${i.fileName}`, fileName: i.fileName, bytes: 1, checksum: "c", parts: 1 };
      }),
    });
    const r = await uploadScreenshotBatch(fetchFn as never, { ...base, shots: [shot("01.png"), shot("02.png"), shot("03.png")] }, d);
    expect(r.ok).toBe(false);
    expect(r.uploaded.map((u) => u.fileName)).toEqual(["01.png"]);
    expect(r.failed).toEqual({ fileName: "02.png", reason: "upload part 1 of 1: 500" });
    expect(r.remaining).toEqual(["03.png"]);
    expect(d.uploadScreenshot).toHaveBeenCalledTimes(2);
  });

  it("refuses the whole strip before any request when a shot is a placeholder", async () => {
    const { fetchFn } = scriptedFetch([]);
    const d = deps();
    await expect(uploadScreenshotBatch(fetchFn as never, { ...base, shots: [shot("01.png"), shot("02_placeholder.png")] }, d)).rejects.toThrow(/placeholder/);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(d.findAscAppId).not.toHaveBeenCalled();
  });

  it("throws, touching nothing, when there is no editable version or no such locale", async () => {
    const onlyLive = { data: [versions.data[0]] };
    const a = scriptedFetch([{ match: /appStoreVersions\?/, body: onlyLive }]);
    const d1 = deps();
    await expect(uploadScreenshotBatch(a.fetchFn as never, { ...base, shots: [shot("01.png")] }, d1)).rejects.toThrow(/No editable App Store version/);
    expect(d1.ensureScreenshotSet).not.toHaveBeenCalled();

    const b = scriptedFetch([{ match: /appStoreVersions\?/, body: versions }, { match: /appStoreVersionLocalizations\?/, body: locs }]);
    const d2 = deps();
    await expect(uploadScreenshotBatch(b.fetchFn as never, { ...base, locale: "fr-FR", shots: [shot("01.png")] }, d2)).rejects.toThrow(/fr-FR/);
    expect(d2.ensureScreenshotSet).not.toHaveBeenCalled();
  });

  it("a set listing that fails aborts rather than guessing what is already there", async () => {
    const { fetchFn } = scriptedFetch([
      { match: /appStoreVersions\?/, body: versions },
      { match: /appStoreVersionLocalizations\?/, body: locs },
      { match: /appScreenshots\?/, status: 500, body: { errors: [{ detail: "boom" }] } },
    ]);
    const d = deps();
    await expect(uploadScreenshotBatch(fetchFn as never, { ...base, shots: [shot("01.png")] }, d)).rejects.toThrow(/list screenshots in the set/);
    expect(d.uploadScreenshot).not.toHaveBeenCalled();
  });
});

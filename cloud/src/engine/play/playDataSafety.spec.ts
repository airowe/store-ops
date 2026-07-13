/**
 * Play data-safety — content-based parse + honest findings. Invariants:
 *   • known category labels + "No data" markers + the policy URL are read by
 *     CONTENT (drift-tolerant), every field a tri-state (null = UNKNOWN),
 *   • the only WARN is a POSITIVELY-OBSERVED gap (declares collection + no policy),
 *   • an unreadable page → all-UNKNOWN → no findings (never a false "empty").
 */
import { describe, expect, it, vi } from "vitest";
import { extractAfBlobs, parsePlayDataSafety } from "./playDataSafetyParse.js";
import { playDataSafetyFindings, readPlayDataSafety } from "./playDataSafety.js";
import type { FetchFn } from "../itunes.js";

/** A datasafety-page-ish HTML: one AF_initDataCallback blob with the given leaves. */
function page(leaves: unknown): string {
  const data = JSON.stringify(leaves);
  return `<html><script>AF_initDataCallback({key: 'ds:3', hash: '1', data:${data}, sideChannel: {}});</script></html>`;
}

describe("extractAfBlobs", () => {
  it("pulls the data: payload out of an AF_initDataCallback blob", () => {
    expect(extractAfBlobs(page([["x", ["Location"]]]))).toEqual([[["x", ["Location"]]]]);
  });
  it("skips malformed blobs, returns [] when none", () => {
    expect(extractAfBlobs("<html>no blobs</html>")).toEqual([]);
  });
});

describe("parsePlayDataSafety — content-based, honest tri-state", () => {
  it("reads declared categories + external privacy-policy URL", () => {
    const html = page([
      ["App activity"],
      ["Device or other IDs"],
      ["https://example.com/privacy"],
      ["https://play.google.com/ignored"],
    ]);
    const ds = parsePlayDataSafety(html, "com.x.y");
    expect(ds.declaresCollection).toBe(true);
    expect(ds.dataTypes).toEqual(["App activity", "Device or other IDs"]);
    expect(ds.privacyPolicyUrl).toBe("https://example.com/privacy");
    expect(ds.reliable).toBe(false);
  });

  it("reads the explicit 'No data collected/shared' markers as a FALSE declaration", () => {
    const ds = parsePlayDataSafety(page([["No data collected"], ["No data shared"]]), "com.x.y");
    expect(ds.declaresCollection).toBe(false);
    expect(ds.declaresSharing).toBe(false);
    expect(ds.dataTypes).toEqual([]);
  });

  it("an unparseable page → all UNKNOWN (null), never fabricated", () => {
    const ds = parsePlayDataSafety("<html>garbage</html>", "com.x.y");
    expect(ds.declaresCollection).toBeNull();
    expect(ds.privacyPolicyUrl).toBeNull();
    expect(ds.dataTypes).toEqual([]);
  });
});

describe("playDataSafetyFindings", () => {
  const base = { packageName: "com.x.y", reliable: false as const, declaresSharing: null };

  it("flags declared collection with NO linked policy (a positive gap, cited)", () => {
    const f = playDataSafetyFindings({
      ...base,
      declaresCollection: true,
      dataTypes: ["Location"],
      privacyPolicyUrl: null,
    });
    const gap = f.find((x) => x.id === "play_data_safety_no_policy")!;
    expect(gap.severity).toBe("warn");
    expect(gap.impact).toBe("trust");
    expect(gap.evidence).toContain("support.google.com");
  });

  it("no gap flag when a policy IS linked; still a context summary", () => {
    const f = playDataSafetyFindings({
      ...base,
      declaresCollection: true,
      dataTypes: ["Location"],
      privacyPolicyUrl: "https://example.com/privacy",
    });
    expect(f.find((x) => x.id === "play_data_safety_no_policy")).toBeUndefined();
    const ctx = f.find((x) => x.id === "play_data_safety_summary")!;
    expect(ctx.context).toBe(true);
    expect(ctx.title).toMatch(/Location/);
  });

  it("an all-UNKNOWN read contributes nothing (no false 'empty')", () => {
    expect(
      playDataSafetyFindings({ ...base, declaresCollection: null, dataTypes: [], privacyPolicyUrl: null }),
    ).toEqual([]);
  });
});

describe("readPlayDataSafety — degrade-safe", () => {
  it("parses a good page", async () => {
    const ok: FetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => page([["Location"], ["https://example.com/privacy"]]),
    }));
    const ds = await readPlayDataSafety(ok, "com.x.y");
    expect(ds.dataTypes).toEqual(["Location"]);
    expect(ds.privacyPolicyUrl).toBe("https://example.com/privacy");
  });

  it("a failing fetch → all-UNKNOWN, never throws", async () => {
    // 404 is non-retryable (unlike 429), so fetchText throws at once → degrade path.
    const bad: FetchFn = vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: async () => "",
    }));
    const ds = await readPlayDataSafety(bad, "com.x.y");
    expect(ds.declaresCollection).toBeNull();
    expect(playDataSafetyFindings(ds)).toEqual([]);
  });
});

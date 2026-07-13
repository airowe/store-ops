/**
 * Play data-safety WRITE — validation + push. Invariants:
 *   • SHAPE-only validation (we don't judge the declaration's content),
 *   • a malformed CSV throws BEFORE any network call (nothing is sent),
 *   • a non-2xx status throws key-free,
 *   • the body is exactly the SafetyLabelsUpdateRequest wrapping the CSV verbatim.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildSafetyLabelsRequest,
  validateSafetyLabelsCsv,
  writeDataSafetyLabels,
  type PlayWriteTransport,
} from "./playDataSafetyWrite.js";

const goodCsv = "data_type,collected,shared,optional\nLocation,true,false,false";

describe("validateSafetyLabelsCsv — shape only", () => {
  it("accepts a header + data row", () => {
    expect(validateSafetyLabelsCsv(goodCsv)).toEqual({ ok: true });
  });
  it("rejects empty / header-only / non-comma", () => {
    expect(validateSafetyLabelsCsv("").ok).toBe(false);
    expect(validateSafetyLabelsCsv("   ").ok).toBe(false);
    expect(validateSafetyLabelsCsv("just a header,row").ok).toBe(false); // one line only
    expect(validateSafetyLabelsCsv("noCommas\nnoCommasEither").ok).toBe(false);
  });
  it("rejects an implausibly large blob", () => {
    expect(validateSafetyLabelsCsv("a,b\n" + "x".repeat(200_001)).ok).toBe(false);
  });
});

describe("buildSafetyLabelsRequest", () => {
  it("wraps the CSV verbatim (we never rewrite the declaration)", () => {
    expect(buildSafetyLabelsRequest(goodCsv)).toEqual({ safetyLabels: goodCsv });
  });
});

describe("writeDataSafetyLabels", () => {
  it("validates BEFORE any network call — a bad CSV never sends", async () => {
    const transport = vi.fn() as unknown as PlayWriteTransport;
    await expect(writeDataSafetyLabels(transport, "com.x.y", "")).rejects.toThrow(/empty/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it("POSTs the SafetyLabelsUpdateRequest to the app's dataSafety endpoint", async () => {
    const transport: PlayWriteTransport = vi.fn(async ({ url, body }) => {
      expect(url).toMatch(/\/applications\/com\.x\.y\/dataSafety$/);
      expect(JSON.parse(body)).toEqual({ safetyLabels: goodCsv });
      return { status: 200, body: "{}" };
    });
    const res = await writeDataSafetyLabels(transport, "com.x.y", goodCsv);
    expect(res).toEqual({ packageName: "com.x.y", pushed: true });
  });

  it("a non-2xx status throws key-free", async () => {
    const transport: PlayWriteTransport = vi.fn(async () => ({ status: 403, body: "" }));
    await expect(writeDataSafetyLabels(transport, "com.x.y", goodCsv)).rejects.toThrow(/HTTP 403/);
  });

  it("requires a package name", async () => {
    const transport = vi.fn() as unknown as PlayWriteTransport;
    await expect(writeDataSafetyLabels(transport, "  ", goodCsv)).rejects.toThrow(/packageName/);
    expect(transport).not.toHaveBeenCalled();
  });
});

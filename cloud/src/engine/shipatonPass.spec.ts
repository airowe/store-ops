import { describe, expect, it } from "vitest";
import { SHIPATON_PASS, evaluateShipatonClaim, isShipatonPass } from "./shipatonPass.js";

const CODE = "SHIPATON26";
const during = new Date("2026-09-20T12:00:00Z");
const base = { code: CODE, expectedCode: CODE, currentTier: "free" as const, now: during };

describe("evaluateShipatonClaim", () => {
  it("grants Startup until the pass end for a free account with the right code", () => {
    const v = evaluateShipatonClaim(base);
    expect(v).toEqual({ ok: true, tier: "startup", until: SHIPATON_PASS.validUntil, status: SHIPATON_PASS.status });
  });

  it("normalizes the code: case, spaces, dashes", () => {
    expect(evaluateShipatonClaim({ ...base, code: " shipaton-26 " }).ok).toBe(true);
  });

  it("is a 400 for a code that is not the pass", () => {
    const v = evaluateShipatonClaim({ ...base, code: "FOUNDERS" });
    expect(v).toMatchObject({ ok: false, status: 400 });
  });

  it("is a 400 for an empty code", () => {
    expect(evaluateShipatonClaim({ ...base, code: "" })).toMatchObject({ ok: false, status: 400 });
    expect(evaluateShipatonClaim({ ...base, code: undefined })).toMatchObject({ ok: false, status: 400 });
  });

  it("is a 503 when the deploy has no code configured, even with a plausible code", () => {
    expect(evaluateShipatonClaim({ ...base, expectedCode: undefined })).toMatchObject({ ok: false, status: 503 });
    expect(evaluateShipatonClaim({ ...base, expectedCode: "  " })).toMatchObject({ ok: false, status: 503 });
  });

  it("is a 410 after the claim window closes, with the closing date in the reason", () => {
    const v = evaluateShipatonClaim({ ...base, now: new Date("2026-10-14T00:00:01Z") });
    expect(v).toMatchObject({ ok: false, status: 410 });
    expect((v as { reason: string }).reason).toContain("2026-10-13");
  });

  it("still claims on the last minute of the window", () => {
    expect(evaluateShipatonClaim({ ...base, now: new Date("2026-10-13T23:59:00Z") }).ok).toBe(true);
  });

  it("is a 409 when the account is already on Startup or above — never a demotion", () => {
    expect(evaluateShipatonClaim({ ...base, currentTier: "startup" })).toMatchObject({ ok: false, status: 409 });
    expect(evaluateShipatonClaim({ ...base, currentTier: "scale" })).toMatchObject({ ok: false, status: 409 });
  });

  it("upgrades an Indie account", () => {
    expect(evaluateShipatonClaim({ ...base, currentTier: "indie" }).ok).toBe(true);
  });

  it("checks the window before the code, so a late wrong code hears 'closed'", () => {
    const v = evaluateShipatonClaim({ ...base, code: "WRONG", now: new Date("2026-11-01T00:00:00Z") });
    expect(v).toMatchObject({ ok: false, status: 410 });
  });
});

describe("isShipatonPass", () => {
  it("recognizes only the pass status", () => {
    expect(isShipatonPass(SHIPATON_PASS.status)).toBe(true);
    expect(isShipatonPass("comped")).toBe(false);
    expect(isShipatonPass("active")).toBe(false);
    expect(isShipatonPass(null)).toBe(false);
  });
});

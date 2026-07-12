import { describe, expect, it } from "vitest";
import { screenshotClaimFindings } from "./screenshotCompliance.js";

const ids = (caption: string | null | undefined) => screenshotClaimFindings(caption).map((f) => f.id);

describe("screenshotClaimFindings", () => {
  it("no caption → [] (OCR off / unreadable stays silent)", () => {
    expect(screenshotClaimFindings(null)).toEqual([]);
    expect(screenshotClaimFindings(undefined)).toEqual([]);
    expect(screenshotClaimFindings("   ")).toEqual([]);
  });

  it("clean caption text → [] (no fabricated risk)", () => {
    expect(screenshotClaimFindings("Ship apps faster")).toEqual([]);
  });

  it("flags an unverifiable #1 / best claim baked into the screenshot", () => {
    expect(ids("The #1 weather app")).toContain("screenshot_claim_unverifiable");
    expect(ids("World's best forecast")).toContain("screenshot_claim_unverifiable");
  });

  it("flags price/promo wording in the screenshot art", () => {
    expect(ids("50% off this week")).toContain("screenshot_claim_price");
    expect(ids("Free forever")).toContain("screenshot_claim_price");
  });

  it("quotes the caption verbatim and cites the guideline verbatim (2.3.7)", () => {
    const f = screenshotClaimFindings("The #1 tracker").find((x) => x.id === "screenshot_claim_unverifiable")!;
    expect(f.surface).toBe("screenshots");
    expect(f.severity).toBe("warn");
    expect(f.impact).toBe("trust");
    expect(f.detail).toContain("The #1 tracker"); // measured caption, quoted
    expect(f.evidence).toContain("App Review Guideline 2.3.7");
    expect(f.evidence).toContain("unverifiable product claims"); // verbatim quote
    expect(f.detail).toMatch(/not Apple's verdict/i);
  });

  it("can flag both a claim and a price in one caption", () => {
    expect(ids("The #1 app, now 50% off")).toEqual(
      expect.arrayContaining(["screenshot_claim_unverifiable", "screenshot_claim_price"]),
    );
  });
});

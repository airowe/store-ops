import { describe, expect, it } from "vitest";
import { analyzeRejection, parseGuidelines } from "./rejectionAssistant.js";

describe("parseGuidelines", () => {
  it("parses Apple's 'Guideline X.Y.Z' references, de-duped, in order", () => {
    const text = "Your app was rejected under Guideline 2.3.7 and also Guideline 5.1.1. See Guideline 2.3.7 again.";
    expect(parseGuidelines(text)).toEqual(["2.3.7", "5.1.1"]);
  });

  it("returns [] when no guideline is cited", () => {
    expect(parseGuidelines("We found an issue with your app.")).toEqual([]);
    expect(parseGuidelines("")).toEqual([]);
  });
});

describe("analyzeRejection", () => {
  it("identifies the primary guideline and quotes it VERBATIM from the corpus", () => {
    const a = analyzeRejection("Rejected: Guideline 2.3.7 — metadata issue.");
    expect(a.primaryGuideline).toBe("2.3.7");
    // a real, verbatim 2.3.7 sentence from the corpus (the first 2.3.7 cite)
    expect(a.quote).toContain("Metadata such as app names, subtitles, screenshots, and previews should not include prices");
  });

  it("recommends fix-and-resubmit for a metadata (2.3.x) rejection, labelled a heuristic", () => {
    const a = analyzeRejection("Guideline 2.3.7");
    expect(a.recommended).toBe("fix_and_resubmit");
    expect(a.rationale).toMatch(/metadata/i);
    expect(a.rationale).toMatch(/heuristic|not a verdict|your call/i);
  });

  it("stays 'unclear' for a non-metadata guideline (doesn't over-steer)", () => {
    const a = analyzeRejection("Guideline 4.3 — spam.");
    expect(a.recommended).toBe("unclear");
    expect(a.primaryGuideline).toBe("4.3");
  });

  it("returns null quote (never a paraphrase) for a guideline not in our corpus", () => {
    const a = analyzeRejection("Guideline 5.1.1 — data collection.");
    expect(a.primaryGuideline).toBe("5.1.1");
    expect(a.quote).toBeNull();
  });

  it("gives an honest 'paste the full message' rationale when no guideline is found", () => {
    const a = analyzeRejection("They rejected my app :(");
    expect(a.primaryGuideline).toBeNull();
    expect(a.recommended).toBe("unclear");
    expect(a.rationale).toMatch(/paste the full/i);
  });

  it("always scaffolds BOTH replies with the guideline filled in and bracketed placeholders", () => {
    const a = analyzeRejection("Guideline 2.3.7");
    expect(a.drafts.fix_and_resubmit).toContain("Guideline 2.3.7");
    expect(a.drafts.appeal).toContain("Guideline 2.3.7");
    // placeholders the developer completes — we never fabricate claims
    expect(a.drafts.fix_and_resubmit).toContain("[");
    expect(a.drafts.appeal).toContain("[");
  });
});

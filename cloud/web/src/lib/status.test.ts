import { describe, it, expect } from "vitest";
import { runStatusLabel } from "./status.js";

describe("runStatusLabel", () => {
  it("approved reveals commands — not shipped", () => {
    expect(runStatusLabel("approved")).toBe("Approved · ready to push");
  });
  it("legacy 'shipped' still reads honestly (no confirmed push)", () => {
    expect(runStatusLabel("shipped")).toBe("Approved · ready to push");
    expect(runStatusLabel("shipped")).not.toMatch(/^Shipped$/);
  });
  it("falls back to the raw status", () => {
    expect(runStatusLabel("weird")).toBe("weird");
  });
});

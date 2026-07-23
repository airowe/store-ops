import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readIssuerId, writeIssuerId } from "./issuerIdMemory.js";

describe("issuerIdMemory", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips a written Issuer ID", () => {
    writeIssuerId("69a6b21c-0000");
    expect(readIssuerId()).toBe("69a6b21c-0000");
  });

  it("returns empty string when nothing is stored", () => {
    expect(readIssuerId()).toBe("");
  });

  it("swallows a throwing localStorage on read and returns empty", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readIssuerId()).toBe("");
  });

  it("swallows a throwing localStorage on write (no throw)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeIssuerId("x")).not.toThrow();
  });
});

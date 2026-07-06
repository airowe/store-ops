import { describe, it, expect } from "vitest";
import { envPill } from "./envPill.js";

describe("envPill", () => {
  it("live when an API base is configured, host without scheme", () => {
    const p = envPill("https://api.shipaso.com");
    expect(p.kind).toBe("live");
    expect(p.label).toBe("live · api.shipaso.com");
  });
  it("demo when no API base — never claims live", () => {
    for (const v of [null, undefined, ""]) {
      const p = envPill(v);
      expect(p.kind).toBe("demo");
      expect(p.label).toBe("demo backend");
    }
  });
});

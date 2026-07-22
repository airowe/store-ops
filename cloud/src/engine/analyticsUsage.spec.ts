import { describe, expect, it } from "vitest";
import { parseUsageRows } from "./analyticsUsage.js";

describe("parseUsageRows", () => {
  it("parses the VERIFIED App Crashes header row", () => {
    // The one report Apple documents with a real header row.
    const text =
      "Date\tApp Name\tApp Apple Identifier\tApp Version\tDevice\tPlatform Version\tCrashes\tUnique Devices\n" +
      "2026-07-01\tShipASO\t6446\t3.1.0\tiPhone\tiOS 18.0\t4\t3";
    expect(parseUsageRows(text)).toEqual([
      { date: "2026-07-01", appVersion: "3.1.0", device: "iPhone", crashes: 4, uniqueDevices: 3 },
    ]);
  });

  it("omits session metrics absent from the header", () => {
    const text = "date,device\n2026-07-02,iPad";
    const row = parseUsageRows(text)[0]!;
    expect(row).toEqual({ date: "2026-07-02", device: "iPad" });
    expect("sessions" in row).toBe(false);
  });
});

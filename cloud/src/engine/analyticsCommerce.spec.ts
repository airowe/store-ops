import { describe, expect, it } from "vitest";
import { parseCommerceRows } from "./analyticsCommerce.js";

describe("parseCommerceRows", () => {
  it("maps the best-effort commerce columns and omits absent metrics", () => {
    const text = "Date\tContent Name\tSales\tProceeds\n2026-07-01\tPro\t100\t70";
    expect(parseCommerceRows(text)).toEqual([
      { date: "2026-07-01", contentName: "Pro", sales: 100, proceeds: 70 },
    ]);
  });

  it("never fabricates a metric absent from the header", () => {
    const text = "date,content name\n2026-07-02,Basic";
    const row = parseCommerceRows(text)[0]!;
    expect(row).toEqual({ date: "2026-07-02", contentName: "Basic" });
    expect("proceeds" in row).toBe(false);
    expect("sales" in row).toBe(false);
  });
});

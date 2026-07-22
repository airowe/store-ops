import { describe, expect, it } from "vitest";
import { parseReportRows } from "./analyticsReportIngest.js";

const MAP = { date: "date", "content name": "contentName", proceeds: "proceeds", sales: "sales" };
const METRICS = new Set(["proceeds", "sales"]);

describe("parseReportRows", () => {
  it("parses a TSV, mapping known headers case/space-insensitively", () => {
    const text = "Date\tContent Name\tProceeds\n2026-07-01\tPro Plan\t12.50";
    const { rows, header } = parseReportRows(text, MAP, METRICS);
    expect(header).toBe("Date\tContent Name\tProceeds");
    expect(rows).toEqual([{ date: "2026-07-01", contentName: "Pro Plan", proceeds: 12.5 }]);
  });

  it("infers comma delimiter and ignores unknown columns", () => {
    const text = "date,unknown col,sales\n2026-07-02,junk,7";
    const { rows } = parseReportRows(text, MAP, METRICS);
    expect(rows).toEqual([{ date: "2026-07-02", sales: 7 }]);
  });

  it("OMITS an absent metric — never a fabricated 0", () => {
    const text = "date,content name\n2026-07-03,Basic";
    const { rows } = parseReportRows(text, MAP, METRICS);
    expect(rows[0]).toEqual({ date: "2026-07-03", contentName: "Basic" });
    expect("proceeds" in rows[0]!).toBe(false);
  });

  it("drops a row with no date and returns [] for header-only/empty", () => {
    expect(parseReportRows("date,sales\n,5", MAP, METRICS).rows).toEqual([]);
    expect(parseReportRows("date,sales", MAP, METRICS).rows).toEqual([]);
    expect(parseReportRows("", MAP, METRICS).rows).toEqual([]);
  });

  it("coerces a non-numeric metric cell to omitted, not NaN", () => {
    const text = "date,sales\n2026-07-04,n/a";
    const { rows } = parseReportRows(text, MAP, METRICS);
    expect(rows[0]).toEqual({ date: "2026-07-04" });
  });
});

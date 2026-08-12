import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  KeywordStanding,
  SCAN_DEPTH,
  isStale,
  sortStanding,
  standingSummary,
  type StandingEntry,
} from "./KeywordStanding.js";

const e = (o: Partial<StandingEntry>): StandingEntry => ({
  keyword: "kw",
  rank: null,
  total: 100,
  checked_at: "2026-08-01",
  ...o,
});

// Heathen's real shape: a few strong holds, a long unranked tail.
const HEATHEN: StandingEntry[] = [
  e({ keyword: "secular meditation", rank: 1, total: 176 }),
  e({ keyword: "heathen", rank: 2, total: 42 }),
  e({ keyword: "atheist meditation", rank: 4, total: 171 }),
  e({ keyword: "stoic meditation", rank: 16, total: 187 }),
  e({ keyword: "anxiety", rank: null, total: 180 }),
  e({ keyword: "agnostic", rank: null, total: 55 }),
];

describe("sortStanding", () => {
  it("leads with the best measured position", () => {
    const out = sortStanding(HEATHEN);
    expect(out.slice(0, 4).map((r) => r.rank)).toEqual([1, 2, 4, 16]);
  });

  it("puts every unranked term after every ranked one", () => {
    const out = sortStanding(HEATHEN);
    const firstAbsent = out.findIndex((r) => r.rank === null);
    expect(out.slice(firstAbsent).every((r) => r.rank === null)).toBe(true);
  });

  it("orders the unranked tail by how contested the term is", () => {
    // an absence on a busy keyword is a bigger miss than on a quiet one
    const out = sortStanding(HEATHEN).filter((r) => r.rank === null);
    expect(out.map((r) => r.keyword)).toEqual(["anxiety", "agnostic"]);
  });

  it("does not mutate its input", () => {
    const input = [...HEATHEN];
    sortStanding(input);
    expect(input.map((r) => r.keyword)).toEqual(HEATHEN.map((r) => r.keyword));
  });
});

describe("standingSummary", () => {
  it("counts ranked against tracked, and finds the best position", () => {
    expect(standingSummary(HEATHEN)).toEqual({ ranked: 4, tracked: 6, best: 1, topFive: 3 });
  });

  it("reports best as null when nothing ranks — never 0 or 200", () => {
    const none = [e({ keyword: "a" }), e({ keyword: "b" })];
    const s = standingSummary(none);
    expect(s.best).toBeNull();
    expect(s.ranked).toBe(0);
  });

  it("the headline can get WORSE — losing a rank lowers the count", () => {
    const before = standingSummary(HEATHEN).ranked;
    const after = standingSummary(
      HEATHEN.map((r) => (r.keyword === "heathen" ? { ...r, rank: null } : r)),
    ).ranked;
    expect(after).toBe(before - 1);
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-08-30");
  it("flags a reading older than the window", () => {
    expect(isStale("2026-06-22", now)).toBe(true);
  });
  it("leaves a recent reading alone", () => {
    expect(isStale("2026-08-28", now)).toBe(false);
  });
  it("never invents staleness from an unparseable date", () => {
    expect(isStale("not a date", now)).toBe(false);
  });
});

describe("<KeywordStanding />", () => {
  it("renders one row per tracked keyword", () => {
    render(<KeywordStanding entries={HEATHEN} />);
    for (const r of HEATHEN) {
      expect(screen.getByTestId(`standing-row-${r.keyword}`)).toBeTruthy();
    }
  });

  it("states the honest headline", () => {
    render(<KeywordStanding entries={HEATHEN} />);
    expect(screen.getByTestId("standing-headline").textContent).toContain("4 of 6");
  });

  it("gives an unranked term a hollow marker, NOT a plotted position", () => {
    render(<KeywordStanding entries={HEATHEN} />);
    expect(screen.getByTestId("absent-anxiety")).toBeTruthy();
    // and no measured dot exists for it
    expect(screen.queryByTestId("dot-anxiety")).toBeNull();
  });

  it("never plots an unranked term at the scan floor", () => {
    // the failure this guards: null → 200 makes a real absence read as a
    // bad-but-real position, and readers stop noticing missing data.
    const { container } = render(<KeywordStanding entries={[e({ keyword: "gone" })]} />);
    const dots = container.querySelectorAll('circle[fill="var(--signal)"]');
    expect(dots.length).toBe(0);
    expect(screen.getByTestId("absent-gone")).toBeTruthy();
  });

  it("plots a measured position on the scale", () => {
    render(<KeywordStanding entries={[e({ keyword: "secular", rank: 1, total: 167 })]} />);
    expect(screen.getByTestId("dot-secular")).toBeTruthy();
  });

  it("renders an unknown competitor count as — rather than 0", () => {
    const { container } = render(
      <KeywordStanding entries={[e({ keyword: "x", rank: 3, total: null })]} />,
    );
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain(">0<");
  });

  it("dims a stale reading instead of presenting it as current", () => {
    const now = Date.parse("2026-08-30");
    render(<KeywordStanding entries={[e({ keyword: "aurelius", rank: 55, checked_at: "2026-06-22" })]} now={now} />);
    const dot = screen.getByTestId("dot-aurelius");
    expect(Number(dot.getAttribute("opacity"))).toBeLessThan(1);
  });

  it("names the scan depth in the accessible label, so absence has a scope", () => {
    render(<KeywordStanding entries={HEATHEN} />);
    const svg = screen.getByRole("img");
    expect(svg.getAttribute("aria-label")).toContain(String(SCAN_DEPTH));
  });

  it("renders nothing for an empty set rather than an empty frame", () => {
    const { container } = render(<KeywordStanding entries={[]} />);
    expect(container.firstChild).toBeNull();
  });


  // ── selection: the standing view is the index into the trend chart ──────
  it("is INERT by default — nothing looks clickable unless it is", () => {
    render(<KeywordStanding entries={HEATHEN} />);
    const row = screen.getByTestId("standing-row-heathen");
    expect(row.getAttribute("role")).toBeNull();
    expect(row.getAttribute("tabindex")).toBeNull();
  });

  it("exposes each row as a button when selection is enabled", () => {
    render(<KeywordStanding entries={HEATHEN} onSelect={() => {}} />);
    const row = screen.getByTestId("standing-row-heathen");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
  });

  it("reports the chosen keyword on click", () => {
    const picked: string[] = [];
    render(<KeywordStanding entries={HEATHEN} onSelect={(k) => picked.push(k)} />);
    fireEvent.click(screen.getByTestId("standing-row-anxiety"));
    expect(picked).toEqual(["anxiety"]);
  });

  it("is operable from the keyboard — Enter and Space both choose", () => {
    const picked: string[] = [];
    render(<KeywordStanding entries={HEATHEN} onSelect={(k) => picked.push(k)} />);
    const row = screen.getByTestId("standing-row-secular meditation");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(picked).toEqual(["secular meditation", "secular meditation"]);
  });

  it("ignores other keys rather than firing on anything", () => {
    const picked: string[] = [];
    render(<KeywordStanding entries={HEATHEN} onSelect={(k) => picked.push(k)} />);
    fireEvent.keyDown(screen.getByTestId("standing-row-heathen"), { key: "a" });
    expect(picked).toEqual([]);
  });

  it("marks the charted keyword as pressed, and only that one", () => {
    render(<KeywordStanding entries={HEATHEN} onSelect={() => {}} selected="heathen" />);
    expect(screen.getByTestId("standing-row-heathen").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("standing-row-anxiety").getAttribute("aria-pressed")).toBe("false");
  });

  it("an UNRANKED row is still selectable — its history is worth seeing", () => {
    // a term that fell out of the results has the most consequential trend
    const picked: string[] = [];
    render(<KeywordStanding entries={HEATHEN} onSelect={(k) => picked.push(k)} />);
    fireEvent.click(screen.getByTestId("standing-row-agnostic"));
    expect(picked).toEqual(["agnostic"]);
  });
});

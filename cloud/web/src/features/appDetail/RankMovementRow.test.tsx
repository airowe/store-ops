import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RankMovementRow } from "./RankMovementRow.js";
import type { DeltaEntry } from "@shipaso/api";

const entry = (o: Partial<DeltaEntry>): DeltaEntry => ({
  keyword: "todo",
  previous: null,
  current: null,
  delta: null,
  direction: "unmeasured",
  ...o,
});

describe("<RankMovementRow />", () => {
  it("an improvement (prev > cur) shows ▲ and the magnitude", () => {
    render(<RankMovementRow entry={entry({ previous: 20, current: 8 })} />);
    expect(screen.getByTestId("delta")).toHaveTextContent("▲12");
  });

  it("a single snapshot (previous null) shows 'new' — NO fabricated count-up", () => {
    render(<RankMovementRow entry={entry({ previous: null, current: 9 })} />);
    expect(screen.getByTestId("new")).toHaveTextContent("new");
    expect(screen.queryByTestId("delta")).toBeNull();
  });

  it("a genuinely unmeasured row (no previous either) reads '—', never 0", () => {
    render(<RankMovementRow entry={entry({ previous: null, current: null })} />);
    expect(screen.getByTestId("flat")).toHaveTextContent("—");
    expect(screen.getByTestId("move-todo")).not.toHaveTextContent("0");
  });

  /**
   * #360. This row previously rendered as the neutral "—" case, so a keyword
   * falling out of the top 200 — the worst thing that can happen to a tracked
   * term — looked identical to "we didn't check". It had a previous rank, so we
   * know it WAS ranked and now is not.
   */
  it("a keyword that fell out of the results says so, in the bad treatment", () => {
    render(<RankMovementRow entry={entry({ previous: 9, current: null, direction: "lost" })} />);
    const lost = screen.getByTestId("lost");
    expect(lost).toHaveTextContent(/lost/i);
    expect(lost).toHaveStyle({ color: "var(--bad)" });
    // Still no fabricated number: we do not know where it landed.
    expect(screen.queryByTestId("delta")).toBeNull();
    expect(screen.getByTestId("move-todo")).not.toHaveTextContent("0");
    // …and it must NOT read as the neutral unmeasured case.
    expect(screen.queryByTestId("flat")).toBeNull();
  });
});

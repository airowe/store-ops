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

  it("an unmeasured current reads '—', never 0", () => {
    render(<RankMovementRow entry={entry({ previous: 9, current: null })} />);
    // current is unmeasured ("—") AND the movement cell is "—" — both honest, no 0.
    expect(screen.getByTestId("flat")).toHaveTextContent("—");
    expect(screen.getByTestId("move-todo")).not.toHaveTextContent("0");
  });
});

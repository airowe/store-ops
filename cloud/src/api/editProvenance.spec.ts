/**
 * Provenance for migration 0013's `source` column.
 *
 * The column exists because of a specific corruption: a page agent drafts an
 * alternative, the human approves it unchanged, and the RLHF row records
 * edited = 0 — indistinguishable from a human assenting to the ORIGINAL
 * proposal. Without provenance the signal reads an agent's authorship as a
 * human's preference.
 *
 * `editSourceFor` is the pure rule that stops that. It is deliberately
 * CONSERVATIVE: anything it cannot prove came from an agent is 'human',
 * because over-attributing to the agent would corrupt the signal in the other
 * direction.
 */
import { describe, expect, it } from "vitest";
import { editSourceFor } from "./editProvenance.js";

describe("editSourceFor", () => {
  it("is 'human' for a run nothing ever staged", () => {
    expect(editSourceFor(undefined)).toBe("human");
  });

  it("is 'agent-draft' once an agent staged copy onto the run", () => {
    expect(editSourceFor({ lastEditSource: "agent-draft" })).toBe("agent-draft");
  });

  it("is 'human' when the human staged the edit themselves", () => {
    expect(editSourceFor({ lastEditSource: "human" })).toBe("human");
  });

  it("falls back to 'human' on an unrecognised value rather than guessing", () => {
    expect(editSourceFor({ lastEditSource: "wat" as never })).toBe("human");
  });

  it("falls back to 'human' on a trace from before this field existed", () => {
    expect(editSourceFor({} as never)).toBe("human");
  });
});

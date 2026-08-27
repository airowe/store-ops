/**
 * Where a run's FINAL copy came from — the input to migration 0013's `source`
 * column.
 *
 * The corruption this prevents (stated in d1.ts alongside the column): a page
 * agent drafts an alternative, the human approves it unchanged, and the RLHF
 * row records `edited = 0` — byte-identical to a human assenting to the
 * ORIGINAL proposal. The preference signal then reads an agent's authorship as
 * a human's taste, and nothing downstream can tell the two apart.
 *
 * The rule is deliberately CONSERVATIVE. Only copy we can prove an agent staged
 * is attributed to the agent; anything unknown, malformed, or predating the
 * field is 'human' — which is both the historical default and the safer error,
 * since over-attributing to the agent corrupts the signal in the other
 * direction just as badly.
 */
import type { ProposalEditSource } from "../d1.js";

/** The provenance ShipASO records on a trace when copy is staged. */
export type EditProvenance = {
  /** Who authored the most recent staged edit. Absent on older traces. */
  lastEditSource?: ProposalEditSource;
};

const KNOWN: readonly ProposalEditSource[] = ["human", "agent-draft"];

/**
 * The `source` to record for this run's decision. `provenance` is the trace's
 * own field, which is `undefined` for every run staged before 0013 and for
 * every run nothing ever staged.
 */
export function editSourceFor(provenance: EditProvenance | undefined): ProposalEditSource {
  const source = provenance?.lastEditSource;
  return source && KNOWN.includes(source) ? source : "human";
}

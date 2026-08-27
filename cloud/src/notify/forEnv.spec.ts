/**
 * changedFields — the measured-or-nothing enforcement point (CLAUDE.md).
 *
 * The notification's count comes from here. If this over-reports, every
 * run_ready message inflates what the agent did, which is precisely the kind of
 * unmeasured number the invariant exists to forbid.
 */
import { describe, expect, it } from "vitest";
import { changedFields } from "./forEnv.js";

describe("changedFields", () => {
  it("counts a field only when the proposal DIFFERS from what is live", () => {
    expect(
      changedFields(
        { name: "Moonly", subtitle: "New subtitle" },
        { name: "Moonly", subtitle: "Old subtitle" },
      ),
    ).toEqual(["subtitle"]);
  });

  it("counts nothing when the run re-proposes the current copy verbatim", () => {
    const same = { name: "Moonly", subtitle: "Tarot & moon rituals" };
    expect(changedFields(same, same)).toEqual([]);
  });

  it("ignores whitespace-only differences", () => {
    expect(changedFields({ subtitle: "  Tarot  " }, { subtitle: "Tarot" })).toEqual([]);
  });

  it("counts a field that is newly proposed where nothing is live", () => {
    expect(changedFields({ subtitle: "Tarot" }, {})).toEqual(["subtitle"]);
    expect(changedFields({ subtitle: "Tarot" }, undefined)).toEqual(["subtitle"]);
  });

  it("never counts an empty or absent proposal", () => {
    expect(changedFields({ subtitle: "" }, { subtitle: "Tarot" })).toEqual([]);
    expect(changedFields({}, { subtitle: "Tarot" })).toEqual([]);
    expect(changedFields(undefined, { subtitle: "Tarot" })).toEqual([]);
  });

  it("reports every changed field, in a stable order", () => {
    expect(
      changedFields(
        { name: "A", subtitle: "B", keywords: "c,d", promo: "E", description: "F" },
        { name: "z", subtitle: "z", keywords: "z", promo: "z", description: "z" },
      ),
    ).toEqual(["name", "subtitle", "keywords", "promo", "description"]);
  });
});

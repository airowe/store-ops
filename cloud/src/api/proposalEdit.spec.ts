/**
 * `finalizeEditedCopy` is the pure merge-and-validate gate behind the editable
 * proposal feature (#39 Part 1). The human edits a proposal in place; the server
 * merges ONLY the editable fields (name/subtitle/keywords/promo) over the agent's
 * proposed copy and re-runs the engine's REAL `validateCopy` — so an over-limit or
 * keyword-rule-violating edit can never be staged for push. The client mirror is
 * advisory; this is the authoritative server-side check.
 *
 * Honesty constraints pinned here:
 *  - only the editable fields merge; unknown keys and description/whatsNew are ignored,
 *  - validation is the engine's own (CHAR_LIMITS + comma/space + title-dup),
 *  - an empty edit is an identity (copy === original, validation matches).
 */
import { describe, expect, it } from "vitest";
import { finalizeEditedCopy } from "./proposalEdit.js";
import type { CopyFields } from "../engine/optimize.js";

const proposed: CopyFields = {
  name: "Calm",
  subtitle: "Meditation and sleep",
  keywords: "breathe,relax,unwind,nightly",
  promo: "New: calmer nights, every night.",
};

describe("finalizeEditedCopy", () => {
  it("merges only the editable fields and ignores unknown/description/whatsNew keys", () => {
    const { copy } = finalizeEditedCopy(proposed, {
      name: "Calmer",
      subtitle: "Sleep better tonight",
      // these must be ignored — not part of the editable Part 1 scope:
      description: "a 4000-char body that must never be merged",
      whatsNew: "release notes",
      // unknown key must be ignored entirely:
      bogus: "x",
    } as Partial<CopyFields> & Record<string, unknown>);

    expect(copy.name).toBe("Calmer");
    expect(copy.subtitle).toBe("Sleep better tonight");
    // untouched editable fields keep the agent's proposal:
    expect(copy.keywords).toBe(proposed.keywords);
    expect(copy.promo).toBe(proposed.promo);
    // description/whatsNew were not on the proposed copy and must NOT be fabricated:
    expect(copy.description).toBeUndefined();
    expect(copy.whatsNew).toBeUndefined();
  });

  it("an empty edit is an identity: copy equals the original proposal and passes", () => {
    const { copy, validation } = finalizeEditedCopy(proposed, {});
    expect(copy).toEqual(proposed);
    expect(validation.pass).toBe(true);
  });

  it("rejects an over-limit subtitle (31 chars) with the exact over-by count", () => {
    const over = "x".repeat(31);
    const { validation } = finalizeEditedCopy(proposed, { subtitle: over });
    expect(validation.pass).toBe(false);
    const sub = validation.checks.find((c) => c.field === "subtitle");
    expect(sub?.ok).toBe(false);
    expect(sub?.issues.join(" ")).toContain("over limit by 1");
  });

  it("rejects a keyword field with a space after a comma", () => {
    const { validation } = finalizeEditedCopy(proposed, { keywords: "breathe, relax,unwind" });
    expect(validation.pass).toBe(false);
    const kw = validation.checks.find((c) => c.field === "keywords");
    expect(kw?.ok).toBe(false);
    expect(kw?.issues.join(" ")).toContain("NO spaces");
  });

  it("rejects a keyword field that duplicates a title/subtitle word", () => {
    // edit the keyword field to include "sleep", a word already in the subtitle.
    const { validation } = finalizeEditedCopy(proposed, { keywords: "sleep,relax,unwind" });
    expect(validation.pass).toBe(false);
    const kw = validation.checks.find((c) => c.field === "keywords");
    expect(kw?.ok).toBe(false);
    expect(kw?.issues.join(" ")).toContain("duplicates title/subtitle");
  });

  it("does not fabricate a field the agent never proposed (no-key run)", () => {
    // a no-key proposal: subtitle/keywords were unseen, so they're absent.
    const thin: CopyFields = { name: "Calm", subtitle: "", keywords: "" };
    const { copy } = finalizeEditedCopy(thin, { name: "Calmer" });
    expect(copy.promo).toBeUndefined();
    expect(copy.description).toBeUndefined();
  });
});

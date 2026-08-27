/**
 * Staging (`POST /runs/:id/edits`) is the agent's ONE write at the gate: it
 * changes WHAT would be approved, never WHETHER it is. These tests pin the
 * boundary — a staged edit must leave the run awaiting approval — and reuse the
 * same validation the approve path runs, so an agent cannot stage copy a human
 * could not.
 */
import { describe, expect, it } from "vitest";
import { stageDecision } from "./stageEdit.js";

const PROPOSED = { name: "Ballpark", subtitle: "Track every game", keywords: "baseball,scores" };

describe("stageDecision", () => {
  it("accepts an edit to a field the agent proposed", () => {
    const d = stageDecision(PROPOSED, { subtitle: "Every game, every score" }, "awaiting_approval");
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.copy.subtitle).toBe("Every game, every score");
  });

  it("refuses to stage onto a run that is no longer at the gate", () => {
    const d = stageDecision(PROPOSED, { subtitle: "x" }, "approved");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/awaiting approval/i);
  });

  it("refuses an empty edit rather than writing a no-op", () => {
    const d = stageDecision(PROPOSED, {}, "awaiting_approval");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/no editable/i);
  });

  it("refuses an edit naming only fields the agent never proposed", () => {
    const noSubtitle = { name: "Ballpark", keywords: "baseball" } as unknown as typeof PROPOSED;
    const d = stageDecision(noSubtitle, { subtitle: "invented" }, "awaiting_approval");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/no editable/i);
  });

  it("refuses copy that fails the engine's own validation", () => {
    const d = stageDecision(PROPOSED, { subtitle: "x".repeat(200) }, "awaiting_approval");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/validation/i);
  });

  it("never reports a status other than awaiting_approval on success", () => {
    const d = stageDecision(PROPOSED, { name: "Ballpark Live" }, "awaiting_approval");
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.status).toBe("awaiting_approval");
  });
});

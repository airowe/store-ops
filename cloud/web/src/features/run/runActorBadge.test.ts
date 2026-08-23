/**
 * The actor marker for a run LIST.
 *
 * RunTriggerNote tells this story well, but only on the run detail page. In a
 * list, a run the agent opened unprompted and a run the user clicked "Run
 * audit" for look identical — which flattens the exact distinction the product
 * is selling.
 *
 * This derives the compact form from runTrigger's ALREADY-RESOLVED actor. It
 * must never re-derive the actor from a trace: one resolver, one answer, or the
 * list and the detail page can disagree about who did what.
 */
import { describe, expect, it } from "vitest";
import { runActorBadge } from "./runActorBadge.js";

describe("runActorBadge", () => {
  it("marks a cron run as the agent's own", () => {
    const b = runActorBadge({ source: "cron", reasons: ["2 targeted keyword(s) unranked"] });
    expect(b).not.toBeNull();
    expect(b!.actor).toBe("agent");
    // The accessible name must carry the same sentence the detail page shows.
    expect(b!.label).toBe("ShipASO opened this run on its own.");
  });

  it("marks a manual run as the human's", () => {
    const b = runActorBadge({ source: "manual", reasons: [] });
    expect(b!.actor).toBe("human");
    expect(b!.label).toBe("You asked for this run.");
  });

  it("marks a connect run as system", () => {
    const b = runActorBadge({ source: "connect", reasons: [] });
    expect(b!.actor).toBe("system");
  });

  it("renders NOTHING for a run with no trigger — silence, not a guess", () => {
    // An older run predating the field. The correct statement about who opened
    // it is none at all; a default marker would be an invented fact.
    expect(runActorBadge(null)).toBeNull();
    expect(runActorBadge(undefined)).toBeNull();
  });

  it("carries a short glyph that is not the only signal", () => {
    // Colour-only would fail both accessibility and a landing-page screenshot.
    const b = runActorBadge({ source: "cron", reasons: [] });
    expect(typeof b!.glyph).toBe("string");
    expect(b!.glyph.length).toBeGreaterThan(0);
  });

  it("agent and human are visually distinct, not just differently coloured", () => {
    const agent = runActorBadge({ source: "cron", reasons: [] })!;
    const human = runActorBadge({ source: "manual", reasons: [] })!;
    expect(agent.glyph).not.toBe(human.glyph);
    expect(agent.short).not.toBe(human.short);
  });
});

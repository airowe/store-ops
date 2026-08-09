/**
 * Parity guard: `shotCatalog.ts` is a MIRROR of the source of truth at
 * `lib/shot_catalog.json` (the Python renderer resolves layouts from the JSON;
 * the Worker can't import outside cloud/, so the TS side duplicates the data).
 * This spec deep-diffs the mirror against the JSON so the two halves of the
 * pipeline — what the planner/pickers offer and what the renderer can actually
 * draw — can never disagree silently.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { FRAME_CATALOG, FRAME_CATALOG_VERSION, TEMPLATE_IDS, isTemplateId } from "./shotCatalog.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sot = JSON.parse(readFileSync(join(repoRoot, "lib/shot_catalog.json"), "utf8")) as {
  version: number;
  templates: unknown[];
};

describe("shotCatalog mirrors lib/shot_catalog.json", () => {
  it("carries the same version", () => {
    expect(FRAME_CATALOG_VERSION).toBe(sot.version);
  });

  it("deep-equals the JSON catalog, entry for entry, in order", () => {
    // JSON round-trip the TS side so `undefined`-valued keys can't hide a diff.
    expect(JSON.parse(JSON.stringify(FRAME_CATALOG))).toEqual(sot.templates);
  });

  it("derives TEMPLATE_IDS in catalog order", () => {
    expect([...TEMPLATE_IDS]).toEqual(
      (sot.templates as Array<{ id: string }>).map((t) => t.id),
    );
  });
});

describe("catalog integrity", () => {
  it("every frame keeps its boxes on-canvas (fractions in [0,1])", () => {
    for (const t of FRAME_CATALOG) {
      const boxes = [t.deviceFrame, ...Object.values(t.slots)];
      for (const b of boxes) {
        expect(b.fx, t.id).toBeGreaterThanOrEqual(0);
        expect(b.fy, t.id).toBeGreaterThanOrEqual(0);
        expect(b.fx + b.fw, t.id).toBeLessThanOrEqual(1);
        expect(b.fy + b.fh, t.id).toBeLessThanOrEqual(1);
      }
    }
  });

  it("every frame has a headline slot and picker metadata", () => {
    for (const t of FRAME_CATALOG) {
      expect(t.slots, t.id).toHaveProperty("headline");
      expect(t.name.trim(), t.id).not.toBe("");
      expect(t.sell.trim().length, t.id).toBeGreaterThanOrEqual(20);
    }
  });

  it("isTemplateId accepts every catalog id and nothing else", () => {
    for (const t of FRAME_CATALOG) expect(isTemplateId(t.id)).toBe(true);
    expect(isTemplateId("spinny-3d-carousel")).toBe(false);
    expect(isTemplateId("")).toBe(false);
    expect(isTemplateId(undefined)).toBe(false);
    expect(isTemplateId("auto")).toBe(false);
  });
});

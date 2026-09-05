import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * The audit card has two renderers: the page section (cloud/src/api/
 * reportPage.ts) and the image (lib/audit_card_render.py). Both read the
 * same `CardValue` union. This pins the Python side to the TypeScript source
 * by reading BOTH as text, so a fifth state added on either side — the one
 * that would let an estimate through — fails here, not on a live card.
 */
const here = dirname(fileURLToPath(import.meta.url));
const ts = readFileSync(resolve(here, "auditCard.ts"), "utf8");
const py = readFileSync(resolve(here, "../../../lib/audit_card_render.py"), "utf8");

function tsStates(): string[] {
  const block = ts.match(/export type CardValue<T> =([\s\S]*?)\n\n/)?.[1] ?? "";
  return [...block.matchAll(/state: "([a-z]+)"/g)].map((m) => m[1]!);
}

function pyStates(): string[] {
  const tuple = py.match(/CARD_STATES = \(([^)]*)\)/)?.[1] ?? "";
  return [...tuple.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);
}

describe("audit card state parity (TS ↔ Python)", () => {
  it("the TypeScript union has exactly the four honest states", () => {
    expect(tsStates()).toEqual(["measured", "pending", "unavailable", "absent"]);
  });

  it("the Python renderer declares the same states in the same order", () => {
    expect(pyStates()).toEqual(tsStates());
  });

  it("the Python renderer reads a value from the measured state only", () => {
    const body = py.match(/def show_value[\s\S]*?raise ValueError/)?.[0] ?? "";
    const reads = [...body.matchAll(/v\["value"\]/g)].length;
    expect(reads).toBe(1);
    expect(body).toContain('if state == "measured":');
  });

  it("negative control: the parser would catch a fifth state on either side", () => {
    const withEstimate = ts.replace('| { state: "absent" }', '| { state: "absent" }\n  | { state: "estimated"; value: T }');
    const block = withEstimate.match(/export type CardValue<T> =([\s\S]*?)\n\n/)?.[1] ?? "";
    expect([...block.matchAll(/state: "([a-z]+)"/g)].map((m) => m[1])).toContain("estimated");
  });
});

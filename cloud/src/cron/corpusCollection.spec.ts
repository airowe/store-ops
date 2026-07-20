/**
 * runCorpusCollection (#63) — the gated cron step. Invariants:
 *   • flag OFF (default) → inert: collects nothing, persists nothing,
 *   • flag ON → collects via the env FetchFn and persists the observations,
 *   • a collection failure is contained by the caller (handleDailySnapshot wraps
 *     it in try/catch) — here we assert the enabled path calls collect + persist.
 *
 * Mirrors snapshot.spec.ts: mock the d1 + engine + fetchAdapter modules.
 */
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../index.js";

const collectCorpus = vi.fn(async () => [{ bundleId: "a" }, { bundleId: "b" }]);
const persistCorpusSnapshots = vi.fn(async () => undefined);

vi.mock("../engine/corpusCollect.js", () => ({
  collectCorpus: (...a: unknown[]) => collectCorpus(...(a as [])),
  CORPUS_SEEDS: ["weather", "budget"],
  DEFAULT_COUNTRY: "us",
  DEFAULT_TOP_N: 20,
}));
vi.mock("../d1.js", () => ({
  persistCorpusSnapshots: (...a: unknown[]) => persistCorpusSnapshots(...(a as [])),
}));
vi.mock("../fetchAdapter.js", () => ({ fetchForEnv: () => (async () => ({})) }));

import { runCorpusCollection } from "./corpusCollection.js";

const envWith = (flag?: string): Env => ({ DB: {}, CATEGORY_CORPUS_ENABLED: flag } as unknown as Env);

describe("runCorpusCollection", () => {
  it("is inert when the flag is unset (default OFF)", async () => {
    collectCorpus.mockClear();
    persistCorpusSnapshots.mockClear();
    const report = await runCorpusCollection(envWith(undefined));
    expect(report.enabled).toBe(false);
    expect(report.rowsPersisted).toBe(0);
    expect(collectCorpus).not.toHaveBeenCalled();
    expect(persistCorpusSnapshots).not.toHaveBeenCalled();
  });

  it("collects + persists when the flag is on", async () => {
    collectCorpus.mockClear();
    persistCorpusSnapshots.mockClear();
    const report = await runCorpusCollection(envWith("1"));
    expect(report.enabled).toBe(true);
    expect(report.seedsProcessed).toBe(2);
    expect(report.rowsPersisted).toBe(2);
    expect(collectCorpus).toHaveBeenCalledOnce();
    expect(persistCorpusSnapshots).toHaveBeenCalledOnce();
  });

  it("accepts 'true' as well as '1'", async () => {
    const report = await runCorpusCollection(envWith("true"));
    expect(report.enabled).toBe(true);
  });
});

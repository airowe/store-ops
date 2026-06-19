import { describe, it, expect, vi } from "vitest";
import { createSearchController } from "./searchController.js";

/**
 * The logged-out preview + authenticated connect boxes used to require a manual
 * button click. This controller drives DEBOUNCED auto-search: typing 3+ chars
 * fires a de-duped query, and — critically — out-of-order responses are dropped
 * so a slow earlier request can never overwrite a newer one (the classic
 * autocomplete race). Pure + injectable (fake clock + fake fetcher), so the
 * timing and staleness rules unit-test without a DOM.
 */

function controllerWith(opts: {
  minChars?: number;
  delay?: number;
} = {}) {
  const calls: string[] = [];
  const settled: Array<{ query: string; result: unknown }> = [];
  let pending: Array<{ query: string; resolve: (v: unknown) => void }> = [];

  const fetcher = (query: string) => {
    calls.push(query);
    return new Promise<unknown>((resolve) => {
      pending.push({ query, resolve });
    });
  };

  const ctrl = createSearchController({
    minChars: opts.minChars ?? 3,
    delayMs: opts.delay ?? 250,
    fetcher,
    onResult: (result, query) => settled.push({ query, result }),
  });

  return {
    ctrl,
    calls,
    settled,
    // resolve the in-flight request for a given query with a result
    respond(query: string, result: unknown) {
      const idx = pending.findIndex((p) => p.query === query);
      if (idx === -1) throw new Error(`no pending request for "${query}"`);
      const [p] = pending.splice(idx, 1);
      p!.resolve(result);
    },
  };
}

describe("createSearchController", () => {
  it("does not fire below minChars", () => {
    vi.useFakeTimers();
    const { ctrl, calls } = controllerWith({ minChars: 3 });
    ctrl.input("ca");
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([]);
    vi.useRealTimers();
  });

  it("fires once, after the debounce delay, for a 3+ char query", () => {
    vi.useFakeTimers();
    const { ctrl, calls } = controllerWith({ minChars: 3, delay: 250 });
    ctrl.input("calm");
    expect(calls).toEqual([]); // not yet — still within the debounce window
    vi.advanceTimersByTime(249);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["calm"]);
    vi.useRealTimers();
  });

  it("debounces rapid keystrokes into a single trailing call", () => {
    vi.useFakeTimers();
    const { ctrl, calls } = controllerWith({ delay: 250 });
    ctrl.input("ca");
    vi.advanceTimersByTime(100);
    ctrl.input("cal");
    vi.advanceTimersByTime(100);
    ctrl.input("calm");
    vi.advanceTimersByTime(250);
    expect(calls).toEqual(["calm"]); // only the final value searched
    vi.useRealTimers();
  });

  it("de-dups: typing the same query again does not refire", () => {
    vi.useFakeTimers();
    const { ctrl, calls, respond } = controllerWith({ delay: 250 });
    ctrl.input("calm");
    vi.advanceTimersByTime(250);
    respond("calm", { needsChoice: true });
    // user clears and retypes the SAME term — already shown, don't refetch
    ctrl.input("calm");
    vi.advanceTimersByTime(250);
    expect(calls).toEqual(["calm"]);
    vi.useRealTimers();
  });

  it("drops a stale (out-of-order) response so the newest query wins", async () => {
    vi.useFakeTimers();
    const { ctrl, settled, respond } = controllerWith({ delay: 250 });

    ctrl.input("cal");
    vi.advanceTimersByTime(250); // fires "cal"
    ctrl.input("calm");
    vi.advanceTimersByTime(250); // fires "calm"

    // The SECOND query resolves first…
    respond("calm", { tag: "calm-result" });
    // …then the FIRST (stale) query resolves late. It must be ignored.
    respond("cal", { tag: "cal-result" });

    await vi.runAllTimersAsync();
    expect(settled.map((s) => s.query)).toEqual(["calm"]);
    expect(settled.at(-1)?.result).toEqual({ tag: "calm-result" });
    vi.useRealTimers();
  });

  it("emptying the input cancels a pending search and clears", () => {
    vi.useFakeTimers();
    const { ctrl, calls } = controllerWith({ delay: 250 });
    let cleared = false;
    ctrl.onClear(() => {
      cleared = true;
    });
    ctrl.input("calm");
    vi.advanceTimersByTime(100);
    ctrl.input(""); // cleared before the debounce elapsed
    vi.advanceTimersByTime(250);
    expect(calls).toEqual([]);
    expect(cleared).toBe(true);
    vi.useRealTimers();
  });

  it("submit() fires immediately, bypassing the debounce", () => {
    vi.useFakeTimers();
    const { ctrl, calls } = controllerWith({ delay: 250 });
    ctrl.input("calm");
    ctrl.submit(); // user hit Enter / clicked the button
    expect(calls).toEqual(["calm"]); // no wait
    vi.useRealTimers();
  });

  it("submit() still de-dups against an already-shown query", () => {
    vi.useFakeTimers();
    const { ctrl, calls, respond } = controllerWith({ delay: 250 });
    ctrl.input("calm");
    vi.advanceTimersByTime(250);
    respond("calm", { ok: true });
    ctrl.submit(); // pressing Enter on the same shown query → no refetch
    expect(calls).toEqual(["calm"]);
    vi.useRealTimers();
  });
});

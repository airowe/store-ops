import { describe, expect, it, vi } from "vitest";
import { isPropagation404, withRetry } from "./retry.mjs";

/**
 * #491 — the crossorigin asset check must wait out an edge-propagation 404
 * and must NOT wait out a wrong MIME type (that is the real outage).
 */
const noSleep = () => Promise.resolve();

describe("withRetry", () => {
  it("returns the first successful value and stops", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("/assets/a.js (with Origin) → 404")).mockResolvedValue("ok");
    const onRetry = vi.fn();
    await expect(withRetry(fn, { attempts: 3, shouldRetry: isPropagation404, onRetry, sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it("gives up after the last attempt and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("/assets/a.js (with Origin) → 404"));
    await expect(withRetry(fn, { attempts: 3, shouldRetry: isPropagation404, sleep: noSleep })).rejects.toThrow("→ 404");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry an error the predicate rejects — a wrong MIME fails immediately", async () => {
    const fn = vi.fn().mockRejectedValue(new Error('/assets/a.js served as "text/html" to a crossorigin request — cached HTML?'));
    await expect(withRetry(fn, { attempts: 5, shouldRetry: isPropagation404, sleep: noSleep })).rejects.toThrow("cached HTML");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("waits delayMs between attempts, not before the first or after the last", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fn = vi.fn().mockRejectedValue(new Error("x → 404"));
    await withRetry(fn, { attempts: 3, delayMs: 7, shouldRetry: isPropagation404, sleep }).catch(() => {});
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7);
  });
});

describe("isPropagation404", () => {
  it("matches only the asset-404 message shape", () => {
    expect(isPropagation404(new Error("/assets/index-abc.js (with Origin) → 404"))).toBe(true);
    expect(isPropagation404(new Error("/assets/index-abc.js (with Origin) → 403"))).toBe(false);
    expect(isPropagation404(new Error('served as "text/html"'))).toBe(false);
    expect(isPropagation404(undefined)).toBe(false);
  });
});

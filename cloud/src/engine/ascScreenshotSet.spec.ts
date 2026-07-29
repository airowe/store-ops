/**
 * #374: find-or-create the appScreenshotSet an upload needs.
 *
 * Found while setting up verification, not in review: `uploadScreenshot` takes a
 * `screenshotSetId` as given, and NOTHING in the codebase created one. Every
 * unit and route test passed because they all supply the id — only trying to run
 * it against a real app (ShipASO Scratch, 0 sets) surfaced that nothing produces
 * one. So for an app that has never had screenshots for a device size — the
 * exact case this feature exists to serve — the upload path was unusable.
 *
 * Apple keys sets by (localization, screenshotDisplayType). FIND before CREATE:
 * a second upload to the same device size must reuse the set, or the listing
 * accumulates duplicate empty sets.
 */
import { describe, expect, it, vi } from "vitest";
import { ensureScreenshotSet } from "./ascScreenshotSet.js";

const ok = (body: unknown, status = 200) =>
  ({ ok: true, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

const fail = (status: number, detail: string) =>
  ({
    ok: false,
    status,
    json: async () => ({ errors: [{ detail }] }),
    text: async () => JSON.stringify({ errors: [{ detail }] }),
  }) as unknown as Response;

const base = {
  token: "t",
  localizationId: "loc-1",
  displayType: "APP_IPHONE_67",
};

describe("ensureScreenshotSet", () => {
  it("reuses an existing set for the same display type", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return ok({
        data: [
          { id: "set-65", attributes: { screenshotDisplayType: "APP_IPHONE_65" } },
          { id: "set-67", attributes: { screenshotDisplayType: "APP_IPHONE_67" } },
        ],
      });
    });

    const res = await ensureScreenshotSet(fetchFn as never, base);
    expect(res).toEqual({ id: "set-67", created: false });
    // found ⇒ no POST at all
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("creates a set when none exists for that display type", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if ((init?.method ?? "GET") === "GET") {
        // other device sizes exist, but not the one we want
        return ok({ data: [{ id: "set-65", attributes: { screenshotDisplayType: "APP_IPHONE_65" } }] });
      }
      return ok({ data: { id: "set-new" } }, 201);
    });

    const res = await ensureScreenshotSet(fetchFn as never, base);
    expect(res).toEqual({ id: "set-new", created: true });

    const post = calls.find((c) => c.init?.method === "POST")!;
    const body = JSON.parse(String(post.init?.body));
    expect(post.url).toMatch(/appScreenshotSets$/);
    expect(body.data.attributes.screenshotDisplayType).toBe("APP_IPHONE_67");
    expect(body.data.relationships.appStoreVersionLocalization.data.id).toBe("loc-1");
  });

  it("creates when the localization has no sets at all (the fresh-app case)", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET" ? ok({ data: [] }) : ok({ data: { id: "set-new" } }, 201),
    );
    const res = await ensureScreenshotSet(fetchFn as never, base);
    expect(res).toEqual({ id: "set-new", created: true });
  });

  it("surfaces a failed list rather than blindly creating a duplicate", async () => {
    // If we cannot SEE the existing sets we must not create — that is how a
    // listing ends up with two sets for one device size.
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET" ? fail(403, "no permission") : ok({ data: { id: "x" } }),
    );
    await expect(ensureScreenshotSet(fetchFn as never, base)).rejects.toThrow(
      /list screenshot sets|no permission/i,
    );
    const posted = fetchFn.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posted, "must not create when the list failed").toBe(false);
  });

  it("surfaces a failed create", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET" ? ok({ data: [] }) : fail(409, "display type not valid for this app"),
    );
    await expect(ensureScreenshotSet(fetchFn as never, base)).rejects.toThrow(
      /create screenshot set|display type/i,
    );
  });

  it("rejects an empty display type before calling Apple", async () => {
    const fetchFn = vi.fn();
    await expect(
      ensureScreenshotSet(fetchFn as never, { ...base, displayType: " " }),
    ).rejects.toThrow(/display type/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

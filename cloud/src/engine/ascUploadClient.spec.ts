/**
 * #374: the I/O half of Apple's screenshot upload — the three-step reservation,
 * driven against an injected fetch so every branch is exercised without touching
 * App Store Connect.
 *
 * What matters here is not the happy path (one shape, easily verified) but the
 * failure modes, because this writes to a LIVE listing with a borrowed
 * credential:
 *   • a placeholder must never reach step 1,
 *   • a failed PUT must not be committed as `uploaded: true`,
 *   • the checksum sent at commit must be of the bytes actually sent.
 */
import { describe, expect, it, vi } from "vitest";
import { uploadScreenshot } from "./ascUploadClient.js";
import { md5Hex } from "./ascUpload.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const ok = (body: unknown, status = 200) =>
  ({
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const fail = (status: number, detail = "nope") =>
  ({
    ok: false,
    status,
    json: async () => ({ errors: [{ detail }] }),
    text: async () => JSON.stringify({ errors: [{ detail }] }),
  }) as unknown as Response;

/** A fetch that walks the reservation: POST → PUT(s) → PATCH. */
function happyFetch(calls: Array<{ url: string; init: RequestInit | undefined }>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/appScreenshots") && init?.method === "POST") {
      return ok({
        data: {
          id: "shot-1",
          attributes: {
            uploadOperations: [
              { method: "PUT", url: "https://up/part1", offset: 0, length: 8, requestHeaders: [] },
              { method: "PUT", url: "https://up/part2", offset: 8, length: 4, requestHeaders: [] },
            ],
          },
        },
      });
    }
    if (url.startsWith("https://up/")) return ok({}, 200);
    if (url.includes("/appScreenshots/shot-1") && init?.method === "PATCH") {
      return ok({ data: { id: "shot-1", attributes: { assetDeliveryState: { state: "COMPLETE" } } } });
    }
    throw new Error(`unexpected call: ${init?.method} ${url}`);
  });
}

const base = {
  token: "t",
  screenshotSetId: "set-1",
  fileName: "APP_IPHONE_67_01.png",
  file: PNG,
};

describe("uploadScreenshot — the reservation dance", () => {
  it("reserves, PUTs every part, then commits with the checksum", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const res = await uploadScreenshot(happyFetch(calls) as never, base);

    expect(res).toMatchObject({ ok: true, id: "shot-1" });

    // 1. reservation declares the REAL size + name
    const post = calls[0]!;
    expect(post.init?.method).toBe("POST");
    const posted = JSON.parse(String(post.init?.body));
    expect(posted.data.attributes.fileSize).toBe(PNG.length);
    expect(posted.data.attributes.fileName).toBe("APP_IPHONE_67_01.png");
    expect(posted.data.relationships.appScreenshotSet.data.id).toBe("set-1");

    // 2. both parts PUT, in order, to Apple's URLs
    expect(calls[1]!.url).toBe("https://up/part1");
    expect(calls[2]!.url).toBe("https://up/part2");
    expect(calls[1]!.init?.method).toBe("PUT");

    // 3. commit carries uploaded:true and the checksum OF THE BYTES SENT
    const patch = calls[3]!;
    expect(patch.init?.method).toBe("PATCH");
    const committed = JSON.parse(String(patch.init?.body));
    expect(committed.data.attributes.uploaded).toBe(true);
    expect(committed.data.attributes.sourceFileChecksum).toBe(md5Hex(PNG));
  });

  it("sends the bearer token on the ASC calls but NOT to Apple's upload URLs", async () => {
    // The PUT URLs are pre-signed; forwarding our credential to them would leak
    // it to a host that does not need it.
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    await uploadScreenshot(happyFetch(calls) as never, base);
    const hdr = (i: number) => (calls[i]!.init?.headers ?? {}) as Record<string, string>;
    expect(hdr(0).authorization).toBe("Bearer t");
    expect(hdr(1).authorization).toBeUndefined();
    expect(hdr(3).authorization).toBe("Bearer t");
  });
});

describe("uploadScreenshot — refusals and failures", () => {
  /**
   * The renderer's watermarked placeholders must never reach a live listing.
   * Refused BEFORE the reservation, so nothing is created at Apple at all.
   */
  it("refuses a placeholder asset before making any request", async () => {
    const fetchFn = vi.fn();
    await expect(
      uploadScreenshot(fetchFn as never, { ...base, fileName: "home.needsReview.png" }),
    ).rejects.toThrow(/placeholder|needsReview/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses an empty file before making any request", async () => {
    const fetchFn = vi.fn();
    await expect(
      uploadScreenshot(fetchFn as never, { ...base, file: new Uint8Array(0) }),
    ).rejects.toThrow(/empty/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("surfaces a failed reservation and never PUTs", async () => {
    const fetchFn = vi.fn(async () => fail(409, "set is full"));
    await expect(uploadScreenshot(fetchFn as never, base)).rejects.toThrow(/reserve|set is full/i);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  /**
   * The important one: a part that fails to transfer must NOT be committed.
   * Committing `uploaded: true` on a partial asset tells Apple a corrupt image
   * is ready — the listing then shows a broken screenshot.
   */
  it("does NOT commit when a part fails to upload", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      if (url.endsWith("/appScreenshots")) {
        return ok({
          data: {
            id: "shot-1",
            attributes: {
              uploadOperations: [
                { method: "PUT", url: "https://up/part1", offset: 0, length: 12, requestHeaders: [] },
              ],
            },
          },
        });
      }
      if (url.startsWith("https://up/")) return fail(500, "transfer failed");
      return ok({});
    });

    await expect(uploadScreenshot(fetchFn as never, base)).rejects.toThrow(/upload part|transfer/i);
    expect(calls.some((c) => c.startsWith("PATCH")), "must not commit a failed upload").toBe(false);
  });

  it("rejects a reservation whose operations do not cover the file", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("/appScreenshots")) {
        return ok({
          data: {
            id: "shot-1",
            attributes: {
              // 4 bytes short of the 12-byte file
              uploadOperations: [
                { method: "PUT", url: "https://up/p", offset: 0, length: 8, requestHeaders: [] },
              ],
            },
          },
        });
      }
      return ok({});
    });
    await expect(uploadScreenshot(fetchFn as never, base)).rejects.toThrow(/cover/i);
  });

  it("surfaces a failed commit", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/appScreenshots") && init?.method === "POST") {
        return ok({
          data: {
            id: "shot-1",
            attributes: {
              uploadOperations: [
                { method: "PUT", url: "https://up/p", offset: 0, length: 12, requestHeaders: [] },
              ],
            },
          },
        });
      }
      if (url.startsWith("https://up/")) return ok({});
      return fail(422, "checksum mismatch");
    });
    await expect(uploadScreenshot(fetchFn as never, base)).rejects.toThrow(/commit|checksum/i);
  });
});

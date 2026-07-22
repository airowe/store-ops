import { describe, expect, it } from "vitest";
import { APP_STORE_RESPONSE_MAX, buildResponseBody, publishResponse } from "./ascReviewResponses.js";

describe("buildResponseBody", () => {
  it("builds a customerReviewResponses create body linking the review", () => {
    const body = buildResponseBody("REV1", "thanks") as any;
    expect(body.data.type).toBe("customerReviewResponses");
    expect(body.data.attributes.responseBody).toBe("thanks");
    expect(body.data.relationships.review.data.id).toBe("REV1");
  });
});

describe("publishResponse", () => {
  const ok = (id: string) =>
    ({ ok: true, json: async () => ({ data: { id } }) }) as unknown as Response;

  it("POSTs a new response when no existingResponseId (mode created)", async () => {
    let method = "";
    const fetchFn = async (_u: string, init?: RequestInit) => {
      method = init?.method ?? "GET";
      return ok("RESP1");
    };
    const res = await publishResponse(fetchFn, { token: "t", ascReviewId: "REV1", text: "hi" });
    expect(method).toBe("POST");
    expect(res.mode).toBe("created");
    expect(res.responseId).toBe("RESP1");
  });

  it("PATCHes when an existingResponseId is supplied (mode updated)", async () => {
    let url = "";
    let method = "";
    const fetchFn = async (u: string, init?: RequestInit) => {
      url = u; method = init?.method ?? "GET";
      return ok("RESP9");
    };
    const res = await publishResponse(fetchFn, {
      token: "t", ascReviewId: "REV1", text: "edit", existingResponseId: "RESP9",
    });
    expect(method).toBe("PATCH");
    expect(url).toContain("customerReviewResponses/RESP9");
    expect(res.mode).toBe("updated");
  });

  it("dryRun returns the exact body and never calls fetch", async () => {
    let called = false;
    const fetchFn = async () => { called = true; return ok("X"); };
    const res = await publishResponse(fetchFn, {
      token: "t", ascReviewId: "REV1", text: "hi", dryRun: true,
    });
    expect(called).toBe(false);
    expect(res.dryRun).toBe(true);
    expect(res.body).toEqual(buildResponseBody("REV1", "hi"));
  });

  it("throws AscWriteError for text over the length cap (before any fetch)", async () => {
    let called = false;
    const fetchFn = async () => { called = true; return ok("X"); };
    await expect(
      publishResponse(fetchFn, { token: "t", ascReviewId: "R", text: "x".repeat(APP_STORE_RESPONSE_MAX + 1) }),
    ).rejects.toThrow(/length|too long|5970/i);
    expect(called).toBe(false);
  });

  it("throws AscWriteError on a non-OK write and the message omits the token", async () => {
    const fetchFn = async () =>
      ({ ok: false, status: 409, json: async () => ({ errors: [{ detail: "conflict" }] }) }) as unknown as Response;
    await expect(
      publishResponse(fetchFn, { token: "SECRET_TOKEN", ascReviewId: "R", text: "hi" }),
    ).rejects.toThrow();
    await publishResponse(fetchFn, { token: "SECRET_TOKEN", ascReviewId: "R", text: "hi" }).catch((e) => {
      expect(String(e.message)).not.toContain("SECRET_TOKEN");
    });
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import {
  resolveOne,
  runReadOnlyAgent,
  runReadOnlyPlayAudit,
  runReadOnlyPlayAuditConnected,
} from "./appRun.js";
import type { FetchFn, FetchLike, GoogleServiceAccount } from "../engine/index.js";

/** A fetch stub for Play: any play.google.com URL → a fixed listing page. */
function stubPlayFetch(page?: string): FetchFn {
  const html =
    page ??
    `<html><head><script type="application/ld+json">${JSON.stringify({
      "@type": "SoftwareApplication",
      name: "Calm - Sleep & Meditation",
      description: "Guided meditation and sleep stories.",
      screenshot: ["https://play-lh.googleusercontent.com/s1"],
    })}</script></head></html>`;
  return (async () => new Response(html, { status: 200 })) as unknown as FetchFn;
}

describe("runReadOnlyPlayAudit — read-only Google Play audit", () => {
  it("audits a package id end to end (no keyword field, googleplay listing)", async () => {
    const out = await runReadOnlyPlayAudit(stubPlayFetch(), { query: "com.calm.android" });
    expect(out.kind).toBe("resolved");
    if (out.kind !== "resolved") throw new Error("expected resolved");
    expect(out.audit.listing.store).toBe("googleplay");
    expect(out.audit.listing.title).toContain("Calm");
    expect(out.audit.listing.keywordField).toBeNull();
    expect(out.audit.summary.total).toBe(out.audit.findings.length);
  });

  it("resolves a play.google.com URL to its package", async () => {
    const out = await runReadOnlyPlayAudit(stubPlayFetch(), {
      query: "https://play.google.com/store/apps/details?id=com.calm.android",
    });
    expect(out.kind).toBe("resolved");
  });

  it("returns not-found for a free-text name (Play has no public name search)", async () => {
    const out = await runReadOnlyPlayAudit(stubPlayFetch(), { query: "meditation app" });
    expect(out.kind).toBe("not-found");
  });

  it("throws when neither query nor packageName is given", async () => {
    await expect(runReadOnlyPlayAudit(stubPlayFetch(), {})).rejects.toThrow();
  });
});

describe("runReadOnlyPlayAuditConnected — owner audit via the Developer API", () => {
  let SA: GoogleServiceAccount;

  beforeAll(async () => {
    const kp = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
    let raw = "";
    for (let i = 0; i < pkcs8.length; i++) raw += String.fromCharCode(pkcs8[i]!);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(raw).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;
    SA = { client_email: "svc@p.iam.gserviceaccount.com", private_key: pem, token_uri: "https://oauth2.googleapis.com/token" };
  });

  /** Routes the token exchange + the edits.insert → listings → delete flow. */
  function devApiFetch(): FetchLike {
    return async (url, init) => {
      const method = init.method;
      const body = (s: string) => ({ ok: true, status: 200, text: async () => s });
      if (url.includes("/token")) return body(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      if (method === "POST" && url.endsWith("/edits")) return body(JSON.stringify({ id: "edit-1" }));
      if (method === "GET" && url.endsWith("/listings")) {
        return body(
          JSON.stringify({
            listings: [
              {
                language: "en-US",
                title: "Calm",
                shortDescription: "Sleep & meditation",
                fullDescription: "Guided meditation and sleep stories.",
              },
            ],
          }),
        );
      }
      return { ok: true, status: 204, text: async () => "" }; // DELETE
    };
  }

  it("reads the owner's listing at full fidelity (short description present, no locks)", async () => {
    const audit = await runReadOnlyPlayAuditConnected(devApiFetch(), SA, {
      packageName: "com.calm.android",
    });
    expect(audit.listing.store).toBe("googleplay");
    expect(audit.listing.title).toBe("Calm");
    expect(audit.listing.tagline).toBe("Sleep & meditation"); // fidelity win
    expect(audit.listing.reliable).toBe(true);
    expect(audit.locks).toEqual([]); // reliable read ⇒ no capability locks
  });

  it("requires a package name", async () => {
    await expect(
      runReadOnlyPlayAuditConnected(devApiFetch(), SA, { packageName: "" }),
    ).rejects.toThrow(/packageName/);
  });
});

// A fetch stub: /lookup → one live listing; /search → the supplied result set
// (empty by default, so rank checks return "not ranked" rather than a network).
function stubFetch(opts: {
  listing?: { trackName?: string; bundleId?: string; genres?: string[]; description?: string };
  search?: unknown[];
}): FetchFn {
  const listing = { bundleId: "com.acme.app", trackName: "Acme — Habit Tracker", ...opts.listing };
  return (async (url: string) => {
    if (url.includes("/lookup")) {
      return new Response(JSON.stringify({ resultCount: 1, results: [listing] }), { status: 200 });
    }
    const results = opts.search ?? [];
    return new Response(JSON.stringify({ resultCount: results.length, results }), { status: 200 });
  }) as unknown as FetchFn;
}

describe("resolveOne — query/bundle → one connectable app (read-only)", () => {
  it("resolves a bare bundle id off the live listing (rich name from store)", async () => {
    const out = await resolveOne(stubFetch({}), { bundleId: "com.acme.app", country: "US" });
    expect(out.kind).toBe("resolved");
    if (out.kind !== "resolved") throw new Error("expected resolved");
    expect(out.app.bundleId).toBe("com.acme.app");
    expect(out.app.name).toContain("Acme");
    expect(out.app.country).toBe("US");
  });

  it("reports not-found when a name query matches nothing", async () => {
    const out = await resolveOne(stubFetch({ search: [] }), { query: "zzzznotanapp", country: "US" });
    expect(out.kind).toBe("not-found");
  });

  it("throws when neither query nor bundleId is given", async () => {
    await expect(resolveOne(stubFetch({}), { country: "US" })).rejects.toThrow();
  });
});

describe("runReadOnlyAgent — drives the engine over a resolved app, no DB/push", () => {
  it("returns a full AgentResult (audit + ranks + DRAFT proposed copy)", async () => {
    const fetchFn = stubFetch({
      listing: { trackName: "Acme — Habit Tracker", description: "Build better habits." },
    });
    const result = await runReadOnlyAgent(fetchFn, {
      app: { bundleId: "com.acme.app", name: "Acme — Habit Tracker", country: "US" },
    });
    expect(result.audit).toBeDefined();
    expect(Array.isArray(result.ranks)).toBe(true);
    expect(result.proposedCopy).toBeDefined();
    // It's the same engine pass /preview uses — the description rides into the draft.
    expect(result.proposedCopy.description).toBe("Build better habits.");
  });
});

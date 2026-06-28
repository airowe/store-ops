import { describe, expect, it } from "vitest";
import {
  PlayApiError,
  type PlayApiListing,
  type PlayApiTransport,
  mapPlayApiListing,
  playDeveloperApiAdapter,
  readPlayListingViaApi,
  selectListing,
} from "./playDeveloperApi.js";
import { auditPlayListing } from "./auditPlayListing.js";
import { GOOGLE_PLAY_PROFILE } from "../store/profiles.js";

const EN: PlayApiListing = {
  language: "en-US",
  title: "Calm",
  shortDescription: "Sleep & meditation",
  fullDescription: "Guided meditation, sleep stories, and breathing exercises.",
};

/** A fake transport that records calls and returns scripted responses by method. */
function fakeTransport(opts: {
  listings?: PlayApiListing[];
  editId?: string | null;
  insertStatus?: number;
  listStatus?: number;
}) {
  const calls: { method: string; url: string }[] = [];
  const transport: PlayApiTransport = async ({ method, url }) => {
    calls.push({ method, url });
    if (method === "POST") {
      return {
        status: opts.insertStatus ?? 200,
        body: JSON.stringify(opts.editId === null ? {} : { id: opts.editId ?? "edit-123" }),
      };
    }
    if (method === "GET") {
      return {
        status: opts.listStatus ?? 200,
        body: JSON.stringify({ listings: opts.listings ?? [EN] }),
      };
    }
    return { status: 204, body: "" }; // DELETE
  };
  return { transport, calls };
}

describe("mapPlayApiListing — connected (owner) tier", () => {
  const listing = mapPlayApiListing("com.calm.android", EN);

  it("reads the title, SHORT description, and full description (fidelity win)", () => {
    expect(listing.title).toBe("Calm");
    expect(listing.tagline).toBe("Sleep & meditation"); // readable here, unlike the scrape
    expect(listing.longDescription).toContain("Guided meditation");
  });

  it("is marked reliable:true (owner data, not a public scrape)", () => {
    expect(listing.reliable).toBe(true);
  });

  it("still has NO keyword field — Play has none", () => {
    expect(listing.keywordField).toBeNull();
  });

  it("maps an undefined listing to honest nulls", () => {
    const empty = mapPlayApiListing("com.x", undefined);
    expect(empty.title).toBeNull();
    expect(empty.tagline).toBeNull();
    expect(empty.longDescription).toBeNull();
    expect(empty.reliable).toBe(true);
  });
});

describe("selectListing", () => {
  it("prefers the requested language, falling back to the first", () => {
    const de: PlayApiListing = { language: "de-DE", title: "Ruhe" };
    expect(selectListing([EN, de], "de-DE")).toBe(de);
    expect(selectListing([EN, de], "fr-FR")).toBe(EN);
    expect(selectListing([], "en-US")).toBeUndefined();
  });
});

describe("readPlayListingViaApi — edit insert → list → delete (never commit)", () => {
  it("reads a listing and ALWAYS deletes the edit (read-only, never publishes)", async () => {
    const { transport, calls } = fakeTransport({ listings: [EN] });
    const listing = await readPlayListingViaApi(transport, "com.calm.android");
    expect(listing.title).toBe("Calm");
    expect(listing.reliable).toBe(true);

    const methods = calls.map((c) => c.method);
    expect(methods).toEqual(["POST", "GET", "DELETE"]); // insert, list, discard
    // The read path must NEVER commit — no edits:commit URL is ever requested.
    expect(calls.some((c) => /:commit|\/commit/.test(c.url))).toBe(false);
  });

  it("selects the requested language", async () => {
    const de: PlayApiListing = { language: "de-DE", title: "Ruhe", fullDescription: "..." };
    const { transport } = fakeTransport({ listings: [EN, de] });
    const listing = await readPlayListingViaApi(transport, "com.x", { language: "de-DE" });
    expect(listing.title).toBe("Ruhe");
  });

  it("throws PlayApiError when the edit insert fails", async () => {
    const { transport } = fakeTransport({ insertStatus: 403 });
    await expect(readPlayListingViaApi(transport, "com.x")).rejects.toBeInstanceOf(PlayApiError);
  });

  it("throws PlayApiError when no edit id comes back", async () => {
    const { transport } = fakeTransport({ editId: null });
    await expect(readPlayListingViaApi(transport, "com.x")).rejects.toThrow(/no edit id/);
  });

  it("still deletes the edit even when the listings read fails", async () => {
    const { transport, calls } = fakeTransport({ listStatus: 500 });
    await expect(readPlayListingViaApi(transport, "com.x")).rejects.toBeInstanceOf(PlayApiError);
    expect(calls.map((c) => c.method)).toContain("DELETE"); // no dangling edit
  });
});

describe("playDeveloperApiAdapter — connected tier through the audit loop", () => {
  it("exposes the Google Play profile and resolves an owned package", async () => {
    const { transport } = fakeTransport({ listings: [EN] });
    const adapter = playDeveloperApiAdapter(transport);
    expect(adapter.profile).toBe(GOOGLE_PLAY_PROFILE);
    const res = await adapter.resolve("com.calm.android");
    expect(res.kind).toBe("resolved");
    expect(res.candidates[0]?.bundleId).toBe("com.calm.android");
  });

  it("audits the owner's listing with the short description present and NO locks", async () => {
    const { transport } = fakeTransport({ listings: [EN] });
    const audit = await auditPlayListing(playDeveloperApiAdapter(transport), "com.calm.android");
    // The fidelity win: short description (tagline) is read, not null/locked.
    expect(audit.listing.tagline).toBe("Sleep & meditation");
    expect(audit.listing.reliable).toBe(true);
    // reliable read ⇒ no capability locks (we CAN see these surfaces).
    expect(audit.locks).toEqual([]);
    // and a measured-empty surface is now a real finding, not a lock — e.g. no
    // short-description deficiency here because it IS present.
    expect(audit.findings.some((f) => f.id === "play_short_description_missing")).toBe(false);
  });
});

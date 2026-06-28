import { describe, expect, it } from "vitest";
import { APP_STORE_PROFILE, GOOGLE_PLAY_PROFILE } from "../store/profiles.js";
import type { NormalizedListing, StoreAdapter } from "../store/types.js";
import { auditPlayListing } from "./auditPlayListing.js";

const TALL = "https://play-lh.googleusercontent.com/x/1290x2796.png";

function listing(over: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    store: "googleplay",
    appId: "com.calm.android",
    title: "Calm",
    tagline: "Sleep & meditation",
    keywordField: null,
    longDescription:
      "Guided meditation, sleep stories, and breathing exercises to help you relax and sleep better every night.",
    screenshots: [{ family: "phone", urls: Array.from({ length: 6 }, () => TALL) }],
    category: { id: "HEALTH_AND_FITNESS", name: "HEALTH_AND_FITNESS" },
    reliable: true,
    ...over,
  };
}

/** A fake Google Play adapter returning a fixed listing, recording read args. */
function fakeAdapter(l: NormalizedListing, profile = GOOGLE_PLAY_PROFILE) {
  const reads: { appId: string; opts: unknown }[] = [];
  const adapter: StoreAdapter = {
    profile,
    resolve: async () => ({
      kind: "not-found",
      query: { kind: "name", term: "" },
      candidates: [],
      offset: 0,
      hasMore: false,
    }),
    readListing: async (appId, opts) => {
      reads.push({ appId, opts });
      return l;
    },
  };
  return { adapter, reads };
}

describe("auditPlayListing — end-to-end Play audit via a StoreAdapter", () => {
  it("reads the listing and grades its phone screenshots", async () => {
    const audit = await auditPlayListing(fakeAdapter(listing()).adapter, "com.calm.android");
    expect(audit.appId).toBe("com.calm.android");
    expect(audit.listing.store).toBe("googleplay");
    expect(audit.screenshots.primaryFamily).toBe("phone");
    expect(audit.screenshots.primaryCount).toBe(6);
    expect(["A", "B", "C"]).toContain(audit.screenshots.grade);
  });

  it("computes coverage on the 30/80/4000 budget", async () => {
    const audit = await auditPlayListing(fakeAdapter(listing()).adapter, "com.calm.android");
    const limits = Object.fromEntries(audit.coverage.fieldFill.map((f) => [f.field, f.limit]));
    expect(limits).toEqual({ title: 30, shortDescription: 80, description: 4000 });
  });

  it("measures target-term coverage when targets are supplied", async () => {
    const audit = await auditPlayListing(fakeAdapter(listing()).adapter, "com.calm.android", {
      targets: ["meditation", "anxiety"],
    });
    const terms = Object.fromEntries(audit.keywords.terms.map((t) => [t.term, t.inDescription]));
    expect(terms["meditation"]).toBe(true);
    expect(audit.keywords.missingFromDescription).toContain("anxiety");
  });

  it("produces sorted findings + a summary", async () => {
    const audit = await auditPlayListing(fakeAdapter(listing({ longDescription: "" })).adapter, "x");
    expect(audit.findings.some((f) => f.id === "play_description_empty")).toBe(true);
    expect(audit.findings[0]?.severity).toBe("critical");
    expect(audit.summary.total).toBe(audit.findings.length);
  });

  it("maps unmeasured (null) fields to UNSEEN coverage + emits capability locks", async () => {
    const { adapter } = fakeAdapter(
      listing({ tagline: null, longDescription: null, reliable: false }),
    );
    const audit = await auditPlayListing(adapter, "x");
    const shortFill = audit.coverage.fieldFill.find((f) => f.field === "shortDescription")!;
    expect(shortFill.seen).toBe(false); // null → unseen, never a false 0/limit
    expect(audit.locks.map((l) => l.surface)).toContain("shortDescription");
    // an unmeasured description is a lock, never a "missing description" deficiency
    expect(audit.findings.some((f) => f.id === "play_description_empty")).toBe(false);
  });

  it("flags brand burn in the short description when a brand is given", async () => {
    const { adapter } = fakeAdapter(
      listing({ tagline: "Calm helps you sleep", title: "Calm" }),
    );
    const audit = await auditPlayListing(adapter, "x", { brand: "Calm" });
    expect(audit.coverage.waste.some((w) => w.kind === "brand_repeat")).toBe(true);
  });

  it("threads country/lang through to the adapter read", async () => {
    const { adapter, reads } = fakeAdapter(listing());
    await auditPlayListing(adapter, "com.calm.android", { country: "GB", lang: "en" });
    expect(reads[0]).toEqual({
      appId: "com.calm.android",
      opts: { country: "GB", lang: "en" },
    });
  });

  it("throws if handed a non-Play (App Store) adapter", async () => {
    const { adapter } = fakeAdapter(listing(), APP_STORE_PROFILE);
    await expect(auditPlayListing(adapter, "x")).rejects.toThrow(/Google Play adapter/);
  });
});

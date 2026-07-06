import { describe, expect, it } from "vitest";
import { runAgent } from "./agent.js";
import type { AppInput } from "./agent.js";

// A fetch stub that returns a live iTunes listing for the lookup, and an empty
// result set for the rank-check searches. Lets us assert that runAgent pulls the
// live listing's name + description into the proposed copy (issue #12) without a
// network or any baseCopy override.
function stubFetch(listing: { trackName?: string; description?: string; genres?: string[] }) {
  return async (url: string) => {
    const body = url.includes("/lookup")
      ? { resultCount: 1, results: [{ bundleId: "com.acme.app", ...listing }] }
      : { resultCount: 0, results: [] }; // search → no rank hits
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

const baseInput = (): AppInput => ({
  app: "Acme",
  bundleId: "com.acme.app",
  keywords: [{ keyword: "habit", volume: 60, difficulty: 40, relevance: 80 }],
  competitors: [],
  previousCompetitors: {},
  country: "US",
});

describe("runAgent — live listing seeds the proposal (issue #12)", () => {
  it("uses the live listing description when no baseCopy is provided", async () => {
    const fetchFn = stubFetch({
      trackName: "Acme — Habit Tracker",
      description: "Build better habits with gentle daily nudges.",
    });
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.proposedCopy.description).toBe("Build better habits with gentle daily nudges.");
  });

  it("uses the live track name as the proposed name when no baseCopy.name", async () => {
    const fetchFn = stubFetch({ trackName: "Acme — Habit Tracker", description: "x" });
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.proposedCopy.name).toContain("Acme");
  });

  it("still prefers an explicit baseCopy over the live listing", async () => {
    const fetchFn = stubFetch({ trackName: "Live Name", description: "live desc" });
    const input = { ...baseInput(), baseCopy: { name: "Override", description: "override desc" } };
    const r = await runAgent(fetchFn as never, input);
    expect(r.proposedCopy.name).toBe("Override");
    expect(r.proposedCopy.description).toBe("override desc");
  });

  it("omits description when the live listing has none and no override", async () => {
    const fetchFn = stubFetch({ trackName: "Acme" });
    const r = await runAgent(fetchFn as never, baseInput());
    // no description field at all (rather than an empty string) keeps the
    // fastlane bundle from emitting a blank description.txt
    expect(r.proposedCopy.description).toBeUndefined();
  });
});

// The run page renders a PR-style diff (current → proposed), so the result must
// carry the CURRENT copy it diffed against — the same floor the optimizer used.
describe("runAgent — currentCopy carries the 'before' for the diff", () => {
  it("reflects the live listing values when no baseCopy override", async () => {
    const fetchFn = stubFetch({ trackName: "Acme — Habit Tracker", description: "Live desc." });
    const r = await runAgent(fetchFn as never, baseInput());
    expect(r.currentCopy.name).toContain("Acme");
    expect(r.currentCopy.description).toBe("Live desc.");
  });

  it("reflects an explicit baseCopy (the live subtitle/keywords read from ASC)", async () => {
    const fetchFn = stubFetch({ trackName: "Live Name", description: "live desc" });
    const input = {
      ...baseInput(),
      ascMetadataRead: true,
      baseCopy: { name: "Heathen", subtitle: "Stoic calm for atheists", keywords: "mindfulness,stoic", description: "d" },
    };
    const r = await runAgent(fetchFn as never, input);
    expect(r.currentCopy.subtitle).toBe("Stoic calm for atheists");
    expect(r.currentCopy.keywords).toBe("mindfulness,stoic");
  });

  it("treats an ASC-read-but-EMPTY subtitle/keywords as '' (seen), not omitted (unseen)", async () => {
    // The honesty bug (live Mangia): an app with no subtitle set yields an empty
    // read. We MUST distinguish read-but-empty ("") from never-read (undefined):
    // when ascMetadataRead is true, an empty field was READ — carry it as "" so
    // downstream coverage shows "empty", never the false "unseen".
    const fetchFn = stubFetch({ trackName: "Mangia", description: "recipe app" });
    const input = {
      ...baseInput(),
      ascMetadataRead: true,
      baseCopy: { name: "Mangia", subtitle: "", keywords: "", description: "recipe app" },
    };
    const r = await runAgent(fetchFn as never, input);
    expect(r.currentCopy.subtitle).toBe(""); // present + empty, NOT undefined
    expect(r.currentCopy.keywords).toBe(""); // present + empty, NOT undefined
    expect("subtitle" in r.currentCopy).toBe(true);
    expect("keywords" in r.currentCopy).toBe(true);
  });

  it("never lets undefined ASC fields masquerade as read (stays unseen)", async () => {
    // When ascMetadataRead is FALSE (public/no-key run), subtitle/keywords are
    // genuinely unknown — they must be omitted (unseen), never coerced to "".
    const fetchFn = stubFetch({ trackName: "Mangia", description: "recipe app" });
    const input = { ...baseInput(), ascMetadataRead: false as const };
    const r = await runAgent(fetchFn as never, input);
    expect("subtitle" in r.currentCopy).toBe(false);
    expect("keywords" in r.currentCopy).toBe(false);
  });
});

describe("audit — storefront screenshot fallback (lookup returns empty sets)", () => {
  const SHOT = (name: string) => ({
    screenshot: {
      template: `https://is1-ssl.mzstatic.com/image/thumb/P/v4/${name}/{w}x{h}{c}.{f}`,
      width: 1290,
      height: 2796,
    },
  });
  const storefrontHtml = JSON.stringify({
    data: [{ data: { shelfMapping: { product_media_phone_: { items: [SHOT("a"), SHOT("b")] } } } }],
  });
  const page = `<script type="application/json" id="serialized-server-data">${storefrontHtml}</script>`;

  function fetchWithStorefront(pageBody: string | null) {
    return async (url: string) => {
      if (url.includes("/lookup")) {
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                bundleId: "com.acme.app",
                trackName: "Acme",
                trackViewUrl: "https://apps.apple.com/us/app/acme/id111",
                screenshotUrls: [],
                ipadScreenshotUrls: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("https://apps.apple.com/")) {
        return pageBody === null
          ? new Response("nope", { status: 403 })
          : new Response(pageBody, { status: 200 });
      }
      return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
    };
  }

  it("scores the storefront set when the lookup API omits screenshots", async () => {
    const r = await runAgent(fetchWithStorefront(page) as never, baseInput());
    expect(r.audit.screenshots?.iphoneCount).toBe(2);
    expect(r.audit.screenshots?.grade).not.toBe("?");
  });

  it("keeps the honest unknown state when the storefront page also fails", async () => {
    const r = await runAgent(fetchWithStorefront(null) as never, baseInput());
    expect(r.audit.screenshots?.grade).toBe("?");
    expect(r.audit.screenshots?.screenshotUrls).toEqual([]);
  });
});

describe("audit — storefront listing enriches public runs", () => {
  const storefrontPage = (subtitle: string) =>
    `<script type="application/json" id="serialized-server-data">${JSON.stringify({
      data: [{ data: { lockup: { subtitle }, shelfMapping: {} } }],
    })}</script>`;

  function fetchWithPage(subtitle: string) {
    return async (url: string) => {
      if (url.includes("/lookup")) {
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                bundleId: "com.acme.app",
                trackName: "Acme",
                trackViewUrl: "https://apps.apple.com/us/app/acme/id111",
                screenshotUrls: ["https://cdn/a/{w}x{h}bb.png"],
                ipadScreenshotUrls: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("https://apps.apple.com/")) {
        return new Response(storefrontPage(subtitle), { status: 200 });
      }
      return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
    };
  }

  it("surfaces the public subtitle in currentCopy on runs without ASC (it IS read, honestly)", async () => {
    const r = await runAgent(fetchWithPage("Stoic calm for atheists") as never, {
      ...baseInput(),
      ascMetadataRead: false as const,
    });
    expect(r.currentCopy.subtitle).toBe("Stoic calm for atheists");
    // keywords remain genuinely private to ASC — still unseen.
    expect("keywords" in r.currentCopy).toBe(false);
  });

  it("prefers the ASC-read subtitle over the storefront one", async () => {
    const r = await runAgent(fetchWithPage("storefront subtitle") as never, {
      ...baseInput(),
      ascMetadataRead: true as const,
      baseCopy: { name: "Acme", subtitle: "asc subtitle", keywords: "k", description: "d" },
    });
    expect(r.currentCopy.subtitle).toBe("asc subtitle");
  });
});

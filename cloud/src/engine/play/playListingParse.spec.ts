import { describe, expect, it } from "vitest";
import {
  type PlayDetailRaw,
  extractLdJson,
  extractOgMeta,
  parsePlayDetail,
} from "./playListingParse.js";

/** Assemble a Play-like page: each ld+json object as its own script + og meta. */
function buildPage(opts: {
  ldJson?: unknown[];
  rawLdBlocks?: string[];
  og?: Record<string, string>;
}): string {
  const ld = (opts.ldJson ?? [])
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`)
    .concat(
      (opts.rawLdBlocks ?? []).map(
        (raw) => `<script type="application/ld+json">${raw}</script>`,
      ),
    )
    .join("\n");
  const og = Object.entries(opts.og ?? {})
    .map(([k, v]) => `<meta property="${k}" content="${v}">`)
    .join("\n");
  return `<!doctype html><html><head>${og}\n${ld}</head><body>page</body></html>`;
}

const SOFTWARE_APP = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Spotify: Music and Podcasts",
  description: "Listen to music and podcasts. Discover new songs, playlists, and shows.",
  operatingSystem: "ANDROID",
  applicationCategory: "MUSIC_AND_AUDIO",
  image: "https://play-lh.googleusercontent.com/icon=s180",
  screenshot: [
    "https://play-lh.googleusercontent.com/s1",
    "https://play-lh.googleusercontent.com/s2",
  ],
  contentRating: "Teen",
  author: { "@type": "Organization", name: "Spotify AB" },
  aggregateRating: { "@type": "AggregateRating", ratingValue: 4.3, ratingCount: 29680041 },
  offers: [{ "@type": "Offer", price: "0", priceCurrency: "USD" }],
};

// A non-app ld+json node Play also emits — the parser must pick the app, not this.
const BREADCRUMB = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [{ "@type": "ListItem", position: 1, name: "Apps" }],
};

describe("extractLdJson", () => {
  it("returns every valid ld+json block and skips malformed ones", () => {
    const html = buildPage({
      ldJson: [SOFTWARE_APP, BREADCRUMB],
      rawLdBlocks: ["{ this is : not json }"],
    });
    const blocks = extractLdJson(html);
    expect(blocks).toHaveLength(2); // malformed block dropped, never throws
  });

  it("returns [] when the page has no ld+json", () => {
    expect(extractLdJson("<html><head></head></html>")).toEqual([]);
  });
});

describe("extractOgMeta", () => {
  it("reads og tags and decodes HTML entities in content", () => {
    const html = buildPage({
      og: { "og:title": "Tom &amp; Jerry", "og:description": "Cat &#39;n&#39; mouse" },
    });
    const og = extractOgMeta(html);
    expect(og["og:title"]).toBe("Tom & Jerry");
    expect(og["og:description"]).toBe("Cat 'n' mouse");
  });
});

describe("parsePlayDetail — happy path (ld+json present)", () => {
  const raw = parsePlayDetail(
    buildPage({ ldJson: [BREADCRUMB, SOFTWARE_APP] }),
    "com.spotify.music",
  );

  it("extracts the core fields from the SoftwareApplication node", () => {
    expect(raw.packageName).toBe("com.spotify.music");
    expect(raw.title).toBe("Spotify: Music and Podcasts");
    expect(raw.description).toContain("Listen to music");
    expect(raw.icon).toContain("play-lh.googleusercontent.com");
    expect(raw.category).toBe("MUSIC_AND_AUDIO");
  });

  it("reads screenshots as a flat list", () => {
    expect(raw.screenshots).toHaveLength(2);
    expect(raw.screenshots[0]).toContain("/s1");
  });

  it("reads the published rating verbatim (never fabricated)", () => {
    expect(raw.ratingValue).toBe(4.3);
    expect(raw.ratingCount).toBe(29680041);
  });

  it("reads price verbatim from the first offer", () => {
    expect(raw.price).toBe("0");
    expect(raw.priceCurrency).toBe("USD");
  });
});

describe("parsePlayDetail — honesty: absent fields are null, never invented", () => {
  it("falls back to Open Graph for text/image when ld+json is absent", () => {
    const raw = parsePlayDetail(
      buildPage({
        og: {
          "og:title": "Pocket Casts",
          "og:description": "Podcast player",
          "og:image": "https://play-lh.googleusercontent.com/pc",
        },
      }),
      "au.com.shiftyjelly.pocketcasts",
    );
    expect(raw.title).toBe("Pocket Casts");
    expect(raw.description).toBe("Podcast player");
    expect(raw.icon).toContain("/pc");
    // nothing measured for these → honest nulls / empty
    expect(raw.ratingValue).toBeNull();
    expect(raw.ratingCount).toBeNull();
    expect(raw.price).toBeNull();
    expect(raw.screenshots).toEqual([]);
  });

  it("returns all-null/empty for a page with neither ld+json nor og", () => {
    const raw = parsePlayDetail("<html><head></head><body></body></html>", "com.example.x");
    const expected: PlayDetailRaw = {
      packageName: "com.example.x",
      title: null,
      description: null,
      icon: null,
      screenshots: [],
      category: null,
      ratingValue: null,
      ratingCount: null,
      price: null,
      priceCurrency: null,
    };
    expect(raw).toEqual(expected);
  });

  it("treats an empty/whitespace name as absent (null), not measured-empty", () => {
    const raw = parsePlayDetail(
      buildPage({ ldJson: [{ "@type": "SoftwareApplication", name: "   " }] }),
      "com.example.x",
    );
    expect(raw.title).toBeNull();
  });

  it("does not pick a non-SoftwareApplication node's fields", () => {
    // Only a BreadcrumbList present → no app node → title null (not "Apps").
    const raw = parsePlayDetail(buildPage({ ldJson: [BREADCRUMB] }), "com.example.x");
    expect(raw.title).toBeNull();
  });

  it("handles a single screenshot string (schema.org allows string | string[])", () => {
    const raw = parsePlayDetail(
      buildPage({
        ldJson: [{ "@type": "SoftwareApplication", name: "X", screenshot: "https://x/one" }],
      }),
      "com.example.x",
    );
    expect(raw.screenshots).toEqual(["https://x/one"]);
  });
});

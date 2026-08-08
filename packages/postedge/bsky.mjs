/**
 * Bluesky (AT Protocol) posting — the free automated leg of the posting edge.
 * Three XRPC calls over plain fetch (createSession → uploadBlob →
 * createRecord); no SDK, no dependency.
 *
 * Bluesky differences from X that this file absorbs:
 *   • no t.co: the raw store URL would eat the 300-grapheme budget, so the
 *     text carries a short display form and a link FACET carries the real URL,
 *   • facet ranges are UTF-8 BYTE offsets (the composed text starts with an
 *     emoji — character offsets would land mid-glyph),
 *   • hashtags are only clickable via tag facets (#40/#12 rank numbers are
 *     NOT tags — a tag must start with a letter),
 *   • hard caps: 300 graphemes, 1MB image blob. Both are checked before any
 *     network call and refused honestly — never silently truncated.
 */

const LINK_DISPLAY_MAX = 28;
const GRAPHEME_MAX = 300;
const BLOB_MAX_BYTES = 1_000_000;

function utf8len(s) {
  return Buffer.byteLength(s, "utf8");
}

/**
 * Replace raw URLs with short display text + link facets, and add tag facets
 * for real hashtags. Returns the Bluesky-ready `{ text, facets }`.
 */
export function prepareRichText(text) {
  const facets = [];
  let out = "";
  let last = 0;
  for (const m of text.matchAll(/https:\/\/\S+/g)) {
    out += text.slice(last, m.index);
    const url = m[0];
    let display = url.replace(/^https:\/\//, "");
    if (display.length > LINK_DISPLAY_MAX) display = `${display.slice(0, LINK_DISPLAY_MAX)}…`;
    const byteStart = utf8len(out);
    out += display;
    facets.push({
      index: { byteStart, byteEnd: utf8len(out) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
    });
    last = m.index + url.length;
  }
  out += text.slice(last);
  // Tags must start with a letter — "#40 → #12" is a rank move, not hashtags.
  for (const m of out.matchAll(/#([A-Za-z]\w*)/g)) {
    const byteStart = utf8len(out.slice(0, m.index));
    facets.push({
      index: { byteStart, byteEnd: byteStart + utf8len(m[0]) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[1] }],
    });
  }
  facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
  return { text: out, facets };
}

/** Public bsky.app URL for a created post record's at:// uri. */
export function postUrlFromRecord(handle, atUri) {
  return `https://bsky.app/profile/${handle}/post/${atUri.split("/").pop()}`;
}

/**
 * Post text + a PNG image to Bluesky. Throws (with the HTTP status and body)
 * on any failure — a posting edge must never believe it posted when it didn't.
 *
 * @param {{ service: string, identifier: string, password: string,
 *           text: string, png: Buffer, alt: string }} opts
 * @param {{ fetchImpl?: typeof fetch, now?: () => Date }} [deps]
 * @returns {Promise<{ url: string }>}
 */
export async function postToBluesky(opts, deps = {}) {
  const { fetchImpl = fetch, now = () => new Date() } = deps;
  const { service, identifier, password, text, png, alt } = opts;

  if (png.length > BLOB_MAX_BYTES) {
    throw new Error(
      `card image is ${png.length} bytes — over Bluesky's 1MB blob cap. ` +
        `Rasterize at a lower scale (rasterizePng(svg, { scale: 1 })).`,
    );
  }
  const rich = prepareRichText(text);
  const graphemes = [...new Intl.Segmenter().segment(rich.text)].length;
  if (graphemes > GRAPHEME_MAX) {
    throw new Error(
      `post is ${graphemes} graphemes — over Bluesky's 300 cap even after link shortening. Refusing to truncate.`,
    );
  }

  const call = async (path, init) => {
    const res = await fetchImpl(`${service}/xrpc/${path}`, init);
    if (!res.ok) {
      throw new Error(`Bluesky ${path} failed: HTTP ${res.status} — ${await res.text()}`);
    }
    return res.json();
  };

  const session = await call("com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });

  const upload = await call("com.atproto.repo.uploadBlob", {
    method: "POST",
    headers: { "Content-Type": "image/png", Authorization: `Bearer ${session.accessJwt}` },
    body: png,
  });

  const created = await call("com.atproto.repo.createRecord", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text: rich.text,
        facets: rich.facets,
        createdAt: now().toISOString(),
        embed: { $type: "app.bsky.embed.images", images: [{ alt, image: upload.blob }] },
      },
    }),
  });

  return { url: postUrlFromRecord(identifier, created.uri) };
}

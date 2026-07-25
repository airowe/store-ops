/**
 * App Store genre id → display name.
 *
 * Why this exists: the chart feed does not always carry a `genreName`, and the
 * raw id is NOT a name. Rendering "#42 in 6013" reads as a bug, so callers need
 * a way to turn an id into the label Apple itself uses — or to learn that they
 * cannot, and omit the category entirely.
 *
 * Honesty invariant: every pair below was transcribed from Apple's own genre
 * tree (the MZStoreServices `genres?id=36` endpoint), never from recall. A
 * WRONG name is strictly worse than no name: an absent category degrades to a
 * bare "#42", whereas a wrong one renders a FABRICATED label as if measured.
 * An id we do not have is therefore `undefined`, never a guess and never the
 * id echoed back as though it were a name.
 *
 * Coverage is the 27 top-level App Store categories plus the Games sub-genres
 * (7001-7019), which are the ids the category charts actually key on. Apple
 * defines no 7010 and no 6019; their absence here is deliberate, not an
 * oversight. Magazines & Newspapers (13xxx) and Stickers (16xxx) sub-genres are
 * out of scope — an app in one of those still resolves via its 6021/6025
 * parent, and an unresolved child correctly falls back to a bare rank.
 */

/** Frozen so a caller cannot mutate a measured label into an invented one. */
export const APP_STORE_GENRES: Readonly<Record<string, string>> = Object.freeze({
  // ── Top-level App Store categories ─────────────────────────────────────
  "6000": "Business",
  "6001": "Weather",
  "6002": "Utilities",
  "6003": "Travel",
  "6004": "Sports",
  "6005": "Social Networking",
  "6006": "Reference",
  "6007": "Productivity",
  "6008": "Photo & Video",
  "6009": "News",
  "6010": "Navigation",
  "6011": "Music",
  "6012": "Lifestyle",
  "6013": "Health & Fitness",
  "6014": "Games",
  "6015": "Finance",
  "6016": "Entertainment",
  "6017": "Education",
  "6018": "Books",
  "6020": "Medical",
  "6021": "Magazines & Newspapers",
  "6022": "Catalogs",
  "6023": "Food & Drink",
  "6024": "Shopping",
  "6025": "Stickers",
  "6026": "Developer Tools",
  "6027": "Graphics & Design",

  // ── Games sub-genres (children of 6014). Apple defines no 7010. ────────
  "7001": "Action",
  "7002": "Adventure",
  "7003": "Casual",
  "7004": "Board",
  "7005": "Card",
  "7006": "Casino",
  "7007": "Dice",
  "7008": "Educational",
  "7009": "Family",
  "7011": "Music",
  "7012": "Puzzle",
  "7013": "Racing",
  "7014": "Roleplaying",
  "7015": "Simulation",
  "7016": "Sports",
  "7017": "Strategy",
  "7018": "Trivia",
  "7019": "Word",
});

/**
 * Resolve a genre id to Apple's display name, or `undefined` when we do not
 * have that id. Undefined is the honest answer — the caller must omit the
 * category rather than fall back to the raw id.
 */
export function genreNameFor(genreId: string | undefined | null): string | undefined {
  if (!genreId) return undefined;
  return APP_STORE_GENRES[genreId];
}

/**
 * Humanize the release notes ("What's New") — a PURE, deterministic re-tone of
 * the App Store whatsNew field (issue #46).
 *
 * What this does: improve the TONE and readability of whatever copy is already
 * there — warm stiff phrasing, tidy whitespace, drop dead-weight filler.
 *
 * What this NEVER does: invent feature content. Release notes are the one field
 * where a fabricated specific ("New: dark mode") is an outright lie to users, so
 * the contract is strict — if the input is empty or only the classic boilerplate
 * ("Bug fixes and performance improvements"), we DO NOT manufacture a changelog.
 * We emit an honest, content-free nudge and flag `needsRealContent` so the UI can
 * ask the developer to paste their real changes. The app voice (name/subtitle) is
 * tone context only; it is never spliced into the notes as if it were shipped.
 *
 * This is a heuristic seam. There is no LLM client in this repo, so the transform
 * is a deterministic ruleset; a future upgrade can swap `humanizeReleaseNotes`'s
 * body for a model call behind the SAME signature/return shape without touching
 * the ASC read/write path or the callers.
 */

/** App Store What's New (whatsNew) hard char limit — same ceiling as description. */
export const RELEASE_NOTES_LIMIT = 4000;

/** The app's voice, used ONLY as tone context — never copied into the notes. */
export type ReleaseVoice = {
  name?: string | undefined;
  subtitle?: string | undefined;
  description?: string | undefined;
};

export type HumanizeReleaseNotesInput = {
  /** The current What's New text (may be empty, boilerplate, or real). */
  current: string;
  /** Optional app voice — tone context only. */
  voice?: ReleaseVoice | undefined;
};

export type HumanizedReleaseNotes = {
  /** The re-toned notes. Always non-empty (an honest nudge when there's no real content). */
  humanized: string;
  /** True when the input was empty or only the classic content-free boilerplate. */
  isBoilerplate: boolean;
  /**
   * True when there's no real changelog to humanize — the UI should ask the
   * developer for specifics rather than ship a tone-only rewrite. Implied by
   * (and currently equal to) isBoilerplate, but kept separate so the surface
   * can word the two states differently if it wants.
   */
  needsRealContent: boolean;
  /** Whether `humanized` actually differs from the trimmed input (skip no-op diffs). */
  changed: boolean;
};

/**
 * An honest, content-free message for the empty/boilerplate case. It re-engages
 * existing users ("here's why to open the app") WITHOUT asserting any specific
 * new functionality — note the deliberate absence of the word "new".
 */
const HONEST_BOILERPLATE_NUDGE =
  "This update brings under-the-hood fixes and polish to keep things running smoothly. " +
  "Thanks for using the app — your feedback shapes what we work on.";

/** Collapse all internal/edge whitespace runs for boilerplate matching. */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Does this text carry no real changelog signal? True for empty/whitespace and
 * for the canonical "bug fixes and performance improvements" boilerplate in its
 * common spelling/spacing/punctuation variants. Intentionally conservative: any
 * concrete detail beyond the boilerplate stems makes this false.
 */
function isContentFreeBoilerplate(text: string): boolean {
  const norm = normalizeForMatch(text);
  if (norm === "") return true;
  // Canonical variants, with "bugfixes" → "bug fixes" folded in.
  const folded = norm.replace(/\bbugfixes\b/g, "bug fixes");
  const BOILERPLATE = new Set([
    "bug fixes and performance improvements",
    "bug fixes performance improvements",
    "bug fixes and performance improvement",
    "performance improvements and bug fixes",
    "bug fixes",
    "minor bug fixes",
    "minor bug fixes and improvements",
    "various bug fixes and improvements",
    "bug fixes and improvements",
  ]);
  return BOILERPLATE.has(folded);
}

/**
 * Phrase-level softeners: stiff, corporate constructions → plainer, warmer verbs.
 * These rewrite HOW something is said, never WHAT was done — the object of each
 * verb (the actual change the developer wrote) is preserved verbatim.
 */
const SOFTENERS: Array<[RegExp, string]> = [
  [/\bwe have implemented\b/gi, "we added"],
  [/\bwe have added\b/gi, "we added"],
  [/\bwe have introduced\b/gi, "we added"],
  [/\bhas been implemented\b/gi, "is here"],
  [/\bhave been implemented\b/gi, "are here"],
  [/\bin order to\b/gi, "to"],
  [/\butilize\b/gi, "use"],
  [/\butilizes\b/gi, "uses"],
  [/\bleverage\b/gi, "use"],
  [/\bvarious\b/gi, "several"],
  [/\bnumerous\b/gi, "many"],
  [/\bplease be advised that\b/gi, ""],
  [/\bwe are pleased to announce that\b/gi, ""],
];

/** Apply the softeners, then tidy any capitalization/spacing they disturbed. */
function softenPhrasing(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SOFTENERS) out = out.replace(pattern, replacement);
  return out;
}

/** Normalize whitespace: trim lines, collapse 3+ blank lines to one, trim ends. */
function tidyWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Recapitalize a sentence start when a softener stripped a leading clause. */
function recapitalize(text: string): string {
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** Clamp to the App Store limit without splitting mid-word. */
function clampToLimit(text: string): string {
  if (text.length <= RELEASE_NOTES_LIMIT) return text;
  const slice = text.slice(0, RELEASE_NOTES_LIMIT);
  const lastBreak = slice.lastIndexOf(" ");
  return (lastBreak > RELEASE_NOTES_LIMIT - 40 ? slice.slice(0, lastBreak) : slice).trimEnd();
}

/**
 * Re-tone the What's New copy. Pure: no I/O, no globals, deterministic for a
 * given input. The `voice` argument is accepted for a future tone-aware upgrade
 * but is intentionally NOT spliced into the output today — emitting it as if it
 * were a shipped change would be the exact fabrication this transform forbids.
 */
export function humanizeReleaseNotes(input: HumanizeReleaseNotesInput): HumanizedReleaseNotes {
  const current = input.current ?? "";
  const trimmed = current.trim();

  if (isContentFreeBoilerplate(current)) {
    return {
      humanized: HONEST_BOILERPLATE_NUDGE,
      isBoilerplate: true,
      needsRealContent: true,
      changed: trimmed !== HONEST_BOILERPLATE_NUDGE,
    };
  }

  const softened = recapitalize(softenPhrasing(current));
  const humanized = clampToLimit(tidyWhitespace(softened));

  return {
    humanized,
    isBoilerplate: false,
    needsRealContent: false,
    changed: humanized !== trimmed,
  };
}

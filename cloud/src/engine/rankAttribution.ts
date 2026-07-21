/**
 * Rank-movement attribution (PRD 02) — the PROOF feature, kept rigorously honest.
 *
 * We have two independent signals already captured elsewhere:
 *   1. `rank_snapshots` — per-keyword rank over time (what actually moved), and
 *   2. the run/approval log — when a metadata change was pushed and what terms it
 *      added to the keyword / subtitle fields.
 *
 * `attributeRankMovements` JOINS them ON TIME: for each keyword that moved, it
 * looks for the most-recent push, landing in the window between the prior rank
 * check and the move, that actually ADDED that keyword as a term. When it finds
 * one, the movement is `linked`; a keyword that moved with no such push is
 * `coincident` (still honest — the move may owe to Apple's algorithm, seasonality,
 * a competitor's slip, or another untracked change); a keyword that didn't move is
 * `none`.
 *
 * HONESTY DISCIPLINE (the whole point):
 *   - Attribution is CORRELATIONAL, never causal. Every note we emit reads
 *     "after you added 'x'…" / "this followed your push" — NEVER "caused",
 *     "because", "drove", "led to", "due to". A test scans every string for those
 *     markers. Rank has many inputs; we surface a coincidence in time, not a cause.
 *   - We only `link` when the moved keyword was genuinely ADDED by the push
 *     (present in the proposed value, absent from the baseline). A reorder, or a
 *     term that was already there, is not an addition — better an honest
 *     `coincident` than a false `linked`.
 *   - The window matters: a push that lands AFTER the rank was observed, or one
 *     that predates the prior snapshot entirely, cannot have preceded the move, so
 *     it never links.
 *
 * Pure: no D1, no network. The caller (the API delta path / the mock) supplies the
 * already-read `rankHistory` and the derived `pushes`.
 */
import type { RankSnapshotRow } from "../d1.js";

/** Lower is better; a movement direction (mirrors the digest's vocabulary). */
export type MovementDirection = "up" | "down" | "new" | "lost" | "same";

/** How strongly (if at all) a move is tied to a tracked metadata push. */
export type AttributionConfidence = "linked" | "coincident" | "none";

/** A pushed-and-approved metadata change, projected to just what we diff/attribute on. */
export type PushInput = {
  runId: string;
  /** ISO-ish timestamp of when the change was approved/shipped (approval.decided_at). */
  pushedAt: string;
  /** the proposed keyword FIELD value (comma-joined). */
  proposedKeywords: string;
  /** the proposed subtitle value. */
  proposedSubtitle: string;
  /** the baseline keyword field this push diffed against (for the word-diff). */
  currentKeywords?: string;
  /** the baseline subtitle this push diffed against. */
  currentSubtitle?: string;
};

/** The correlational annotation attached to a linked movement. */
export type AttributedChange = {
  runId: string;
  /** ISO timestamp of when the linked push was approved/shipped. */
  pushedAt: string;
  /** the exact terms this push ADDED (in keywords/subtitle) that include the moved keyword. */
  addedTerms: string[];
  /** human, CORRELATIONAL copy — e.g. "after you added 'stoic' to keywords (Jun 12)". */
  note: string;
};

export type RankMovement = {
  keyword: string;
  /** previous rank (null = was unranked / no prior snapshot). */
  from: number | null;
  /** current rank (null = now unranked). */
  to: number | null;
  /** to - from when both are numbers (negative = improved); null otherwise. */
  delta: number | null;
  direction: MovementDirection;
  /** present only when the move is `linked` to a push that added the keyword. */
  attributedChange?: AttributedChange;
  confidence: AttributionConfidence;
};

export type AttributeInput = {
  /** RankSnapshotRow[] from getRankHistory(), ASC by checked_at (oldest → newest). */
  rankHistory: RankSnapshotRow[];
  /** approved pushes derived from shipped runs (+ their approval timestamps). */
  pushes: PushInput[];
};

// ── keyword-field helpers ─────────────────────────────────────────────────────

/** Split a comma-joined keyword field into normalized terms. */
function splitKeywordField(field: string): string[] {
  return field
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** The set of words in a phrase (subtitle), normalized — for whole-word matching. */
function phraseWords(phrase: string): Set<string> {
  return new Set(
    phrase
      .toLowerCase()
      .split(/[\s,]+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean),
  );
}

/**
 * The terms a push ADDED, relative to its baseline. A keyword-field term counts
 * if it's in the proposed field and NOT in the baseline field. A subtitle word
 * counts if it's a whole word in the proposed subtitle and NOT in the baseline
 * subtitle. Reorders and pre-existing terms are NOT additions (that's the line
 * between an honest `linked` and a false one).
 */
function addedTermsOf(push: PushInput): Set<string> {
  const added = new Set<string>();

  const prevKw = new Set(splitKeywordField(push.currentKeywords ?? ""));
  for (const term of splitKeywordField(push.proposedKeywords)) {
    if (!prevKw.has(term)) added.add(term);
  }

  const prevSubWords = phraseWords(push.currentSubtitle ?? "");
  for (const word of phraseWords(push.proposedSubtitle)) {
    if (!prevSubWords.has(word)) added.add(word);
  }

  return added;
}

/**
 * Does a push's addition cover the moved keyword? True when the whole keyword
 * matches an added keyword-field term, OR every word of a multi-word keyword was
 * added (so "sleep sounds" links if both "sleep" and "sounds" were added). We
 * never partial-match a single shared word, which would over-link.
 */
function pushCoversKeyword(added: Set<string>, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  if (added.has(kw)) return true;
  const parts = kw.split(/\s+/).filter(Boolean);
  return parts.length > 1 && parts.every((p) => added.has(p));
}

// ── timestamp helpers ─────────────────────────────────────────────────────────

/** Parse an ISO-ish ("2026-06-12 12:00:00" or "...T...Z") timestamp to epoch ms. */
function toMs(ts: string): number {
  const normalized = ts.includes("T") ? ts : ts.replace(" ", "T") + "Z";
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? Date.parse(ts) : ms;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Jun 12" style short date for the human note (UTC, locale-free + deterministic). */
function shortDate(ts: string): string {
  const d = new Date(toMs(ts));
  if (Number.isNaN(d.getTime())) return ts;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ── per-keyword movement window ───────────────────────────────────────────────

type Window = {
  from: number | null;
  to: number | null;
  /** checked_at of the prior distinct snapshot (the lower bound of the push window). */
  prevAt: string | null;
  /** checked_at of the current (newest) snapshot (the upper bound of the window). */
  curAt: string;
};

/**
 * From a per-keyword bucket (ASC by checked_at), take the current rank and the
 * prior DISTINCT-checked_at rank — mirrors the digest's `lastTwoDistinct` so the
 * delta the card animates and the delta we attribute never disagree.
 */
function lastTwoDistinct(bucket: RankSnapshotRow[]): Window {
  const newest = bucket[bucket.length - 1]!;
  let prevAt: string | null = null;
  let from: number | null = null;
  for (let i = bucket.length - 2; i >= 0; i--) {
    const row = bucket[i]!;
    if (row.checked_at !== newest.checked_at) {
      from = row.rank;
      prevAt = row.checked_at;
      break;
    }
  }
  return { from, to: newest.rank, prevAt, curAt: newest.checked_at };
}

/**
 * Classify a rank move (lower is better). Exported so per-market proof (#180)
 * reuses the EXACT same new/lost/up/down/same rules — the movement vocabulary
 * must be single-sourced or two surfaces drift.
 */
export function classifyMovement(from: number | null, to: number | null): {
  delta: number | null;
  direction: MovementDirection;
} {
  if (from === null && to === null) return { delta: null, direction: "same" };
  if (from === null) return { delta: null, direction: "new" };
  if (to === null) return { delta: null, direction: "lost" };
  const delta = to - from; // lower is better → negative = improved
  if (delta < 0) return { delta, direction: "up" };
  if (delta > 0) return { delta, direction: "down" };
  return { delta, direction: "same" };
}

// ── attribution ───────────────────────────────────────────────────────────────

/**
 * The CORRELATIONAL note. Phrasing is deliberately "after you added …" — it
 * states the time order (the push came first, then the move), never a cause. The
 * field hint ("to keywords"/"to your subtitle") helps the user locate the change.
 */
function buildNote(keyword: string, push: PushInput, addedForKeyword: string[]): string {
  const inKeywords = splitKeywordField(push.proposedKeywords).includes(keyword.trim().toLowerCase());
  const field = inKeywords ? "keywords" : "your subtitle";
  const term = addedForKeyword[0] ?? keyword;
  return `after you added '${term}' to ${field} (${shortDate(push.pushedAt)})`;
}

/**
 * Find the push to attribute a keyword's move to: the MOST RECENT push that (a)
 * landed strictly before the move was observed (`curAt`), (b) landed on/after the
 * prior snapshot (`prevAt`) so it sits inside this movement's window — a push
 * older than the baseline can't have driven THIS move — and (c) actually ADDED
 * the keyword. Returns null when no push qualifies (→ coincident).
 */
function findAttribution(
  keyword: string,
  win: Window,
  pushesNewestFirst: Array<{ push: PushInput; added: Set<string>; ms: number }>,
): AttributedChange | null {
  const curMs = toMs(win.curAt);
  const prevMs = win.prevAt === null ? Number.NEGATIVE_INFINITY : toMs(win.prevAt);

  for (const { push, added, ms } of pushesNewestFirst) {
    if (ms >= curMs) continue; // must precede the observed move
    if (ms < prevMs) break; // older than the baseline → outside this window (sorted, so stop)
    if (!pushCoversKeyword(added, keyword)) continue;

    const addedForKeyword = [...added].filter(
      (t) => t === keyword.trim().toLowerCase() || keyword.toLowerCase().split(/\s+/).includes(t),
    );
    return {
      runId: push.runId,
      pushedAt: push.pushedAt,
      addedTerms: addedForKeyword.length ? addedForKeyword : [keyword.trim().toLowerCase()],
      note: buildNote(keyword, push, addedForKeyword),
    };
  }
  return null;
}

export function attributeRankMovements(input: AttributeInput): RankMovement[] {
  // Group snapshots by keyword, preserving input ASC ordering within each bucket.
  const buckets = new Map<string, RankSnapshotRow[]>();
  for (const row of input.rankHistory) {
    const bucket = buckets.get(row.keyword);
    if (bucket) bucket.push(row);
    else buckets.set(row.keyword, [row]);
  }

  // Pre-compute each push's added-terms set once, sorted newest-first by pushedAt.
  const pushesNewestFirst = input.pushes
    .map((push) => ({ push, added: addedTermsOf(push), ms: toMs(push.pushedAt) }))
    .sort((a, b) => b.ms - a.ms);

  const out: RankMovement[] = [];
  for (const [keyword, bucket] of buckets) {
    const win = lastTwoDistinct(bucket);
    const { delta, direction } = classifyMovement(win.from, win.to);

    // No movement → confidence "none", never attributed.
    if (direction === "same") {
      out.push({ keyword, from: win.from, to: win.to, delta, direction, confidence: "none" });
      continue;
    }

    const attributed = findAttribution(keyword, win, pushesNewestFirst);
    if (attributed) {
      out.push({
        keyword,
        from: win.from,
        to: win.to,
        delta,
        direction,
        attributedChange: attributed,
        confidence: "linked",
      });
    } else {
      // moved, but no push added this term in the window → honest "coincident".
      out.push({ keyword, from: win.from, to: win.to, delta, direction, confidence: "coincident" });
    }
  }

  return out;
}

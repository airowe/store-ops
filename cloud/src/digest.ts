import type { RecordedProposals } from "./recordedProposals.js";
/**
 * The weekly "what moved" digest — a PURE builder separated from sending.
 *
 * `buildDigest` takes the flat, mixed-keyword `RankSnapshotRow[]` that
 * `getRankHistory(db, appId)` returns (ASC by checked_at, oldest → newest) and
 * computes, per keyword, the delta between the two most-recent DISTINCT weekly
 * snapshots. It has no knowledge of D1 or the network, so it unit-tests against
 * in-memory arrays. The render* functions turn a built digest into a plain,
 * scannable email body with exactly ONE call to action.
 *
 * Rank convention: it's a search-result POSITION, so LOWER is better. An
 * improvement (current rank smaller than previous) is `direction: "up"` with a
 * NEGATIVE numeric delta (current - previous). Entering the top-200 (previous
 * null / absent → current number) is "new"; dropping out (previous number →
 * current null) is "lost"; both null or an identical number is "same".
 */
import type { RankSnapshotRow, Tier } from "./d1.js";
import type { EmailMessage } from "./auth.js";
import {
  attributeRankMovements,
  type AttributedChange,
  type AttributionConfidence,
  type PushInput,
} from "./engine/rankAttribution.js";

export type DigestDirection = "up" | "down" | "new" | "lost" | "same";

export type DigestEntry = {
  keyword: string;
  /** the most-recent snapshot's rank (null = unranked / out of top 200). */
  current: number | null;
  /** the prior distinct snapshot's rank, or null when there is no prior one. */
  previous: number | null;
  /**
   * current - previous when BOTH are numbers (negative = improved). null when
   * either side is null (the transition is captured by `direction` instead).
   */
  delta: number | null;
  direction: DigestDirection;
};

export type Digest = {
  appName: string;
  entries: DigestEntry[];
  /** the single most notable move (biggest numeric improvement, else a new/lost event). */
  topMover: DigestEntry | null;
  anyMovement: boolean;
  /**
   * True when NO entry has a prior snapshot — i.e. this is the first-ever run
   * and every rank is a starting position, not a movement.
   *
   * A first snapshot classifies every ranked keyword as "new", which the HTML
   * hero used to render with the same green ▲ as a real improvement — so a
   * baseline read as "we moved you to #64" when nothing had moved. Renderers
   * MUST branch on this and frame a first run as a baseline. See the
   * "first-run baseline" block in digest.spec.ts.
   */
  isFirstRun: boolean;
};

export type BuildDigestOpts = { appName: string };

/**
 * The visual layer of the digest: app identity, metadata chips, audit grades and
 * a screenshot strip — the app-intelligence card shape people screenshot.
 *
 * EVERY field is optional and independently omitted when absent. That is the
 * measured-or-nothing rule in layout form: a missing grade shows no tile, never
 * a "—" tile pretending to be data. The competitors' equivalent card leads with
 * ESTIMATED downloads and revenue; we have neither, so ours leads with rank and
 * coverage, which are measured.
 *
 * Images are ENHANCEMENT ONLY. Mail clients block remote images by default, so
 * the rank, grades and chips are all text — the email must read completely with
 * every <img> stripped (there is a test pinning exactly that).
 */
export type DigestCard = {
  /** App Store icon URL (public CDN). */
  iconUrl?: string;
  developer?: string;
  version?: string;
  category?: string;
  /** Display price, e.g. "Free" or "$4.99". */
  price?: string;
  rating?: { average: number; count: number };
  /** Audit grades to tile, e.g. [{ label: "Screenshots", grade: "B" }]. */
  grades?: Array<{ label: string; grade: string }>;
  /** Public screenshot URLs; the strip is capped at MAX_STRIP. */
  screenshotUrls?: string[];
};

/** Screenshots shown in the strip. Beyond this the email gets heavy and mail
 * clients start clipping (Gmail truncates around 102KB). */
const MAX_STRIP = 5;

/**
 * The recorded-proposals line (#493), or null when there is nothing to say.
 * Zero is a measurement but not a headline: "0 proposals recorded" would read
 * as the agent doing nothing, when it recorded the week's snapshot as designed.
 */
function recordedLine(opts: RenderOpts): string | null {
  const r = opts.recordedProposals;
  if (!r || r.proposals <= 0) return null;
  const noun = r.proposals === 1 ? "proposal" : "proposals";
  const runs = r.runs === 1 ? "this week's run" : `${r.runs} runs this week`;
  return `${r.proposals} ${noun} recorded from ${runs} — not pushed to you because no rank moved. They are in your dashboard -> ${opts.dashboardUrl}`;
}

export type RenderOpts = {
  appName: string;
  dashboardUrl: string;
  hasPendingApproval: boolean;
  /**
   * Proposals the agent wrote in `detected` runs this week (#493). Those runs
   * open no gate and send no notification — by design, no nag when nothing
   * moved — but their output was invisible. Absent or zero → no line.
   */
  recordedProposals?: RecordedProposals | undefined;
  /** Optional visual layer; omitted entirely when absent (degrades to text). */
  card?: DigestCard | undefined;
  /**
   * Absolute unsubscribe URL for THIS recipient (comms-prefs Phase 2). Optional:
   * absent when API_ORIGIN is unconfigured — the digest then renders without a
   * footer link (degrade, never a broken href). One token per unique email; the
   * link turns off the digest for EVERY app on the account.
   */
  unsubscribeUrl?: string | undefined;
};

// ── classification ──────────────────────────────────────────────────────────

function classify(previous: number | null, current: number | null): DigestEntry {
  let delta: number | null = null;
  let direction: DigestDirection;

  if (previous === null && current === null) {
    direction = "same"; // still unranked
  } else if (previous === null) {
    direction = "new"; // entered the top-200 (or first-ever snapshot)
  } else if (current === null) {
    direction = "lost"; // dropped out of the top-200
  } else {
    delta = current - previous; // both numbers; lower is better
    if (delta < 0) direction = "up";
    else if (delta > 0) direction = "down";
    else direction = "same";
  }

  return { keyword: "", current, previous, delta, direction };
}

// ── delta window: last two DISTINCT checked_at snapshots per keyword ─────────

/**
 * From a per-keyword bucket (already ASC by checked_at), pick the current and
 * previous ranks using the two most-recent DISTINCT checked_at values. Rows that
 * share the newest checked_at collapse to one "current" snapshot; the previous is
 * the last row of the next-newest checked_at.
 */
function lastTwoDistinct(
  bucket: RankSnapshotRow[],
): { current: number | null; previous: number | null } {
  if (bucket.length === 0) return { current: null, previous: null };

  const newest = bucket[bucket.length - 1]!;
  const current = newest.rank;

  // walk backwards to the first row with a strictly-older checked_at; if there
  // is none (brand-new keyword, or all rows share one checked_at) previous stays
  // null and the keyword classifies as "new".
  let previous: number | null = null;
  for (let i = bucket.length - 2; i >= 0; i--) {
    const row = bucket[i]!;
    if (row.checked_at !== newest.checked_at) {
      previous = row.rank;
      break;
    }
  }
  return { current, previous };
}

// ── topMover selection ───────────────────────────────────────────────────────

function pickTopMover(entries: DigestEntry[]): DigestEntry | null {
  // 1) biggest numeric improvement (most-negative delta among "up" moves).
  let bestNumeric: DigestEntry | null = null;
  for (const e of entries) {
    if (e.direction === "up" && e.delta !== null) {
      if (bestNumeric === null || e.delta < bestNumeric.delta!) bestNumeric = e;
    }
  }
  if (bestNumeric) return bestNumeric;

  // 2) no numeric improvement — surface the first notable transition event.
  // A dropped-out keyword ("lost") is more notable than a minor slip ("down").
  for (const dir of ["new", "lost", "down"] as const) {
    const hit = entries.find((e) => e.direction === dir);
    if (hit) return hit;
  }
  return null;
}

// ── build (pure) ─────────────────────────────────────────────────────────────

export function buildDigest(
  rankHistory: RankSnapshotRow[],
  opts: BuildDigestOpts,
): Digest {
  // group by keyword, preserving the input ASC ordering within each bucket.
  const buckets = new Map<string, RankSnapshotRow[]>();
  for (const row of rankHistory) {
    const bucket = buckets.get(row.keyword);
    if (bucket) bucket.push(row);
    else buckets.set(row.keyword, [row]);
  }

  const entries: DigestEntry[] = [];
  for (const [keyword, bucket] of buckets) {
    const { current, previous } = lastTwoDistinct(bucket);
    const entry = classify(previous, current);
    entry.keyword = keyword;
    entries.push(entry);
  }

  const anyMovement = entries.some((e) => e.direction !== "same");
  const topMover = pickTopMover(entries);
  // First run = nothing has a prior snapshot to move FROM. An empty history is
  // not a first run (there is no baseline to report either).
  const isFirstRun = entries.length > 0 && entries.every((e) => e.previous === null);

  return { appName: opts.appName, entries, topMover, anyMovement, isFirstRun };
}

// ── delta view: the dashboard's animated rank-movement payload ────────────────

/**
 * A delta entry, optionally carrying the PRD-02 rank-attribution overlay: the
 * correlational link to the push that added this keyword (`attributedChange`) and
 * a `confidence` enum. The overlay is present only when `rankDeltasView` is given
 * the app's `pushes`; without them the entry is a plain `DigestEntry` and the UI
 * shows no attribution line (graceful degrade). The copy is always correlational
 * ("after you added X") — never causal — per the attribution engine.
 */
export type RankDeltaEntry = DigestEntry & {
  attributedChange?: AttributedChange;
  confidence?: AttributionConfidence;
};

export type RankDeltaView = {
  appName: string;
  /** per-keyword deltas, ordered by movement significance (biggest move first). */
  entries: RankDeltaEntry[];
  /** false when every keyword held — lets the UI skip the movement animation. */
  anyMovement: boolean;
};

/**
 * A "how much did this matter" weight for ordering the dashboard so the loudest
 * moves lead. Higher sorts first. Improvements outrank regressions; any real
 * transition (new/lost) outranks a hold; an unchanged keyword sinks to the end.
 */
function movementWeight(e: DigestEntry): number {
  switch (e.direction) {
    case "up":
      return 1000 + Math.abs(e.delta ?? 0); // bigger jump → higher
    case "down":
      return 500 + Math.abs(e.delta ?? 0);
    case "new":
      return 400;
    case "lost":
      return 300;
    case "same":
      return 0;
  }
}

/**
 * Shapes the same per-keyword deltas the digest computes into the payload the
 * dashboard animates (prev → cur count-up + direction pulse). Reuses
 * `buildDigest` so the email and the UI can never disagree about a delta, then
 * orders by `movementWeight` so the biggest mover renders first. Single-snapshot
 * keywords come back with `previous: null` / `direction: "new"`, which the UI
 * renders as today's on-render animation (the graceful fallback).
 */
export function rankDeltasView(
  rankHistory: RankSnapshotRow[],
  opts: BuildDigestOpts & {
    pushes?: PushInput[];
    /**
     * #74: the CURRENT targeted keyword set. When provided, entries are filtered
     * to these keywords so history-only keywords no longer targeted (e.g. a
     * pre-#57 'manager'/'mangia' tombstoned in old snapshots) don't resurface in
     * rank movement. Omitted → all keywords (back-compat for the email digest,
     * which should still report everything it observed).
     */
    keywords?: string[];
  },
): RankDeltaView {
  const { appName, entries, anyMovement } = buildDigest(rankHistory, opts);
  const allow = opts.keywords && opts.keywords.length ? new Set(opts.keywords) : null;
  const filtered = allow ? entries.filter((e) => allow.has(e.keyword)) : entries;
  const ordered: RankDeltaEntry[] = [...filtered].sort(
    (a, b) => movementWeight(b) - movementWeight(a),
  );

  // PRD 02: overlay rank attribution when the caller passes the app's pushes.
  // attributeRankMovements re-derives the same per-keyword deltas (it reuses the
  // digest's lastTwoDistinct window), so its movements line up 1:1 with `entries`
  // by keyword. We copy ONLY the correlational overlay (attributedChange +
  // confidence) onto the matching entry; the delta numbers stay authoritative
  // from buildDigest so the email and the card can never disagree.
  if (opts.pushes && opts.pushes.length) {
    const movements = attributeRankMovements({ rankHistory, pushes: opts.pushes });
    const byKeyword = new Map(movements.map((m) => [m.keyword, m]));
    for (const entry of ordered) {
      const m = byKeyword.get(entry.keyword);
      if (!m) continue;
      entry.confidence = m.confidence;
      if (m.attributedChange) entry.attributedChange = m.attributedChange;
    }
  }

  // Recompute movement off the FILTERED set: if every moved keyword was filtered
  // out, the (remaining) view honestly reads "held steady" rather than inheriting
  // movement from keywords we no longer surface.
  const filteredMovement = allow ? ordered.some((e) => e.direction !== "same") : anyMovement;
  return { appName, entries: ordered, anyMovement: filteredMovement };
}

// ── rendering ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A human one-liner for a single entry, e.g. "budget tracker: #40 → #12 (up 28)". */
function describeEntry(e: DigestEntry): string {
  const cur = e.current === null ? "unranked" : `#${e.current}`;
  const prev = e.previous === null ? "unranked" : `#${e.previous}`;
  switch (e.direction) {
    case "up":
      return `${e.keyword}: ${prev} → ${cur} (up ${Math.abs(e.delta ?? 0)})`;
    case "down":
      return `${e.keyword}: ${prev} → ${cur} (down ${Math.abs(e.delta ?? 0)})`;
    case "new":
      return `${e.keyword}: entered the top 200 at ${cur}`;
    case "lost":
      return `${e.keyword}: dropped out of the top 200 (was ${prev})`;
    case "same":
      return `${e.keyword}: held at ${cur}`;
  }
}

const HELD_STEADY =
  "Your rankings held steady — nothing needs you this week.";

/** Entries worth showing first: everything that moved, improvements on top. */
function movedEntries(digest: Digest): DigestEntry[] {
  const order: Record<DigestDirection, number> = {
    up: 0,
    new: 1,
    down: 2,
    lost: 3,
    same: 4,
  };
  return digest.entries
    .filter((e) => e.direction !== "same")
    .sort((a, b) => order[a.direction] - order[b.direction]);
}

/**
 * First-run coverage: how many tracked keywords returned a rank at all, and the
 * best (lowest) of them. This is the honest headline for a baseline — "found
 * for 3 of 5" is a real measurement, where "▲ #64" is a movement claim we
 * cannot make without a prior snapshot.
 */
function coverage(digest: Digest): { ranked: number; total: number; best: DigestEntry | null } {
  const rankedEntries = digest.entries.filter((e) => e.current !== null);
  const best = rankedEntries.reduce<DigestEntry | null>(
    (acc, e) => (acc === null || e.current! < acc.current! ? e : acc),
    null,
  );
  return { ranked: rankedEntries.length, total: digest.entries.length, best };
}

// ── card fragments (each returns "" when its data is absent) ─────────────────

const CHIP =
  "display:inline-block;font:500 11px/1 -apple-system,Segoe UI,Roboto,sans-serif;" +
  "color:#97a1b6;background:#171c26;border-radius:4px;padding:5px 9px;margin:0 5px 5px 0";

/** Icon + app name + developer/version. */
function identityRow(appName: string, card: DigestCard): string {
  const icon = card.iconUrl
    ? `<img src="${escapeHtml(card.iconUrl)}" width="44" height="44" alt="${appName} app icon" ` +
      `style="width:44px;height:44px;border-radius:10px;display:block;border:1px solid #222a3b">`
    : "";
  const sub = [card.developer, card.version ? `v${card.version}` : ""]
    .filter(Boolean)
    .map((s) => escapeHtml(String(s)))
    .join(" · ");
  if (!icon && !sub) return "";
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr>` +
    (icon ? `<td style="padding-right:12px;vertical-align:middle">${icon}</td>` : "") +
    `<td style="vertical-align:middle">` +
    `<div style="font:600 16px/1.2 Georgia,serif;color:#eef1f7">${appName}</div>` +
    (sub
      ? `<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#828ca3;margin-top:3px">${sub}</div>`
      : "") +
    `</td></tr></table>`
  );
}

/** Category / price / rating chips. */
function chipRow(card: DigestCard): string {
  const chips: string[] = [];
  if (card.category) chips.push(escapeHtml(card.category));
  if (card.price) chips.push(escapeHtml(card.price));
  if (card.rating) {
    chips.push(`${card.rating.average.toFixed(1)} ★ (${card.rating.count})`);
  }
  if (!chips.length) return "";
  return `<div style="margin:0 0 16px">${chips
    .map((c) => `<span style="${CHIP}">${c}</span>`)
    .join("")}</div>`;
}

/** One tile per audit grade. */
function gradeRow(card: DigestCard): string {
  const grades = card.grades ?? [];
  if (!grades.length) return "";
  const cells = grades
    .map(
      (g) =>
        `<td style="padding:10px 8px;background:#171c26;border-radius:6px;text-align:center">` +
        `<div style="font:500 10px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#828ca3;` +
        `letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px">${escapeHtml(g.label)}</div>` +
        `<div style="font:600 19px/1 Georgia,serif;color:#eef1f7">${escapeHtml(g.grade)}</div></td>`,
    )
    .join(`<td style="width:8px"></td>`);
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="margin:16px 0 0;table-layout:fixed"><tr>${cells}</tr></table>`
  );
}

/** Screenshot strip, capped at MAX_STRIP. */
function screenshotStrip(appName: string, card: DigestCard): string {
  const shots = (card.screenshotUrls ?? []).slice(0, MAX_STRIP);
  if (!shots.length) return "";
  const cells = shots
    .map(
      (u, i) =>
        `<td style="padding-right:6px"><img src="${escapeHtml(u)}" width="86" ` +
        `alt="${appName} screenshot ${i + 1}" ` +
        `style="width:86px;border-radius:6px;display:block;border:1px solid #222a3b"></td>`,
    )
    .join("");
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" ` +
    `style="margin:16px 0 0"><tr>${cells}</tr></table>`
  );
}

export function renderDigestText(digest: Digest, opts: RenderOpts): string {
  const lines: string[] = [];
  const moved = movedEntries(digest);

  if (digest.isFirstRun) {
    const { ranked, total, best } = coverage(digest);
    lines.push(`Starting position for ${opts.appName}`);
    lines.push("");
    lines.push(`Found for ${ranked} of ${total} keywords tracked.`);
    if (best) lines.push(`Best rank: #${best.current} for "${best.keyword}".`);
    lines.push("");
    lines.push("This is your baseline — next week's report compares against it.");
    lines.push("");
    if (opts.hasPendingApproval) {
      lines.push(`A new optimization is waiting for your approval -> ${opts.dashboardUrl}`);
    } else {
      lines.push(`See the full picture in your dashboard -> ${opts.dashboardUrl}`);
    }
    const recorded = recordedLine(opts);
    if (recorded) {
      lines.push("");
      lines.push(recorded);
    }
    if (opts.unsubscribeUrl) {
      lines.push("");
      lines.push(`Stop this weekly digest (for every app on this account): ${opts.unsubscribeUrl}`);
      lines.push("ShipASO keeps working either way - runs still open in your dashboard.");
    }
    return lines.join("\n");
  }

  lines.push(`What moved this week for ${opts.appName}`);
  lines.push("");

  if (!digest.anyMovement || moved.length === 0) {
    lines.push(HELD_STEADY);
  } else {
    if (digest.topMover) {
      lines.push(`Top mover: ${describeEntry(digest.topMover)}`);
      lines.push("");
    }
    for (const e of moved) lines.push(`- ${describeEntry(e)}`);
  }

  lines.push("");
  if (opts.hasPendingApproval) {
    lines.push(`A new optimization is waiting for your approval -> ${opts.dashboardUrl}`);
  } else {
    lines.push(`See the full trend in your dashboard -> ${opts.dashboardUrl}`);
  }
  const recorded = recordedLine(opts);
  if (recorded) {
    lines.push("");
    lines.push(recorded);
  }

  if (opts.unsubscribeUrl) {
    lines.push("");
    lines.push(`Stop this weekly digest (for every app on this account): ${opts.unsubscribeUrl}`);
    lines.push("ShipASO keeps working either way - runs still open in your dashboard.");
  }

  return lines.join("\n");
}

/**
 * A branded, share-worthy weekly digest. Inline styles only (email clients strip
 * <style>), dark ShipASO palette, and a visual "rank moved" hero so a screenshot
 * of the email reads as a real result — the thing people post. Still exactly one
 * dashboard CTA (no link clutter). Falls back to an honest held-steady card.
 */
export function renderDigestHtml(digest: Digest, opts: RenderOpts): string {
  const appName = escapeHtml(opts.appName);
  const url = escapeHtml(opts.dashboardUrl);
  const SIGNAL = "#34d399";
  const moved = movedEntries(digest);

  // ── hero: the top mover as a big before→after, or the held-steady note ──
  //
  // A FIRST RUN has no "before" — every entry classifies as "new". Rendering
  // that with the movement arrow + signal green reads as a win the data does
  // not support, so a baseline gets its own neutral hero: coverage first (a
  // real measurement), the best starting rank in plain white, no arrow.
  let hero: string;
  if (digest.isFirstRun) {
    const { ranked, total, best } = coverage(digest);
    const bestLine = best
      ? `<div style="font:600 34px/1 Georgia,serif;color:#eef1f7;margin:0 0 6px">#${best.current}` +
        `<span style="font:14px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#97a1b6;margin-left:10px">${escapeHtml(best.keyword)}</span></div>`
      : `<div style="font:600 34px/1 Georgia,serif;color:#eef1f7;margin:0 0 6px">—</div>`;
    hero =
      `<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#97a1b6;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px">Baseline · found for ${ranked} of ${total} keywords</div>` +
      `<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#97a1b6;margin:0 0 6px">Best rank</div>` +
      bestLine +
      `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#828ca3;margin:10px 0 0">This is your starting position — next week's report compares against it.</div>`;
  } else if (digest.anyMovement && digest.topMover) {
    const m = digest.topMover;
    const cur = m.current === null ? "—" : `#${m.current}`;
    const prev = m.previous === null ? "—" : `#${m.previous}`;
    const arrow = m.direction === "up" || m.direction === "new" ? "▲" : m.direction === "down" || m.direction === "lost" ? "▼" : "→";
    const heroColor = m.direction === "up" || m.direction === "new" ? SIGNAL : m.direction === "same" ? "#97a1b6" : "#f87171";
    hero =
      `<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#97a1b6;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px">Top mover · ${escapeHtml(m.keyword)}</div>` +
      `<div style="font:600 34px/1 Georgia,serif;color:#eef1f7;margin:0 0 6px">${prev} <span style="color:${heroColor}">${arrow} ${cur}</span></div>`;
  } else {
    hero =
      `<div style="font:600 22px/1.3 Georgia,serif;color:#eef1f7;margin:0 0 4px">Held steady this week</div>` +
      `<div style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#97a1b6">${escapeHtml(HELD_STEADY)}</div>`;
  }

  // ── the rest of the moves (skip the one already shown as the hero) ──
  //
  // On a first run these rows would read "entered the top 200 at #116" — a
  // movement claim. List the other starting ranks plainly instead.
  let movesList = "";
  if (digest.isFirstRun) {
    const { best } = coverage(digest);
    const rest = digest.entries
      .filter((e) => e.current !== null && e.keyword !== best?.keyword)
      .sort((a, b) => a.current! - b.current!);
    if (rest.length) {
      const rows = rest
        .map(
          (e) =>
            `<tr><td style="padding:6px 0;border-top:1px solid #222a3b;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#97a1b6">${escapeHtml(e.keyword)}</td>` +
            `<td align="right" style="padding:6px 0;border-top:1px solid #222a3b;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#eef1f7">#${e.current}</td></tr>`,
        )
        .join("");
      movesList = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0">${rows}</table>`;
    }
  } else if (digest.anyMovement && moved.length > 0) {
    const rest = digest.topMover ? moved.filter((e) => e.keyword !== digest.topMover!.keyword) : moved;
    if (rest.length) {
      const rows = rest
        .map(
          (e) =>
            `<tr><td style="padding:6px 0;border-top:1px solid #222a3b;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#97a1b6">${escapeHtml(describeEntry(e))}</td></tr>`,
        )
        .join("");
      movesList = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0">${rows}</table>`;
    }
  }

  // The optional visual layer. An absent card yields four empty strings, so the
  // markup below is byte-identical to the text-only digest.
  const c = opts.card ?? {};
  const identity = identityRow(appName, c);
  const chips = chipRow(c);
  const grades = gradeRow(c);
  const strip = screenshotStrip(appName, c);

  // "See the full trend" is a lie on a first run — there is no trend yet.
  const ctaText = opts.hasPendingApproval
    ? "Review the pending optimization →"
    : digest.isFirstRun
      ? "See the full picture →"
      : "See the full trend →";
  const ctaNote = opts.hasPendingApproval
    ? `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#97a1b6;margin:0 0 14px">A new optimization is ready and waiting for your approval.</div>`
    : "";
  // #493: the detected runs' output, said out loud. Same wording as the text.
  const recordedText = recordedLine(opts);
  const recordedNote = recordedText
    ? `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#97a1b6;margin:0 0 14px">${escapeHtml(recordedText.replace(/ -> .*$/, ""))} <a href="${opts.dashboardUrl}" style="color:#34d399">They are in your dashboard →</a></div>`
    : "";

  return [
    `<div style="background:#07090e;padding:28px 16px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">`,
    `<div style="max-width:520px;margin:0 auto;background:#11151f;border:1px solid #222a3b;border-radius:14px;overflow:hidden">`,
    // brand bar
    `<div style="padding:16px 22px;border-bottom:1px solid #1a2130">`,
    `<span style="font:700 15px/1 'JetBrains Mono',ui-monospace,monospace;color:#eef1f7;letter-spacing:-.3px">ShipASO</span>`,
    `<span style="font:12px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#828ca3;margin-left:8px">weekly rank report · ${appName}</span>`,
    `</div>`,
    // hero
    // card: identity + chips above the hero; grades + screenshots below it.
    // Each fragment is "" when its data is absent, so an empty card collapses
    // to exactly the previous text-only layout.
    `<div style="padding:24px 22px 8px">${identity}${chips}${hero}${movesList}${grades}${strip}</div>`,
    // CTA
    `<div style="padding:8px 22px 24px">`,
    ctaNote,
    recordedNote,
    `<a href="${url}" style="display:inline-block;background:${SIGNAL};color:#04140d;text-decoration:none;font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif;padding:12px 20px;border-radius:10px">${ctaText}</a>`,
    `</div>`,
    `</div>`,
    `<div style="max-width:520px;margin:14px auto 0;font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#828ca3;text-align:center">ShipASO ran the loop on real rank data — we never hold your store credentials.</div>`,
    ...(opts.unsubscribeUrl
      ? [
          `<div style="max-width:520px;margin:8px auto 0;font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#828ca3;text-align:center"><a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#828ca3;text-decoration:underline">Stop this weekly digest</a> — ShipASO keeps working either way.</div>`,
        ]
      : []),
    `</div>`,
  ].join("");
}

// ── planning: who gets a digest, and the composed message ─────────────────────

/** Everything the planner needs about one app to decide + compose its digest. */
export type DigestAppInput = {
  appId: string;
  appName: string;
  email: string;
  tier: Tier;
  hasPendingApproval: boolean;
  /** Proposals recorded by this week's `detected` runs (#493); absent → no line. */
  recordedProposals?: RecordedProposals | undefined;
  /** flat RankSnapshotRow[] for this app, as getRankHistory returns it. */
  rankHistory: RankSnapshotRow[];
  /** optional visual card from the public listing; absent → text-only digest. */
  card?: DigestCard | undefined;
  /** per-recipient unsubscribe URL (minted by the cron; absent → no footer/headers). */
  unsubscribeUrl?: string | undefined;
};

/** Only the paid tiers pay for standing autonomy → only they get a digest. */
function digestEligible(tier: Tier): boolean {
  return tier === "indie" || tier === "startup" || tier === "scale";
}

/**
 * PURE: turn the swept apps into the list of digest emails to send. Gates on tier
 * (indie/startup/scale only), builds each digest from its rank history, and composes
 * subject/html/text. No DB, no network — the caller (the cron) does the I/O. An
 * eligible app is ALWAYS emailed, even with no movement (the held-steady line),
 * because the weekly touch is the retention mechanism.
 */
export function planDigests(
  apps: DigestAppInput[],
  opts: { dashboardUrl: string },
): EmailMessage[] {
  const messages: EmailMessage[] = [];
  for (const app of apps) {
    if (!digestEligible(app.tier)) continue;
    const digest = buildDigest(app.rankHistory, { appName: app.appName });
    const renderOpts: RenderOpts = {
      appName: app.appName,
      dashboardUrl: opts.dashboardUrl,
      hasPendingApproval: app.hasPendingApproval,
      recordedProposals: app.recordedProposals,
      unsubscribeUrl: app.unsubscribeUrl,
      card: app.card,
    };
    const mover = digest.topMover ? ` — ${describeEntry(digest.topMover)}` : "";
    const subject = digest.anyMovement
      ? `${app.appName}: what moved this week${mover}`
      : `${app.appName}: held steady this week`;
    messages.push({
      to: app.email,
      subject,
      html: renderDigestHtml(digest, renderOpts),
      text: renderDigestText(digest, renderOpts),
      // RFC 8058 one-click headers — only when we can build a real URL.
      ...(app.unsubscribeUrl
        ? {
            headers: {
              "List-Unsubscribe": `<${app.unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    });
  }
  return messages;
}

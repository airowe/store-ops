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
};

export type BuildDigestOpts = { appName: string };

export type RenderOpts = {
  appName: string;
  dashboardUrl: string;
  hasPendingApproval: boolean;
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

  return { appName: opts.appName, entries, topMover, anyMovement };
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

export function renderDigestText(digest: Digest, opts: RenderOpts): string {
  const lines: string[] = [];
  lines.push(`What moved this week for ${opts.appName}`);
  lines.push("");

  const moved = movedEntries(digest);
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
  let hero: string;
  if (digest.anyMovement && digest.topMover) {
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
  let movesList = "";
  if (digest.anyMovement && moved.length > 0) {
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

  const ctaText = opts.hasPendingApproval
    ? "Review the pending optimization →"
    : "See the full trend →";
  const ctaNote = opts.hasPendingApproval
    ? `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#97a1b6;margin:0 0 14px">A new optimization is ready and waiting for your approval.</div>`
    : "";

  return [
    `<div style="background:#07090e;padding:28px 16px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">`,
    `<div style="max-width:520px;margin:0 auto;background:#11151f;border:1px solid #222a3b;border-radius:14px;overflow:hidden">`,
    // brand bar
    `<div style="padding:16px 22px;border-bottom:1px solid #1a2130">`,
    `<span style="font:700 15px/1 'JetBrains Mono',ui-monospace,monospace;color:#eef1f7;letter-spacing:-.3px">ShipASO</span>`,
    `<span style="font:12px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#626c83;margin-left:8px">weekly rank report · ${appName}</span>`,
    `</div>`,
    // hero
    `<div style="padding:24px 22px 8px">${hero}${movesList}</div>`,
    // CTA
    `<div style="padding:8px 22px 24px">`,
    ctaNote,
    `<a href="${url}" style="display:inline-block;background:${SIGNAL};color:#04140d;text-decoration:none;font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif;padding:12px 20px;border-radius:10px">${ctaText}</a>`,
    `</div>`,
    `</div>`,
    `<div style="max-width:520px;margin:14px auto 0;font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#626c83;text-align:center">ShipASO ran the loop on real rank data — we never hold your store credentials.</div>`,
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
  /** flat RankSnapshotRow[] for this app, as getRankHistory returns it. */
  rankHistory: RankSnapshotRow[];
};

/** Only the recurring tiers pay for standing autonomy → only they get a digest. */
function digestEligible(tier: Tier): boolean {
  return tier === "autopilot" || tier === "fleet";
}

/**
 * PURE: turn the swept apps into the list of digest emails to send. Gates on tier
 * (autopilot/fleet only), builds each digest from its rank history, and composes
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
    });
  }
  return messages;
}

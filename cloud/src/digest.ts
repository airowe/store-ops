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

export function renderDigestHtml(digest: Digest, opts: RenderOpts): string {
  const appName = escapeHtml(opts.appName);
  const url = escapeHtml(opts.dashboardUrl);
  const parts: string[] = [];

  parts.push(`<h2>What moved this week for ${appName}</h2>`);

  const moved = movedEntries(digest);
  if (!digest.anyMovement || moved.length === 0) {
    parts.push(`<p>${escapeHtml(HELD_STEADY)}</p>`);
  } else {
    if (digest.topMover) {
      parts.push(`<p><strong>Top mover:</strong> ${escapeHtml(describeEntry(digest.topMover))}</p>`);
    }
    parts.push("<ul>");
    for (const e of moved) parts.push(`<li>${escapeHtml(describeEntry(e))}</li>`);
    parts.push("</ul>");
  }

  if (opts.hasPendingApproval) {
    parts.push(
      `<p>A new optimization is waiting for your approval -> ` +
        `<a href="${url}">${url}</a></p>`,
    );
  } else {
    parts.push(`<p><a href="${url}">See the full trend in your dashboard</a></p>`);
  }

  return parts.join("");
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

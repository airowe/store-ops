/**
 * Rank-timeline annotations (#62, T1) — "what changed → what moved", built
 * ONLY from time-series we already persist: your own APPROVED pushes
 * (approvals + run traces) and competitors' VISIBLE listing diffs between
 * consecutive competitor_snapshots. No new data source, no new ASC read.
 *
 * HONESTY LIMITS (rendered verbatim by the UI):
 *   • annotations are CORRELATIONAL markers ("after X, rank moved") — never a
 *     causal claim; the same posture as rankAttribution.ts,
 *   • competitor visibility is PARTIAL: name/version/rating only — their
 *     subtitle/keyword field is a public-API blind spot,
 *   • history exists only for what WE'VE been tracking — no retroactive
 *     backfill (Apple has no historical rank API),
 *   • a competitor's FIRST snapshot is a baseline, not a change — it never
 *     yields a marker.
 *
 * Pure + deterministic: same input → identical output. No fetch, no Date.now.
 */

export type RankAnnotation = {
  /** ISO-ish timestamp (matches the snapshot/approval timestamps it came from). */
  at: string;
  kind: "push" | "competitor";
  /** short human line, e.g. "You shipped metadata" / "Rival: version 1.2 → 1.3". */
  label: string;
  /** push annotations link back to the run. */
  runId?: string;
};

export type CompetitorSnapshotRow = {
  comp_id: string;
  name: string;
  version: string;
  rating: string;
  seen_at: string;
};

/** The visible fields we can honestly diff between competitor snapshots. */
const VISIBLE_FIELDS = ["name", "version", "rating"] as const;

/** Cap so a long-history app can't flood the chart into unreadability. */
const MAX_ANNOTATIONS = 60;

export function buildRankAnnotations(input: {
  /** the app's own approved pushes (derivePushes output — approval-stamped). */
  pushes: Array<{ runId: string; pushedAt: string }>;
  /** competitor_snapshots rows, any order (sorted internally). */
  competitorSnapshots: CompetitorSnapshotRow[];
}): RankAnnotation[] {
  const out: RankAnnotation[] = [];

  for (const p of input.pushes) {
    if (!p.pushedAt) continue;
    out.push({ at: p.pushedAt, kind: "push", label: "You shipped metadata", runId: p.runId });
  }

  // Group per competitor, sort by seen_at, diff CONSECUTIVE pairs. The first
  // snapshot is a baseline (we started watching) — never a "change" marker.
  const byComp = new Map<string, CompetitorSnapshotRow[]>();
  for (const row of input.competitorSnapshots) {
    const list = byComp.get(row.comp_id) ?? [];
    list.push(row);
    byComp.set(row.comp_id, list);
  }
  for (const rows of byComp.values()) {
    rows.sort((a, b) => a.seen_at.localeCompare(b.seen_at) || a.name.localeCompare(b.name));
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      const changes: string[] = [];
      for (const f of VISIBLE_FIELDS) {
        const was = (prev[f] ?? "").trim();
        const now = (cur[f] ?? "").trim();
        // only assert a change when BOTH sides are non-empty reads — an empty
        // side means we couldn't see the field, not that it changed.
        if (was && now && was !== now) changes.push(`${f} ${was} → ${now}`);
      }
      if (changes.length) {
        const who = cur.name || prev.name || cur.comp_id;
        out.push({ at: cur.seen_at, kind: "competitor", label: `${who}: ${changes.join(", ")}` });
      }
    }
  }

  out.sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  // keep the most RECENT markers when over the cap — the chart shows recent history
  return out.length > MAX_ANNOTATIONS ? out.slice(out.length - MAX_ANNOTATIONS) : out;
}

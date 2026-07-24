/**
 * Dashboard view-model — derives the command-center surfaces from the real
 * `getApps` list, honestly. The redesign's greeting, KPI strip, hero decision
 * card and tracked-app rows all read from THIS, so the "never fabricate a
 * number" rule lives in one tested place: a KPI we can't measure from the list
 * is `null` (rendered "—"), never a guessed value like the prototype's samples.
 *
 * Pure and framework-free (matches the shell helpers) so the derivation
 * unit-tests without React or a query client.
 */
import type { AppListItem } from "@shipaso/api";

const isAwaiting = (a: AppListItem) => a.latest_run?.status === "awaiting_approval";

/** The editorial greeting: eyebrow + headline, phrased by how many need approval. */
export function greeting(apps: AppListItem[]): { eyebrow: string; headline: string; urgent: boolean } {
  const n = apps.filter(isAwaiting).length;
  if (n === 0) {
    return { eyebrow: "All clear", headline: "Nothing needs your approval right now.", urgent: false };
  }
  const runs = n === 1 ? "1 run needs your approval" : `${n} runs need your approval`;
  const headline =
    n === 1 ? "One app is waiting on your call." : `${wordish(n)} apps are waiting on your call.`;
  return { eyebrow: runs, headline, urgent: true };
}

/** Small number → word ("Two"), capped; used only in the headline. */
function wordish(n: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  return words[n] ?? String(n);
}

export type Kpi = { label: string; value: string; sub: string | null; tone: "ink" | "signal" };

/**
 * KPI metrics derived from the list. "In top 10" counts apps whose lead rank is
 * ≤10 (measured only). "Tracked apps" is the honest count. "Best lead rank" is
 * the strongest measured lead rank across the fleet, or "—" if nothing measured.
 */
export function kpis(apps: AppListItem[]): Kpi[] {
  const measured = apps
    .map((a) => a.rank_summary?.lead_rank)
    .filter((r): r is number => typeof r === "number");
  const inTop10 = measured.filter((r) => r <= 10).length;
  const best = measured.length ? Math.min(...measured) : null;

  return [
    { label: "In top 10", value: String(inTop10), sub: `of ${apps.length} tracked`, tone: "ink" },
    { label: "Tracked apps", value: String(apps.length), sub: null, tone: "ink" },
    {
      label: "Best lead rank",
      value: best == null ? "—" : `#${best}`,
      sub: best == null ? "none measured yet" : null,
      tone: best == null ? "ink" : "signal",
    },
  ];
}

/**
 * The hero decision card's subject: the first app awaiting approval (the #1 job),
 * else the first app with any measured rank, else the first app, else null.
 */
export function heroApp(apps: AppListItem[]): AppListItem | null {
  return (
    apps.find(isAwaiting) ??
    apps.find((a) => a.rank_summary?.lead_rank != null) ??
    apps[0] ??
    null
  );
}

/** Count of runs awaiting approval — drives the nav badge, greeting, KPI card. */
export function pendingCount(apps: AppListItem[]): number {
  return apps.filter(isAwaiting).length;
}

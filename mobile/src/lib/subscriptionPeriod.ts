/**
 * Subscription duration + renewal disclosure (Guideline 3.1.2(c)).
 *
 * A price alone — "$7.00" — does not say per what, and a purchase screen that
 * shows only a price is the shape App Review cites. This turns RevenueCat's ISO
 * 8601 period into something a person reads, and builds the sentence that
 * states the subscription renews until cancelled.
 *
 * RevenueCat types `subscriptionPeriod` as `string | null`: StoreKit 1 on iOS
 * cannot always determine it, and Amazon never provides it. That null is
 * reachable in production, so it renders as ABSENCE — the repo's
 * measured-or-nothing rule applied to a compliance surface, where a guessed
 * "per month" beside a real price would misstate what the user is buying.
 */

/** ISO 8601 period units RevenueCat emits, mapped to their singular noun. */
const UNITS: Record<string, string> = { D: "day", W: "week", M: "month", Y: "year" };

/**
 * "P1M" → "month", "P3M" → "3 months". Returns null when the period is absent
 * or unparseable — the caller must then omit the clause, not guess.
 */
export function formatPeriod(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^P(\d+)([DWMY])$/i.exec(iso.trim());
  if (!m) return null;

  const count = Number(m[1]);
  // A zero-length period is not a duration; treat it as unknown rather than
  // rendering "0 months".
  if (!Number.isFinite(count) || count < 1) return null;

  const unit = UNITS[(m[2] as string).toUpperCase()];
  if (!unit) return null;

  return count === 1 ? unit : `${count} ${unit}s`;
}

/**
 * The disclosure shown beside each buy button.
 *
 * With a known period: "$7.00 per month. Renews automatically until cancelled.
 * Manage or cancel in your App Store account settings."
 *
 * Without one, the rate clause is dropped entirely — but the renewal and
 * cancellation facts are still true and still required, so they remain.
 */
export function renewalSentence(priceString: string, iso: string | null | undefined): string {
  const renewal =
    "Renews automatically until cancelled. Manage or cancel in your App Store account settings.";
  const period = formatPeriod(iso);
  if (!period) return renewal;

  // "per month" reads better than "every month"; "every 3 months" better than
  // "per 3 months".
  const rate = /^\d/.test(period) ? `every ${period}` : `per ${period}`;
  return `${priceString} ${rate}. ${renewal}`;
}

import { formatPeriod, renewalSentence } from "./subscriptionPeriod.js";

/**
 * Duration disclosure for the paywall (Guideline 3.1.2(c)).
 *
 * RevenueCat gives the period as an ISO 8601 string — "P1M", "P1Y" — and it is
 * `string | null`: StoreKit 1 on iOS cannot always determine it, and Amazon
 * never provides it. Null is a real, reachable state, so it renders as absence
 * rather than a guess. A wrong duration on a purchase screen is a
 * misrepresentation of what the user is buying, which is worse than saying
 * nothing.
 */
describe("formatPeriod", () => {
  it.each([
    ["P1W", "week"],
    ["P1M", "month"],
    ["P2M", "2 months"],
    ["P3M", "3 months"],
    ["P6M", "6 months"],
    ["P1Y", "year"],
    ["P2Y", "2 years"],
    ["P1D", "day"],
    ["P14D", "14 days"],
  ])("renders %s as %s", (iso, expected) => {
    expect(formatPeriod(iso)).toBe(expected);
  });

  it("is case-insensitive about the unit", () => {
    expect(formatPeriod("p1m")).toBe("month");
  });

  /**
   * Every one of these is "we do not know the period". Measured-or-nothing: a
   * null result makes the caller omit the clause, never invent one.
   */
  it.each([
    [null, "null — StoreKit 1 / Amazon"],
    [undefined, "undefined"],
    ["", "empty string"],
    ["1M", "missing the P prefix"],
    ["P", "no quantity or unit"],
    ["PXM", "non-numeric quantity"],
    ["P1Q", "unknown unit"],
    ["P0M", "zero-length period"],
    ["garbage", "not ISO 8601 at all"],
  ])("returns null for %s (%s)", (input: string | null | undefined, _why: string) => {
    expect(formatPeriod(input)).toBeNull();
  });
});

/**
 * The auto-renewal sentence. Apple requires the user to know the subscription
 * renews until cancelled and where to manage it, BEFORE they buy.
 */
describe("renewalSentence", () => {
  it("names the price and the period when both are known", () => {
    expect(renewalSentence("$7.00", "P1M")).toBe(
      "$7.00 per month. Renews automatically until cancelled. Manage or cancel in your App Store account settings.",
    );
  });

  it("uses the plural form for a multi-unit period", () => {
    expect(renewalSentence("$18.00", "P3M")).toBe(
      "$18.00 every 3 months. Renews automatically until cancelled. Manage or cancel in your App Store account settings.",
    );
  });

  /**
   * Unknown period ⇒ drop the rate clause entirely rather than guess "per
   * month". The renewal and cancellation facts are still true and still
   * required, so they stay.
   */
  it("omits the rate when the period is unknown, keeping the renewal facts", () => {
    expect(renewalSentence("$7.00", null)).toBe(
      "Renews automatically until cancelled. Manage or cancel in your App Store account settings.",
    );
  });

  it("never invents a period", () => {
    const sentence = renewalSentence("$7.00", null);
    expect(sentence).not.toMatch(/month|year|week|day/i);
  });
});

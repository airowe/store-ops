/**
 * Terms of Use (EULA) — the ASC "Terms of Use" URL and the paywall's Terms link
 * both point here.
 *
 * This page is a REVIEW REQUIREMENT. Apple requires functional Terms and Privacy
 * links on any screen selling an auto-renewable subscription (3.1.2), and
 * ShipASO 0.1.0 was already rejected under 2.1(a) for a link that 404'd — so a
 * missing or dead Terms page is a known, repeated rejection cause.
 *
 * Prices here MUST match docs/landing/pricing.md (the source the pricing-parity
 * guard enforces). The renewal sentence deliberately mirrors the paywall's
 * `renewalSentence()` wording so a subscriber reads the same terms in both
 * places.
 */
export function TermsView() {
  return (
    <section>
      <h1>Terms of Use</h1>
      <p className="muted" data-testid="terms-effective">Effective 2026-08-09.</p>

      <p>
        These terms cover your use of ShipASO — the app, the website, and the
        hosted agent. By subscribing you agree to them.
      </p>

      <h2>What ShipASO does</h2>
      <p data-testid="terms-approval">
        ShipASO audits your App Store and Google Play listings, researches
        keywords, and prepares metadata changes. It <b>never publishes to a
        store on its own</b>: every change waits for you to approve it, and
        approving is not shipping. You remain responsible for what you submit to
        Apple or Google, and for complying with their guidelines.
      </p>

      <h2>Subscriptions and pricing</h2>
      <p data-testid="terms-tiers">
        ShipASO is free to use for a single app with manual runs. Paid tiers add
        more apps and scheduled autonomous runs: <b>Indie $7/month</b> (3 apps),{" "}
        <b>Startup $19/month</b> (10 apps), and <b>Scale $65/month</b> (50 apps).
      </p>
      <p data-testid="terms-renewal">
        Subscriptions renew automatically at the end of each period until
        cancelled. You can cancel any time — at least 24 hours before the period
        ends — in your App Store account settings. Cancelling stops the next
        renewal; it does not shorten the period you have already paid for.
      </p>
      <p data-testid="terms-billing">
        Purchases made in the iOS app are billed by Apple through your{" "}
        <b>App Store</b> account, and refunds are handled by Apple under its
        policies — we cannot issue them on Apple's behalf. Subscriptions bought
        on the web are billed separately by our payment processor. Buying on one
        does not duplicate the other: a web subscriber sees a read-only status in
        the app rather than a second charge.
      </p>

      <h2>Measured or absent</h2>
      <p data-testid="terms-honesty">
        Every number ShipASO shows is <b>measured</b> or explicitly marked
        unmeasured (“—”). We do not estimate ranks, downloads, or revenue and
        present them as facts. This means a new account, or one whose data has
        not been collected yet, will legitimately show blanks. We make no promise
        that any particular ranking, download count, or revenue outcome will
        result from using ShipASO — store algorithms are outside our control.
      </p>

      <h2>Your store credentials</h2>
      <p>
        You are responsible for the App Store Connect and Google Play credentials
        you supply and for having the rights to use them. They are transient: we
        use them to perform the action you asked for and never store them. See
        the <a href="/privacy">Privacy Policy</a> for details.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don't use ShipASO to violate the App Store Review Guidelines or Google
        Play Developer Program Policies, to manipulate reviews or rankings
        fraudulently, or to work on listings you are not authorised to manage. We
        may suspend accounts that do.
      </p>

      <h2>Changes and termination</h2>
      <p>
        We may update these terms; material changes will be reflected in the
        effective date above. You can stop using ShipASO at any time by
        cancelling your subscription and deleting your account.
      </p>

      <h2>Contact</h2>
      <p data-testid="terms-contact">
        Questions about these terms? Email{" "}
        <a href="mailto:support@shipaso.com">support@shipaso.com</a>.
      </p>
    </section>
  );
}

/**
 * Support page — the address Apple checks during review (Guideline 1.5) and the
 * first place a stuck user lands. Every answer here is one we can actually keep:
 * a real mailbox, a response window we control, and the two questions the
 * product's own invariants generate (why a number is blank, and why approving
 * did not ship anything). Static content — the ASC Support URL points here.
 */
export function SupportView() {
  return (
    <section>
      <h1>Support</h1>
      <p className="muted">
        Something not working, or not making sense? Write to us — a person reads
        every message.
      </p>

      <h2>Contact</h2>
      <p data-testid="support-contact">
        Email <a href="mailto:support@shipaso.com">support@shipaso.com</a>.
      </p>
      <p data-testid="support-response" className="muted">
        We reply within one business day. If you are writing about a failed
        sign-in, say which email address you used and we can look it up.
      </p>

      <h2>I can’t sign in</h2>
      <p data-testid="support-signin">
        ShipASO has no passwords. Enter your email on the sign-in screen and we
        send a magic link that signs you in when you tap it. The link is valid
        for 15 minutes — if it expires, request a fresh one. If the email has not
        arrived after a minute or two, check spam, then write to us.
      </p>

      <h2>Approving a change does not ship it</h2>
      <p data-testid="support-approval">
        ShipASO never pushes anything to the App Store or Google Play on your
        behalf. Approving a recommendation records your decision and prepares the
        change; submitting it to the store stays your action, in your account.
        Nothing you do here reaches your live listing on its own.
      </p>

      <h2>Why is a number blank?</h2>
      <p data-testid="support-measured">
        A dash (—) means we have not measured that value yet, not that it is
        zero. We would rather show you nothing than a guess, so a field stays
        blank until there is real data behind it. Ranks fill in once a run
        completes for that keyword and storefront.
      </p>

      <h2>Billing and subscriptions</h2>
      <p data-testid="support-billing">
        Subscriptions are billed by Apple, not by us. To view, change, or cancel
        one, open the Settings app on your device, tap your name, then
        Subscriptions. Refunds are handled by Apple through{" "}
        <a href="https://reportaproblem.apple.com">reportaproblem.apple.com</a>.
        Write to us if something looks wrong and we will help you sort it out.
      </p>

      <h2>Deleting your account</h2>
      <p data-testid="support-delete">
        Email us from the address on the account and we will delete it, along
        with the audit history attached to it, within seven days.
      </p>

      <h2>Also useful</h2>
      <p data-testid="support-legal">
        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms</a>
      </p>
    </section>
  );
}

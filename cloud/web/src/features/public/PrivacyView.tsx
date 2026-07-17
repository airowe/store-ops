/**
 * Privacy policy — the honest, minimal truth about what ShipASO collects. Sourced
 * from the same facts as the App Privacy declaration (submission-prep §3) so the
 * two can never drift: email for magic-link sign-in, no tracking, and Store/API
 * credentials treated as transient inputs that are never persisted. Static
 * content — the ASC Privacy Policy URL points here.
 */
export function PrivacyView() {
  return (
    <section>
      <h1>Privacy Policy</h1>
      <p className="muted" data-testid="privacy-effective">Effective 2026-07-17.</p>

      <p>
        ShipASO is built to collect as little as possible. This policy describes
        exactly what we handle and why.
      </p>

      <h2>What we collect</h2>
      <p data-testid="privacy-data-collected">
        The only personal data we collect is your <b>email address</b>, used to
        send you a one-time magic-link for sign-in (app functionality). It is
        linked to your account and is <b>never</b> used for tracking or
        advertising.
      </p>

      <h2>What we don’t do</h2>
      <p data-testid="privacy-no-tracking">
        No tracking. No ads. No third-party analytics SDKs. We do not sell or
        share your data, and we do not build advertising profiles.
      </p>

      <h2>Your App Store / Play credentials</h2>
      <p data-testid="privacy-credentials">
        To run an audit or push a change, ShipASO uses your own App Store Connect
        or Google Play credentials. These are <b>transient</b>: sent once over
        HTTPS to perform the action you asked for, and <b>never stored</b> on your
        device or on our servers.
      </p>

      <h2>On-device storage</h2>
      <p>
        The app keeps your session token in the device keychain and a cached copy
        of the last listing data you viewed (always labeled “cached”, never
        “live”). This stays on your device.
      </p>

      <h2>Contact</h2>
      <p data-testid="privacy-contact">
        Questions about this policy? Email{" "}
        <a href="mailto:support@shipaso.com">support@shipaso.com</a>.
      </p>
    </section>
  );
}

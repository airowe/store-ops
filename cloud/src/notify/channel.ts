/**
 * Channel-neutral notification delivery.
 *
 * WHY THIS EXISTS: comms today are email-shaped rather than channel-shaped —
 * `sendWeeklyDigests` reaches straight for `emailSenderForEnv`, and each pref is
 * its own boolean column on `users`. Adding SMS / Discord / Telegram / WhatsApp
 * that way means N send paths and N pref columns, and the people we're adding
 * them for (operators whose agents already live in those channels) would each
 * need a bespoke integration.
 *
 * So an EVENT is composed once, channel-neutrally, and each `Deliverer` renders
 * it into its own native shape. Email builds subject/html/text; Telegram builds
 * a markdown string; SMS builds one short line. The composer never learns about
 * transports and the transports never learn about runs.
 *
 * WHAT THIS IS NOT: a queue. Delivery is best-effort and failures are isolated
 * per-destination (the digest's existing contract) — a dead Telegram webhook
 * must never cost someone their email, and no notification is ever worth
 * failing the run that produced it.
 */

/** The kinds of thing we tell a user about. */
export type NotificationKind = "run_ready";

/**
 * A composed, channel-neutral notification.
 *
 * `title` + `body` are plain text and MUST stand alone: an SMS gets nothing
 * else. `url` is the one action — deep links vary per channel, so each deliverer
 * places it natively rather than the composer inlining it into `body`.
 *
 * `lines` is optional structured detail (field → what changed) that rich
 * channels render as a list and lean channels drop entirely. Keeping it
 * structured rather than pre-formatted is what lets one composition serve both.
 */
export type Notification = {
  kind: NotificationKind;
  title: string;
  body: string;
  url?: string;
  lines?: readonly string[];
};

/**
 * Every channel the system knows about, as a VALUE — so a route can validate
 * user input against it. `ChannelKind` is derived from this list rather than
 * declared alongside it, because two hand-maintained copies drift and the
 * drift is silent: a channel missing from the array is simply never accepted.
 */
export const CHANNEL_KINDS = ["email", "telegram"] as const;

/** Where a notification can go for one user. */
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/**
 * One user's destination on one channel — a row, not a column, because a user
 * may have several (two devices, a personal and a team Telegram chat) and
 * because a destination carries state a boolean cannot (the address itself,
 * whether it is verified, when it last failed).
 */
export type Destination = {
  channel: ChannelKind;
  /** Channel-native address: an email, a Telegram chat id. */
  address: string;
};

/** The outcome of one delivery attempt. Never throws — failure is data. */
export type DeliveryResult =
  | { ok: true; channel: ChannelKind; address: string }
  | { ok: false; channel: ChannelKind; address: string; error: string };

/**
 * A transport. One implementation per channel.
 *
 * `deliver` MUST NOT throw: a transport error is returned as `{ok:false}` so a
 * fan-out over destinations can continue. This mirrors the digest loop, which
 * already catches per-message so one bad address cannot abort a cron run.
 */
export type Deliverer = {
  readonly channel: ChannelKind;
  deliver(to: Destination, note: Notification): Promise<DeliveryResult>;
};

/**
 * Fan a notification out across destinations, isolating failures.
 *
 * Returns one result per destination in input order, so a caller can log or
 * count precisely what happened. Unknown channels are reported, never silently
 * dropped — a destination nobody can deliver to is a configuration bug worth
 * surfacing, not an absence.
 */
export async function deliverAll(
  note: Notification,
  destinations: readonly Destination[],
  deliverers: readonly Deliverer[],
): Promise<DeliveryResult[]> {
  const byChannel = new Map(deliverers.map((d) => [d.channel, d]));
  const results: DeliveryResult[] = [];
  for (const to of destinations) {
    const deliverer = byChannel.get(to.channel);
    if (!deliverer) {
      // Surfaced, not swallowed: a destination with no transport is a config
      // bug (a channel enabled without its credentials), and a silent drop
      // would look exactly like a user who chose to hear nothing.
      results.push({
        ok: false,
        channel: to.channel,
        address: to.address,
        error: `no deliverer configured for channel "${to.channel}"`,
      });
      continue;
    }
    try {
      results.push(await deliverer.deliver(to, note));
    } catch (e) {
      // A Deliverer is contracted not to throw, but a transport SDK can. One
      // channel's bug must never deny another channel its delivery, and no
      // notification is worth failing the run that produced it.
      results.push({
        ok: false,
        channel: to.channel,
        address: to.address,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

/**
 * Where a run-ready notification goes — the channels your agent already lives
 * in, Telegram today.
 *
 * Honest, load-bearing: a destination has FOUR meaningfully different states,
 * and collapsing them into "connected" would tell someone they will be
 * notified when they will not be.
 *   • unverified — linked, but nobody has proven they control it. Never
 *     delivered to. This is the one a green tick would lie about.
 *   • muted     — proven, but the person turned it off. Muting deliberately
 *     does not cost the proof.
 *   • failing   — proven and enabled, but the last send failed. Telegram's own
 *     reason is shown verbatim ("bot was blocked by the user" is actionable;
 *     "delivery failed" is not).
 *   • live      — proven, enabled, nothing wrong.
 *
 * Verification is a deep link rather than a code you type: opening
 * t.me/BOT?start=… makes the bot hear from YOUR chat, and arriving from the
 * chat is the proof. The link is single-use and expires, because it lands in a
 * chat log where replay is the realistic risk.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, ChannelKind, NotificationChannel } from "@shipaso/api";
import { getChannels, linkChannel, removeChannel, setChannelEnabled } from "@shipaso/api";

type ChannelState = "unverified" | "muted" | "failing" | "live";

/**
 * The state to SHOW. Order matters and is the honesty rule: unverified beats
 * everything, because an unproven destination receives nothing no matter what
 * else is true of it.
 */
export function channelState(c: NotificationChannel): ChannelState {
  if (!c.verified) return "unverified";
  if (!c.enabled) return "muted";
  if (c.lastError && c.lastFailedAt) return "failing";
  return "live";
}

const STATE_LABEL: Record<ChannelState, string> = {
  unverified: "Not verified — waiting for you to open the link",
  muted: "Muted — verified, but nothing is sent here",
  failing: "Last delivery failed",
  live: "Verified — run alerts are delivered here",
};

export function ChannelsCard({ client }: { client: ApiClient }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["channels"], queryFn: () => getChannels(client), retry: false });
  const [link, setLink] = useState<{ url: string; expiresInSeconds: number } | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["channels"] });

  const mint = useMutation({
    mutationFn: (channel: ChannelKind) => linkChannel(client, channel),
    onSuccess: (l) => {
      setLink({ url: l.url, expiresInSeconds: l.expiresInSeconds });
      refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (v: { c: NotificationChannel; enabled: boolean }) =>
      setChannelEnabled(client, v.c.channel, v.c.address, v.enabled),
    onSuccess: refresh,
  });
  const drop = useMutation({
    mutationFn: (c: NotificationChannel) => removeChannel(client, c.channel, c.address),
    onSuccess: () => {
      setLink(null);
      refresh();
    },
  });

  const data = q.data;
  // Telegram is offered only when the SERVER says it can deliver it. Offering a
  // channel whose bot is unconfigured produces a link that cannot work.
  const canTelegram = data?.available.includes("telegram") ?? false;
  // Email is excluded: it is verified by signing in, not by a link, and listing
  // it here as something to "connect" would imply otherwise.
  const rows = (data?.channels ?? []).filter((c) => c.channel !== "email");
  const busy = mint.isPending || toggle.isPending || drop.isPending;

  return (
    <section id="channels" className="settings-panel" data-testid="channels-card">
      <div className="settings-panel-head">
        <h2>Where alerts reach you</h2>
      </div>
      <p className="settings-panel-sub">
        When Autopilot prepares a proposal it stops and waits for you. Connect a channel your agent
        already lives in and the wait starts with a message, not a login.
      </p>

      {q.isError ? (
        <p className="settings-panel-sub" data-testid="channels-error">
          Couldn’t load your channels just now.
        </p>
      ) : null}

      {data && data.pendingLinks > 0 ? (
        <p className="settings-panel-sub" data-testid="channels-pending">
          {data.pendingLinks} link{data.pendingLinks === 1 ? "" : "s"} waiting to be opened.
        </p>
      ) : null}

      {rows.length === 0 && !q.isLoading ? (
        <p className="settings-panel-sub" data-testid="channels-empty">
          No channels connected — run alerts reach you by email only.
        </p>
      ) : null}

      <ul className="channel-list">
        {rows.map((c) => {
          const state = channelState(c);
          const id = `${c.channel}-${c.address}`;
          return (
            <li key={id} className="channel-row" data-testid={`channel-${id}`} data-state={state}>
              <span className="channel-row-main">
                <span className="channel-row-name">
                  {c.channel}
                  {c.label ? ` · ${c.label}` : ""}
                </span>
                <span className="channel-row-state">{STATE_LABEL[state]}</span>
                {/* Verbatim, never summarised: the reason is the actionable part. */}
                {state === "failing" && c.lastError ? (
                  <span className="channel-row-error">{c.lastError}</span>
                ) : null}
              </span>
              <span className="channel-row-actions">
                {c.verified ? (
                  <button
                    type="button"
                    className="btn ghost"
                    data-testid={`channel-toggle-${id}`}
                    disabled={busy}
                    onClick={() => toggle.mutate({ c, enabled: !c.enabled })}
                  >
                    {c.enabled ? "Mute" : "Unmute"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn ghost"
                  data-testid={`channel-remove-${id}`}
                  disabled={busy}
                  onClick={() => drop.mutate(c)}
                >
                  Remove
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {canTelegram ? (
        <div className="channel-connect">
          <button
            type="button"
            className="btn primary"
            data-testid="connect-telegram"
            disabled={busy}
            onClick={() => mint.mutate("telegram")}
          >
            {mint.isPending ? "Creating link…" : "Connect Telegram"}
          </button>
          {link ? (
            <p className="settings-panel-sub">
              <a
                className="channel-link"
                data-testid="channel-link"
                href={link.url}
                target="_blank"
                rel="noreferrer"
              >
                Open this link and press Start
              </a>{" "}
              — the chat it opens in becomes the destination. Expires in{" "}
              {Math.round(link.expiresInSeconds / 60)} minutes and works once.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

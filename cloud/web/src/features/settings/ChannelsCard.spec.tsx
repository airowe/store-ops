/**
 * The channels card — where a person connects Telegram.
 *
 * The honesty burden is unusually high here, because every state looks similar
 * and means something different: a destination can be linked-but-unverified,
 * verified, verified-but-muted, or failing. Collapsing those into "connected"
 * would tell someone they will be notified when they will not be.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChannelsCard } from "./ChannelsCard.js";

const channel = (over: Record<string, unknown> = {}) => ({
  channel: "telegram",
  address: "4242",
  label: "Phone",
  enabled: true,
  verified: true,
  lastSentAt: null,
  lastFailedAt: null,
  lastError: null,
  ...over,
});

function renderCard(
  result: Record<string, unknown>,
  post = vi.fn(async () => ({ url: "https://t.me/Bot?start=abc", code: "abc", expiresInSeconds: 900 })),
) {
  const client = {
    get: vi.fn(async () => result),
    post,
    request: vi.fn(async () => ({ removed: true })),
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ChannelsCard client={client as never} />
    </QueryClientProvider>,
  );
  return client;
}

const base = { channels: [], pendingLinks: 0, available: ["email", "telegram"] };

describe("ChannelsCard", () => {
  it("offers to connect Telegram when the deployment supports it", async () => {
    renderCard(base);
    await waitFor(() => expect(screen.getByTestId("connect-telegram")).toBeInTheDocument());
  });

  it("does NOT offer Telegram when the deployment cannot deliver it", async () => {
    renderCard({ ...base, available: ["email"] });
    await waitFor(() => expect(screen.getByTestId("channels-card")).toBeInTheDocument());
    expect(screen.queryByTestId("connect-telegram")).toBeNull();
  });

  it("shows the deep link after minting one, so the person can open it", async () => {
    renderCard(base);
    await waitFor(() => screen.getByTestId("connect-telegram"));
    fireEvent.click(screen.getByTestId("connect-telegram"));
    await waitFor(() => expect(screen.getByTestId("channel-link")).toHaveAttribute(
      "href",
      "https://t.me/Bot?start=abc",
    ));
  });

  it("says a verified, enabled destination will be notified", async () => {
    renderCard({ ...base, channels: [channel()] });
    await waitFor(() => expect(screen.getByTestId("channel-telegram-4242")).toHaveAttribute(
      "data-state",
      "live",
    ));
  });

  it("does NOT call an UNVERIFIED destination connected", async () => {
    renderCard({ ...base, channels: [channel({ verified: false })] });
    await waitFor(() => expect(screen.getByTestId("channel-telegram-4242")).toHaveAttribute(
      "data-state",
      "unverified",
    ));
    // The distinction that matters: nothing is delivered here yet.
    expect(screen.getByTestId("channel-telegram-4242")).toHaveTextContent(/not verified|waiting/i);
  });

  it("distinguishes MUTED from unverified — muting does not cost proof", async () => {
    renderCard({ ...base, channels: [channel({ enabled: false })] });
    await waitFor(() => expect(screen.getByTestId("channel-telegram-4242")).toHaveAttribute(
      "data-state",
      "muted",
    ));
  });

  it("surfaces a delivery failure verbatim rather than hiding it", async () => {
    renderCard({
      ...base,
      channels: [channel({ lastFailedAt: "2026-08-01T00:00:00Z", lastError: "bot was blocked by the user" })],
    });
    await waitFor(() =>
      expect(screen.getByTestId("channel-telegram-4242")).toHaveTextContent(/blocked by the user/),
    );
  });

  it("says a link is waiting to be opened rather than looking inert", async () => {
    renderCard({ ...base, pendingLinks: 1 });
    await waitFor(() => expect(screen.getByTestId("channels-pending")).toHaveTextContent(/waiting/i));
  });

  it("shows no pending notice when nothing is pending", async () => {
    renderCard(base);
    await waitFor(() => screen.getByTestId("channels-card"));
    expect(screen.queryByTestId("channels-pending")).toBeNull();
  });

  it("says plainly when nothing is connected — never implies coverage", async () => {
    renderCard(base);
    await waitFor(() => expect(screen.getByTestId("channels-empty")).toBeInTheDocument());
  });

  it("removes a destination", async () => {
    const client = renderCard({ ...base, channels: [channel()] });
    await waitFor(() => screen.getByTestId("channel-remove-telegram-4242"));
    fireEvent.click(screen.getByTestId("channel-remove-telegram-4242"));
    await waitFor(() => expect(client.request).toHaveBeenCalled());
  });
});

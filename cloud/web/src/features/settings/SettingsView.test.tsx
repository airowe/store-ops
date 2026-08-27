import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { SettingsView } from "./SettingsView.js";

function makeClient(overrides: { creds?: unknown } = {}) {
  const meData = { email: "me@x.com", push_run_ready: true, email_digest: "weekly", rank_cadence: "weekly" };
  const creds = overrides.creds ?? {
    enabled: true,
    credentials: [
      { id: "c1", appId: null, kind: "asc", keyId: "KID123", issuerId: "iss", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, kekVersion: 1 },
    ],
  };
  const get = vi.fn(async (path: string) => {
    if (path === "/auth/me") return meData;
    if (path === "/account/credentials") return creds;
    if (path === "/github/status") return { appConfigured: false, connected: false, repo: null };
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async (path: string, body: any) => {
    if (path === "/account/notifications") {
      return { push_run_ready: body.push_run_ready ?? meData.push_run_ready, email_digest: body.email_digest ?? meData.email_digest };
    }
    if (path === "/account/rank-cadence") return { rank_cadence: body.cadence };
    if (path === "/agent/pause") return { paused: true };
    if (path === "/agent/resume") return { paused: false };
    if (path === "/auth/logout") return { ok: true };
    throw new Error("unexpected POST " + path);
  });
  const request = vi.fn(async () => ({ deleted: true, note: "removed" }));
  return { client: { get, post, request } as unknown as ApiClient, get, post, request };
}

function renderView(client: ApiClient, onSignedOut?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsView client={client} onSignedOut={onSignedOut} />
    </QueryClientProvider>,
  );
}

describe("<SettingsView />", () => {
  it("seeds from /auth/me and shows the honesty copy", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("push-toggle")).toHaveTextContent("On"));
    expect(screen.getByText(/never what the agent does/i)).toBeInTheDocument();
    expect(screen.getByText(/Data collection — not email frequency/i)).toBeInTheDocument();
  });

  it("toggling push OFF posts push_run_ready:false and flips the label", async () => {
    const { client, post } = makeClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("push-toggle")).toHaveTextContent("On"));
    fireEvent.click(screen.getByTestId("push-toggle"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/account/notifications", { push_run_ready: false }),
    );
    await waitFor(() => expect(screen.getByTestId("push-toggle")).toHaveTextContent("Off"));
  });

  it("switching cadence to Daily calls setRankCadence('daily')", async () => {
    const { client, post } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("cadence-daily"));
    fireEvent.click(screen.getByTestId("cadence-daily"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/account/rank-cadence", { cadence: "daily" }));
  });

  it("renders stored-key METADATA and deletes via DELETE", async () => {
    const { client, request } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("delete-asc"));
    expect(screen.getByText(/ASC · KID123/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("delete-asc"));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/account/credentials/asc", { method: "DELETE" }),
    );
  });

  /**
   * #372: a key whose KEK was replaced still lists (metadata never decrypts),
   * so this panel showed it as a perfectly healthy stored key. The row must say
   * it can't be read — and must still offer Delete, because re-connecting is
   * the fix and that starts with removing the dead row.
   */
  it("marks a key the server reports as UNREADABLE, and still allows deleting it", async () => {
    const { client } = makeClient({
      creds: {
        enabled: true,
        credentials: [
          { id: "c1", appId: null, kind: "asc", keyId: "KID123", issuerId: "iss", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, kekVersion: 1, readable: false },
        ],
      },
    });
    renderView(client);
    await waitFor(() => screen.getByTestId("delete-asc"));
    const notice = screen.getByTestId("key-unreadable-asc");
    expect(notice).toHaveTextContent(/can’t be read|cannot be read/i);
    expect(notice).toHaveTextContent(/re-connect/i);
    // the row is still deletable — that is the recovery path
    expect(screen.getByTestId("delete-asc")).toBeInTheDocument();
  });

  it("a readable key shows no warning (the guard is not over-broad)", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("delete-asc"));
    expect(screen.queryByTestId("key-unreadable-asc")).not.toBeInTheDocument();
  });

  it("pausing the autonomous sweep posts /agent/pause and flips to Paused", async () => {
    const { client, post } = makeClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("pause-toggle")).toHaveTextContent("Active"));
    // The send-vs-do claim now lives on the scope pill; the subline points at it.
    expect(screen.getByTestId("autonomy-scope-pill")).toHaveTextContent(/changes what the agent does/i);
    expect(screen.getByText(/Unlike everything above, this one is not about messages/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pause-toggle"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/agent/pause"));
    await waitFor(() => expect(screen.getByTestId("pause-toggle")).toHaveTextContent("Paused"));
  });

  it("gives the send-vs-do distinction visual weight: neutral pill on Communications, amber on Autonomy", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("comms-scope-pill"));
    // Communications changes what gets SENT — neutral.
    const send = screen.getByTestId("comms-scope-pill");
    expect(send).toHaveTextContent(/CHANGES WHAT WE SEND/i);
    expect(send).toHaveClass("scope-pill");
    expect(send).not.toHaveClass("warn");
    // Autonomy changes what the AGENT DOES — amber, and the panel sits forward.
    const does = screen.getByTestId("autonomy-scope-pill");
    expect(does).toHaveTextContent(/CHANGES WHAT THE AGENT DOES/i);
    expect(does).toHaveClass("scope-pill", "warn");
    expect(screen.getByTestId("autonomy-panel")).toHaveClass("is-forward");
  });

  it("the on-this-page nav is real anchors and the autonomy dot tracks paused state", async () => {
    const { client, post } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("page-nav"));
    const nav = screen.getByTestId("page-nav");
    // Keyboard-operable by construction: real <a href="#…">, no hand-rolled handlers.
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["#comms", "#autonomy", "#connections", "#agent", "#keys", "#appearance", "#account"]);
    // Active sweep → signal dot; paused → warn dot.
    expect(screen.getByTestId("autonomy-nav-dot")).toHaveClass("is-active");
    fireEvent.click(screen.getByTestId("pause-toggle"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/agent/pause"));
    await waitFor(() => expect(screen.getByTestId("autonomy-nav-dot")).toHaveClass("is-paused"));
  });

  it("the autonomy inset is state-driven and never claims ShipASO can push", async () => {
    const { client, post } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("autonomy-inset"));
    expect(screen.getByTestId("autonomy-inset")).toHaveClass("is-active");
    expect(screen.getByText(/It never pushes\. Every run ends at your approval\./i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pause-toggle"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/agent/pause"));
    await waitFor(() => expect(screen.getByTestId("autonomy-inset")).toHaveClass("is-paused"));
  });

  it("theme is a segmented control whose active segment tracks the choice", async () => {
    const { client } = makeClient();
    renderView(client);
    await waitFor(() => screen.getByTestId("theme-dark"));
    fireEvent.click(screen.getByTestId("theme-light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByTestId("theme-light")).toHaveClass("is-on");
    expect(screen.getByTestId("theme-dark")).not.toHaveClass("is-on");
    fireEvent.click(screen.getByTestId("theme-dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByTestId("theme-dark")).toHaveClass("is-on");
  });

  /**
   * #362: "System" is the default, and choosing it hands control back to the
   * OS. Without this segment there is no way to undo an explicit choice — the
   * stored key would stay "light"/"dark" forever.
   */
  it("offers a System segment that stores 'system' and follows the OS", async () => {
    const { client } = makeClient();
    // jsdom reports no match for any query by default; make the OS say light.
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("light"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderView(client);
    await waitFor(() => screen.getByTestId("theme-system"));

    fireEvent.click(screen.getByTestId("theme-dark"));
    expect(localStorage.getItem("store-ops:theme")).toBe("dark");

    fireEvent.click(screen.getByTestId("theme-system"));
    expect(localStorage.getItem("store-ops:theme")).toBe("system");
    expect(screen.getByTestId("theme-system")).toHaveClass("is-on");
    // …and the OS's light preference now wins.
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    vi.unstubAllGlobals();
  });

  it("sign out calls logout and notifies", async () => {
    const { client, post } = makeClient();
    const onSignedOut = vi.fn();
    renderView(client, onSignedOut);
    await waitFor(() => screen.getByTestId("sign-out"));
    fireEvent.click(screen.getByTestId("sign-out"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/auth/logout"));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });
});

/**
 * SIGNED OUT — measured-or-nothing applied to settings.
 *
 * `/auth/me` answers `{authed:false}` for a signed-out visitor, which is a
 * truthy object. The view seeded from it and the `??` defaults rendered
 * "Run-ready push: On", "Weekly digest: On" and "Weekly sweep: Active" —
 * stating as fact preferences belonging to nobody. Observed in production
 * Chrome against app.shipaso.com/settings while genuinely signed out.
 *
 * Nothing leaked: the server refuses the reads. The failure is honesty, not
 * access — the page asserted measurements it had never taken, which is the
 * same class as showing 0 for an unknown rank.
 */
describe("<SettingsView /> — signed out", () => {
  function signedOutClient() {
    const get = vi.fn(async (path: string) => {
      if (path === "/auth/me") return { authed: false };
      throw new Error("unexpected GET " + path);
    });
    const post = vi.fn(async () => { throw new Error("must not write while signed out"); });
    return { client: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
  }

  it("does NOT render preference toggles it cannot have measured", async () => {
    const { client } = signedOutClient();
    renderView(client);
    await waitFor(() => expect(screen.getByTestId("settings-signed-out")).toBeInTheDocument());
    expect(screen.queryByTestId("push-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("digest-toggle")).not.toBeInTheDocument();
  });

  it("offers a way to sign in rather than a dead end", async () => {
    const { client } = signedOutClient();
    renderView(client);
    const link = await screen.findByTestId("settings-signin-link");
    expect(link).toHaveAttribute("href", "/login");
  });

  it("still renders the settings it CAN honour without a session (appearance)", async () => {
    const { client } = signedOutClient();
    renderView(client);
    // Theme is stored in the browser, not the account — it remains truthful.
    await waitFor(() => expect(screen.getByTestId("theme-system")).toBeInTheDocument());
  });
});

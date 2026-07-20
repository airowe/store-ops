import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import type { ApiClient } from "../../src/api/client.js";
import { AuthProvider } from "../../src/auth/AuthProvider.js";
import { clearToken, setToken } from "../../src/auth/session.js";
import { __setLastKnownPushToken } from "../../src/notifications/register.js";
import type { Me } from "../../src/types/api.js";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

import Settings from "./settings.js";

const ME: Me = {
  authed: true,
  via: "session",
  email: "owner@example.com",
  email_digest: "weekly",
  push_run_ready: true,
  rank_cadence: "weekly",
};

/** Fake client: /auth/me boots ME; POSTs echo a server-truth response. */
function fakeClient(
  events: string[],
  state = { email_digest: "weekly", push_run_ready: true, rank_cadence: "weekly", paused: false },
) {
  const call = async <T,>(path: string, bodyOrOpts?: unknown) => {
    if (path === "/auth/me") return { ...ME, ...state } as T;
    if (path === "/account/notifications") {
      const body = bodyOrOpts as Partial<typeof state>;
      if (body?.email_digest !== undefined) state.email_digest = body.email_digest;
      if (body?.push_run_ready !== undefined) state.push_run_ready = body.push_run_ready as boolean;
      events.push(`POST /account/notifications ${JSON.stringify(body)}`);
      return { email_digest: state.email_digest, push_run_ready: state.push_run_ready } as T;
    }
    if (path === "/account/rank-cadence") {
      const body = bodyOrOpts as { cadence: string };
      state.rank_cadence = body.cadence;
      events.push(`POST /account/rank-cadence ${body.cadence}`);
      return { rank_cadence: state.rank_cadence } as T;
    }
    if (path === "/agent/pause" || path === "/agent/resume") {
      state.paused = path === "/agent/pause";
      events.push(`POST ${path}`);
      return { paused: state.paused } as T;
    }
    if (path === "/account/push-token") {
      events.push("POST /account/push-token");
      return { registered: true } as T;
    }
    return {} as T;
  };
  return {
    get: call,
    post: call,
    request: (p: string, o?: { method?: string; body?: unknown }) => {
      events.push(`${o?.method ?? "GET"} ${p}`);
      return call(p, o?.body);
    },
  } as unknown as ApiClient;
}

function renderSettings(
  events: string[] = [],
  state = { email_digest: "weekly", push_run_ready: true, rank_cadence: "weekly", paused: false },
) {
  return render(
    <AuthProvider clientOverride={fakeClient(events, state)}>
      <Settings />
    </AuthProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  __setLastKnownPushToken(null);
  await setToken("sess-1"); // authed boot so `me` carries the prefs
});
afterEach(async () => {
  await clearToken();
});

describe("Settings screen (comms-prefs)", () => {
  it("renders all three controls with state from me, plus honest copy", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByTestId("digest-toggle")).toBeTruthy());
    expect(screen.getAllByText("On").length).toBe(2); // push + digest both boot from me
    expect(screen.getByText(/never what the agent does/i)).toBeTruthy();
    expect(screen.getByText(/the agent keeps working/i)).toBeTruthy();
    expect(screen.getByTestId("cadence-weekly")).toBeTruthy();
    expect(screen.getByTestId("sign-out")).toBeTruthy();
  });

  it("digest toggle round-trips through the server response", async () => {
    const events: string[] = [];
    renderSettings(events);
    await waitFor(() => expect(screen.getByTestId("digest-toggle")).toBeTruthy());

    fireEvent.press(screen.getByTestId("digest-toggle"));
    await waitFor(() =>
      expect(events).toContain('POST /account/notifications {"email_digest":"off"}'),
    );
  });

  it("push OFF is server-gate only (no OS interaction)", async () => {
    const events: string[] = [];
    renderSettings(events);
    await waitFor(() => expect(screen.getByTestId("push-toggle")).toBeTruthy());

    fireEvent.press(screen.getByTestId("push-toggle")); // On → Off
    await waitFor(() =>
      expect(events).toContain('POST /account/notifications {"push_run_ready":false}'),
    );
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("push ON with permission DENIED stays off with honest copy — never a lying on", async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: "denied" });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: "denied" });

    const events: string[] = [];
    renderSettings(events);
    await waitFor(() => expect(screen.getByTestId("push-toggle")).toBeTruthy());

    // Off first (server gate), then try to turn back on with denied permission.
    fireEvent.press(screen.getByTestId("push-toggle"));
    await waitFor(() => expect(events.some((e) => e.includes("push_run_ready\":false"))).toBe(true));

    fireEvent.press(screen.getByTestId("push-toggle"));
    await waitFor(() => expect(screen.getByText(/blocked for ShipASO in your OS Settings/i)).toBeTruthy());
    // the pref was never flipped back on, and no token was registered
    expect(events.some((e) => e.includes("push_run_ready\":true"))).toBe(false);
    expect(events).not.toContain("POST /account/push-token");
  });

  it("cadence picks POST the route and reflect the response", async () => {
    const events: string[] = [];
    renderSettings(events);
    await waitFor(() => expect(screen.getByTestId("cadence-daily")).toBeTruthy());

    fireEvent.press(screen.getByTestId("cadence-daily"));
    await waitFor(() => expect(events).toContain("POST /account/rank-cadence daily"));
  });

  it("shows the autonomy control booted from me, in its own agent-scoped card", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByTestId("pause-toggle")).toBeTruthy());
    // active by default (paused:false) — the toggle reads "Active"
    expect(screen.getByTestId("pause-toggle")).toHaveTextContent(/Active/);
    // the honesty line: this card changes what the AGENT does (unlike comms)
    expect(screen.getByText(/changes what the agent does/i)).toBeTruthy();
    // and it never pushes on its own
    expect(screen.getByText(/never pushes/i)).toBeTruthy();
  });

  it("pausing POSTs /agent/pause and reflects the server's paused state", async () => {
    const events: string[] = [];
    renderSettings(events);
    await waitFor(() => expect(screen.getByTestId("pause-toggle")).toHaveTextContent(/Active/));

    fireEvent.press(screen.getByTestId("pause-toggle"));
    await waitFor(() => expect(events).toContain("POST /agent/pause"));
    await waitFor(() => expect(screen.getByTestId("pause-toggle")).toHaveTextContent(/Paused/));
  });

  it("resumes from a paused boot state via /agent/resume", async () => {
    const events: string[] = [];
    renderSettings(events, { email_digest: "weekly", push_run_ready: true, rank_cadence: "weekly", paused: true });
    await waitFor(() => expect(screen.getByTestId("pause-toggle")).toHaveTextContent(/Paused/));

    fireEvent.press(screen.getByTestId("pause-toggle"));
    await waitFor(() => expect(events).toContain("POST /agent/resume"));
    await waitFor(() => expect(screen.getByTestId("pause-toggle")).toHaveTextContent(/Active/));
  });

  it("sign-out unregisters the captured device token FIRST", async () => {
    __setLastKnownPushToken("ExpoPushToken[captured]");
    const events: string[] = [];
    renderSettings(events);
    await waitFor(() => expect(screen.getByTestId("sign-out")).toBeTruthy());

    fireEvent.press(screen.getByTestId("sign-out"));
    await waitFor(() => expect(events).toContain("DELETE /account/push-token"));
  });
});

/**
 * AnalyticsCard (analytics-reports Phase 3) — the ASC enable/ingest setup.
 * Honesty + security invariants:
 *   • the .p8 trio is sent once to enable/ingest and NEVER persisted on-device
 *     (asserted: no SecureStore write is handed the credential);
 *   • the enable state message renders verbatim (admin_required / unavailable /
 *     not_requested / pending) — no fabricated success;
 *   • the Ingest action only appears once the request is pending.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiClient } from "../api/client.js";
import type { AnalyticsState, AnalyticsIngestResult } from "../types/api.js";
import { AnalyticsCard } from "./AnalyticsCard.js";

function fakeClient(enable: AnalyticsState, ingest?: AnalyticsIngestResult): { client: ApiClient; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const client = {
    get: async () => ({}),
    post: async (path: string, body?: unknown) => {
      bodies.push(body);
      return path.endsWith("/ingest") ? ingest ?? { state: "pending", message: "not ready yet" } : enable;
    },
    request: async () => ({}),
  } as unknown as ApiClient;
  return { client, bodies };
}

beforeEach(() => jest.clearAllMocks());

function fillKey() {
  fireEvent.changeText(screen.getByTestId("an-key-id"), "KEY123");
  fireEvent.changeText(screen.getByTestId("an-issuer-id"), "ISSUER123");
  fireEvent.changeText(screen.getByTestId("an-p8"), "-----BEGIN PRIVATE KEY-----");
}

describe("AnalyticsCard", () => {
  it("gates enable until the full .p8 trio is entered, sends it once, never persists it", async () => {
    const { client, bodies } = fakeClient({
      state: "pending",
      message: "Requested — Apple is preparing your report.",
      requestId: "r1",
      created: true,
    });
    render(<AnalyticsCard client={client} appId="app-1" />);
    expect(screen.getByTestId("an-enable")).toBeDisabled();

    fillKey();
    expect(screen.getByTestId("an-enable")).not.toBeDisabled();
    fireEvent.press(screen.getByTestId("an-enable"));

    await waitFor(() => expect(bodies[0]).toEqual({ p8: "-----BEGIN PRIVATE KEY-----", keyId: "KEY123", issuerId: "ISSUER123" }));
    // the credential is never written to device storage
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("renders the enable state message verbatim (admin_required — no fabricated success)", async () => {
    const { client } = fakeClient({
      state: "admin_required",
      message: "Analytics needs an Admin-role key — ask your account holder.",
    });
    render(<AnalyticsCard client={client} appId="app-1" />);
    fillKey();
    fireEvent.press(screen.getByTestId("an-enable"));
    await waitFor(() => expect(screen.getByTestId("an-state")).toHaveTextContent(/Admin-role key/));
    // not pending → no ingest affordance
    expect(screen.queryByTestId("an-ingest")).toBeNull();
  });

  it("reveals Ingest once pending, and reports the ingested rows honestly", async () => {
    const { client } = fakeClient(
      { state: "pending", message: "Requested.", requestId: "r1", created: true },
      { state: "ingested", instances: 1, rowsPersisted: 42, days: 30 },
    );
    render(<AnalyticsCard client={client} appId="app-1" />);
    fillKey();
    fireEvent.press(screen.getByTestId("an-enable"));
    await waitFor(() => expect(screen.getByTestId("an-ingest")).toBeTruthy());

    fireEvent.press(screen.getByTestId("an-ingest"));
    await waitFor(() => expect(screen.getByTestId("an-ingest-result")).toHaveTextContent(/42 rows across 30 days/));
  });
});

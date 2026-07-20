/**
 * PlayFunnelCard (analytics-reports) — the honesty invariants:
 *   • measured months render with real counts; a null count reads "—", never 0;
 *   • no GCS export yet → an honest empty-state, never a fabricated series;
 *   • the ingest service-account is sent once and NEVER persisted on-device
 *     (asserted: no SecureStore/file write is handed the credential).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiClient } from "../api/client.js";
import type { PlayFunnelSurface } from "../types/api.js";
import { PlayFunnelCard } from "./PlayFunnelCard.js";

function fakeClient(
  surface: PlayFunnelSurface,
  onIngest?: (body: unknown) => PlayFunnelSurface,
): { client: ApiClient; bodies: unknown[] } {
  const bodies: unknown[] = [];
  let current = surface;
  const client = {
    get: async () => current,
    post: async (_p: string, body?: unknown) => {
      bodies.push(body);
      if (onIngest) current = onIngest(body);
      return { ingested: 2, periods: ["2026-06", "2026-07"] };
    },
    request: async () => ({}),
  } as unknown as ApiClient;
  return { client, bodies };
}

const MEASURED: PlayFunnelSurface = {
  state: "measured",
  cadence: "monthly",
  throughPeriod: "2026-07",
  months: [
    { period: "2026-07", country: "us", visitors: 1000, acquisitions: 234, conversionRate: 0.234 },
    { period: "2026-06", country: "", visitors: null, acquisitions: null, conversionRate: null },
  ],
};

beforeEach(() => jest.clearAllMocks());

describe("PlayFunnelCard", () => {
  it("renders the measured funnel table; a null count reads '—', never 0", async () => {
    const { client } = fakeClient(MEASURED);
    render(<PlayFunnelCard client={client} appId="app-1" />);
    await waitFor(() => expect(screen.getByTestId("pf-row-2026-07-us")).toBeTruthy());
    expect(screen.getByTestId("pf-row-2026-07-us")).toHaveTextContent(/23\.4%/);
    // the all-null month shows dashes, not zeros
    const nullRow = screen.getByTestId("pf-row-2026-06-all");
    expect(nullRow).toHaveTextContent(/—/);
    expect(nullRow).not.toHaveTextContent(/\b0\b/);
  });

  it("shows an honest empty-state when no GCS export exists (no fabricated series)", async () => {
    const { client } = fakeClient({ state: "empty", cadence: "monthly", throughPeriod: null, months: [] });
    render(<PlayFunnelCard client={client} appId="app-1" />);
    await waitFor(() => expect(screen.getByTestId("pf-empty")).toBeTruthy());
    expect(screen.queryByTestId("pf-table")).toBeNull();
  });

  it("ingests from a pasted service account, sending it once and NEVER persisting it", async () => {
    const { client, bodies } = fakeClient(
      { state: "empty", cadence: "monthly", throughPeriod: null, months: [] },
      () => MEASURED,
    );
    render(<PlayFunnelCard client={client} appId="app-1" />);
    await waitFor(() => expect(screen.getByTestId("pf-empty")).toBeTruthy());

    fireEvent.changeText(screen.getByTestId("pf-package"), "com.acme.app");
    fireEvent.changeText(screen.getByTestId("pf-account"), "1234567890");
    fireEvent.changeText(screen.getByTestId("pf-sa"), '{"type":"service_account"}');
    fireEvent.press(screen.getByTestId("pf-ingest"));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      packageName: "com.acme.app",
      accountId: "1234567890",
      serviceAccount: '{"type":"service_account"}',
    });
    // the credential is never written to device storage
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("pf-success")).toHaveTextContent(/2 row/));
  });
});

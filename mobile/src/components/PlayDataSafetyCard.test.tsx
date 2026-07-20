/**
 * PlayDataSafetyCard (Play) — the honesty + security invariants:
 *   • the push needs an EXPLICIT confirmation (it changes a live Play listing);
 *   • the service account is sent once and NEVER persisted on-device;
 *   • the CSV the owner pastes is their own declaration, pushed verbatim.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiClient } from "../api/client.js";
import { PlayDataSafetyCard } from "./PlayDataSafetyCard.js";

function fakeClient(): { client: ApiClient; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const client = {
    get: async () => ({}),
    post: async (_p: string, body?: unknown) => {
      bodies.push(body);
      return { packageName: "com.acme.app", pushed: true };
    },
    request: async () => ({}),
  } as unknown as ApiClient;
  return { client, bodies };
}

beforeEach(() => jest.clearAllMocks());

describe("PlayDataSafetyCard", () => {
  it("keeps push disabled until package + CSV + service account + explicit confirmation are all present", () => {
    const { client } = fakeClient();
    render(<PlayDataSafetyCard client={client} appId="app-1" />);
    expect(screen.getByTestId("pds-push")).toBeDisabled();

    fireEvent.changeText(screen.getByTestId("pds-package"), "com.acme.app");
    fireEvent.changeText(screen.getByTestId("pds-csv"), "Location,Approximate location,...");
    fireEvent.changeText(screen.getByTestId("pds-sa"), '{"type":"service_account"}');
    // still disabled — the explicit confirmation is required
    expect(screen.getByTestId("pds-push")).toBeDisabled();

    fireEvent.press(screen.getByTestId("pds-confirm"));
    expect(screen.getByTestId("pds-push")).not.toBeDisabled();
  });

  it("pushes the declaration once, never persisting the service account", async () => {
    const { client, bodies } = fakeClient();
    render(<PlayDataSafetyCard client={client} appId="app-1" />);
    fireEvent.changeText(screen.getByTestId("pds-package"), "com.acme.app");
    fireEvent.changeText(screen.getByTestId("pds-csv"), "Location,Approximate location");
    fireEvent.changeText(screen.getByTestId("pds-sa"), '{"type":"service_account"}');
    fireEvent.press(screen.getByTestId("pds-confirm"));
    fireEvent.press(screen.getByTestId("pds-push"));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      packageName: "com.acme.app",
      safetyLabels: "Location,Approximate location",
      serviceAccount: '{"type":"service_account"}',
    });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled(); // never persisted
    await waitFor(() => expect(screen.getByTestId("pds-success")).toBeTruthy());
  });
});

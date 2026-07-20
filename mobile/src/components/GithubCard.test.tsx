/**
 * GithubCard (#8) — the honesty invariants:
 *   • the card is INERT when the deployment hasn't configured the GitHub App
 *     (never a dead connect form against a path that can't work);
 *   • read-only status drives what's shown — connected vs. connect form — never
 *     an optimistic guess;
 *   • connect requires a well-formed owner/name repo before it's enabled.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ApiClient } from "../api/client.js";
import type { GithubStatus } from "../types/api.js";
import { GithubCard } from "./GithubCard.js";

function fakeClient(
  status: GithubStatus,
  onConnect?: (body: unknown) => GithubStatus,
): { client: ApiClient; bodies: unknown[] } {
  const bodies: unknown[] = [];
  let current = status;
  const client = {
    get: async () => current,
    post: async (_p: string, body?: unknown) => {
      bodies.push(body);
      if (onConnect) current = onConnect(body);
      return { connected: current.connected, repo: current.repo };
    },
    request: async () => ({}),
  } as unknown as ApiClient;
  return { client, bodies };
}

describe("GithubCard", () => {
  it("renders the inert notice when the GitHub App isn't configured on this deployment", async () => {
    const { client } = fakeClient({ appConfigured: false, connected: false, repo: null });
    render(<GithubCard client={client} />);
    await waitFor(() => expect(screen.getByTestId("gh-unconfigured")).toBeTruthy());
    expect(screen.queryByTestId("gh-connect")).toBeNull();
  });

  it("shows the connected repo and a disconnect action when linked", async () => {
    const { client, bodies } = fakeClient(
      { appConfigured: true, connected: true, repo: "acme/app" },
      () => ({ appConfigured: true, connected: false, repo: null }),
    );
    render(<GithubCard client={client} />);
    await waitFor(() => expect(screen.getByTestId("gh-connected")).toHaveTextContent(/acme\/app/));
    fireEvent.press(screen.getByTestId("gh-disconnect"));
    // disconnect posts an empty body
    await waitFor(() => expect(bodies[0]).toEqual({}));
  });

  it("gates connect on a well-formed owner/name repo, then links it", async () => {
    const { client, bodies } = fakeClient(
      { appConfigured: true, connected: false, repo: null },
      (body) => ({ appConfigured: true, connected: true, repo: (body as { repo: string }).repo }),
    );
    render(<GithubCard client={client} />);
    await waitFor(() => expect(screen.getByTestId("gh-connect")).toBeTruthy());

    // a bare (non owner/name) repo keeps connect disabled
    fireEvent.changeText(screen.getByTestId("gh-installation"), "12345");
    fireEvent.changeText(screen.getByTestId("gh-repo"), "justname");
    expect(screen.getByTestId("gh-connect")).toBeDisabled();

    fireEvent.changeText(screen.getByTestId("gh-repo"), "acme/app");
    expect(screen.getByTestId("gh-connect")).not.toBeDisabled();
    fireEvent.press(screen.getByTestId("gh-connect"));
    await waitFor(() => expect(bodies[0]).toEqual({ installation_id: "12345", repo: "acme/app" }));
    await waitFor(() => expect(screen.getByTestId("gh-connected")).toBeTruthy());
  });
});

/**
 * LocaleKeywordsCard (#180 Phase 3) — the honesty invariants:
 *   • candidates are MEASURED from top apps in the target storefront (usedBy
 *     count shown), never invented;
 *   • the honest empty-state note renders verbatim when the market yields none;
 *   • a market must be picked before the fetch can run (no silent default).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { LocaleKeywordsCard } from "./LocaleKeywordsCard.js";
import type { ApiClient } from "../api/client.js";
import type { LocaleKeywordsResult } from "../types/api.js";

function fakeClient(result: LocaleKeywordsResult): { client: ApiClient; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const client = {
    get: async () => ({}),
    post: async (_p: string, body?: unknown) => {
      bodies.push(body);
      return result;
    },
    request: async () => ({}),
  } as unknown as ApiClient;
  return { client, bodies };
}

const CANDIDATES: LocaleKeywordsResult = {
  market: "de-DE",
  candidates: [
    { term: "wetter", market: "de-DE", usedByCount: 7, usedBy: ["a", "b"] },
    { term: "vorhersage", market: "de-DE", usedByCount: 3, usedBy: ["c"] },
  ],
};

describe("LocaleKeywordsCard", () => {
  it("requires a market before fetching (the fetch button is disabled until one is picked)", () => {
    const { client } = fakeClient(CANDIDATES);
    render(<LocaleKeywordsCard client={client} appId="app-1" />);
    expect(screen.getByTestId("locale-keywords-fetch")).toBeDisabled();
  });

  it("picks a market chip, fetches, and lists MEASURED candidates with their usage counts", async () => {
    const { client, bodies } = fakeClient(CANDIDATES);
    render(<LocaleKeywordsCard client={client} appId="app-1" />);

    fireEvent.press(screen.getByTestId("market-chip-de-DE"));
    fireEvent.press(screen.getByTestId("locale-keywords-fetch"));

    await waitFor(() => expect(screen.getByTestId("locale-kw-wetter")).toBeTruthy());
    expect(screen.getByTestId("locale-kw-vorhersage")).toBeTruthy();
    // the measured usage count is shown — never a bare, unsourced term.
    expect(screen.getByText(/7/)).toBeTruthy();
    // the selected market rode through in the request body.
    expect(bodies[0]).toMatchObject({ market: "de-DE" });
  });

  it("passes typed seed terms through to the request", async () => {
    const { client, bodies } = fakeClient(CANDIDATES);
    render(<LocaleKeywordsCard client={client} appId="app-1" />);

    fireEvent.press(screen.getByTestId("market-chip-de-DE"));
    fireEvent.changeText(screen.getByTestId("locale-keywords-seeds"), "recipe, cooking");
    fireEvent.press(screen.getByTestId("locale-keywords-fetch"));

    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]).toMatchObject({ market: "de-DE", seeds: ["recipe", "cooking"] });
  });

  it("shows the honest empty-state note verbatim when the market yields none", async () => {
    const { client } = fakeClient({
      market: "de-DE",
      candidates: [],
      note: "No tracked keywords and no seeds — add a seed term to get ideas.",
    });
    render(<LocaleKeywordsCard client={client} appId="app-1" />);
    fireEvent.press(screen.getByTestId("market-chip-de-DE"));
    fireEvent.press(screen.getByTestId("locale-keywords-fetch"));
    await waitFor(() =>
      expect(screen.getByText(/No tracked keywords and no seeds/)).toBeTruthy(),
    );
  });
});

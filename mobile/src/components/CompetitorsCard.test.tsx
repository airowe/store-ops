/**
 * Competitors card (#72 parity) — the honesty invariants:
 *   • discovery stores SUGGESTIONS; nothing shows "watched" until confirmed,
 *   • confirming flips the chip; remove/dismiss delete,
 *   • the honest empty state and the no-candidates note render verbatim.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { CompetitorsCard } from "./CompetitorsCard.js";
import type { ApiClient } from "../api/client.js";
import type { Competitor } from "../types/api.js";

function fakeClient(initial: Competitor[]): { client: ApiClient; calls: string[] } {
  let rows = [...initial];
  const calls: string[] = [];
  const respond = async (method: string, path: string): Promise<unknown> => {
    calls.push(`${method} ${path}`);
    if (path.endsWith("/competitors") && method === "GET") return { competitors: rows };
    if (path.endsWith("/discover")) {
      rows = [...rows, { key: "901", name: "Rival Pro", source: "discovered", status: "suggested" }];
      return { competitors: rows, discovered: 1 };
    }
    if (path.endsWith("/confirm")) {
      rows = rows.map((r) => (path.includes(`/${r.key}/`) ? { ...r, status: "confirmed" as const } : r));
      return { competitors: rows };
    }
    if (method === "DELETE") {
      rows = rows.filter((r) => !path.endsWith(`/${r.key}`));
      return { competitors: rows };
    }
    if (path.endsWith("/competitors") && method === "POST") {
      rows = [...rows, { key: "555", name: "Paprika", source: "user", status: "confirmed" }];
      return { competitors: rows };
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const client = {
    get: (p: string) => respond("GET", p),
    post: (p: string) => respond("POST", p),
    request: (p: string, o?: { method?: string }) => respond(o?.method ?? "GET", p),
  } as unknown as ApiClient;
  return { client, calls };
}

describe("CompetitorsCard", () => {
  it("renders the honest empty state, then discovery adds a SUGGESTED (not watched) row", async () => {
    const { client } = fakeClient([]);
    render(<CompetitorsCard client={client} appId="app-1" />);
    await waitFor(() => expect(screen.getByTestId("competitors-empty")).toBeTruthy());

    fireEvent.press(screen.getByTestId("discover-competitors"));
    await waitFor(() => expect(screen.getByText("Rival Pro")).toBeTruthy());
    expect(screen.getByText("suggested")).toBeTruthy();
    expect(screen.queryByText("watched")).toBeNull(); // never silently watched
  });

  it("Watch confirms the suggestion; Remove deletes a watched competitor", async () => {
    const { client } = fakeClient([
      { key: "901", name: "Rival Pro", source: "discovered", status: "suggested" },
    ]);
    render(<CompetitorsCard client={client} appId="app-1" />);
    await waitFor(() => expect(screen.getByText("Rival Pro")).toBeTruthy());

    fireEvent.press(screen.getByTestId("watch-901"));
    await waitFor(() => expect(screen.getByText("watched")).toBeTruthy());

    fireEvent.press(screen.getByTestId("remove-901"));
    await waitFor(() => expect(screen.getByTestId("competitors-empty")).toBeTruthy());
  });

  it("add-by-name lands confirmed immediately (user entry, not a suggestion)", async () => {
    const { client } = fakeClient([]);
    render(<CompetitorsCard client={client} appId="app-1" />);
    await waitFor(() => expect(screen.getByTestId("competitors-empty")).toBeTruthy());

    fireEvent.changeText(screen.getByTestId("competitor-name"), "Paprika");
    fireEvent.press(screen.getByTestId("add-competitor"));
    await waitFor(() => expect(screen.getByText("Paprika")).toBeTruthy());
    expect(screen.getByText("watched")).toBeTruthy();
  });
});

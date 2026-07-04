/**
 * Agent triggers + schedule card (#53/#52 parity) — pins:
 *   • server values render on load (defaults = the historical behavior),
 *   • save sends the patch and RECONCILES from the server's answer,
 *   • a server 400 (loud validation) surfaces verbatim,
 *   • daily cadence hides the day picker (day is meaningless daily).
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AgentTriggersCard } from "./AgentTriggersCard.js";
import type { ApiClient } from "../api/client.js";
import type { SweepSchedule, ThresholdConfig } from "../types/api.js";

const DEFAULT_T: ThresholdConfig = {
  unranked: true,
  competitorChanges: true,
  rankDropAtLeast: null,
  mutedKeywords: [],
  mutedCompetitors: [],
  notifyOnly: false,
};
const DEFAULT_S: SweepSchedule = { cadence: "weekly", day: 1, hourUtc: 9 };

function fakeClient(opts: { failSave?: string } = {}) {
  let thresholds = { ...DEFAULT_T };
  let schedule = { ...DEFAULT_S };
  const posts: Array<{ path: string; body: unknown }> = [];
  const client = {
    get: async (p: string) =>
      p.endsWith("/thresholds") ? { thresholds } : { schedule },
    post: async (p: string, body: unknown) => {
      posts.push({ path: p, body });
      if (opts.failSave) throw new Error(opts.failSave);
      if (p.endsWith("/thresholds")) {
        thresholds = { ...thresholds, ...(body as Partial<ThresholdConfig>) };
        // the server normalizes muted keywords (lowercase) — mirror that
        thresholds.mutedKeywords = (thresholds.mutedKeywords ?? []).map((k) => k.toLowerCase());
        return { thresholds };
      }
      schedule = body as SweepSchedule;
      return { schedule };
    },
    request: async () => ({}),
  } as unknown as ApiClient;
  return { client, posts };
}

describe("AgentTriggersCard", () => {
  it("loads server values and saves a patch, reconciling from the answer", async () => {
    const { client, posts } = fakeClient();
    render(<AgentTriggersCard client={client} appId="app-1" />);
    await waitFor(() => expect(screen.getAllByText("On").length).toBe(2)); // unranked + competitors

    fireEvent.press(screen.getByTestId("th-unranked")); // On → Off
    fireEvent.changeText(screen.getByTestId("th-rank-drop"), "10");
    fireEvent.changeText(screen.getByTestId("th-muted"), "Pantry, recipe");
    fireEvent.press(screen.getByTestId("th-save"));

    await waitFor(() => expect(screen.getByTestId("triggers-note")).toBeTruthy());
    const sent = posts.find((p) => p.path.endsWith("/thresholds"))!.body as Partial<ThresholdConfig>;
    expect(sent.unranked).toBe(false);
    expect(sent.rankDropAtLeast).toBe(10);
    expect(sent.mutedKeywords).toEqual(["Pantry", "recipe"]);
    // reconciled: the server's normalized (lowercased) list renders back
    expect(screen.getByTestId("th-muted").props.value).toBe("pantry, recipe");
    expect(screen.getByText(/only change what opens a run/)).toBeTruthy();
  });

  it("a loud server 400 surfaces verbatim (never silently defaulted)", async () => {
    const { client } = fakeClient({ failSave: "rankDropAtLeast must be null or an integer 1–200" });
    render(<AgentTriggersCard client={client} appId="app-1" />);
    await waitFor(() => expect(screen.getAllByText("On").length).toBe(2));

    fireEvent.changeText(screen.getByTestId("th-rank-drop"), "999");
    fireEvent.press(screen.getByTestId("th-save"));
    await waitFor(() =>
      expect(screen.getByText(/rankDropAtLeast must be null or an integer/)).toBeTruthy(),
    );
  });

  it("schedule: weekly shows the day picker, daily hides it; save sends the slot", async () => {
    const { client, posts } = fakeClient();
    render(<AgentTriggersCard client={client} appId="app-1" />);
    await waitFor(() => expect(screen.getByTestId("sch-day-1")).toBeTruthy()); // weekly default → days visible

    fireEvent.press(screen.getByTestId("sch-daily"));
    expect(screen.queryByTestId("sch-day-1")).toBeNull(); // day meaningless daily

    fireEvent.changeText(screen.getByTestId("sch-hour"), "6");
    fireEvent.press(screen.getByTestId("sch-save"));
    await waitFor(() => expect(screen.getByText(/sweeps this app on that slot/)).toBeTruthy());
    const sent = posts.find((p) => p.path.endsWith("/schedule"))!.body as SweepSchedule;
    expect(sent).toEqual({ cadence: "daily", day: 1, hourUtc: 6 });
  });
});

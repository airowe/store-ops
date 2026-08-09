/**
 * FramePicker — pins:
 *   • the catalog renders as options (auto + every frame) with the active pitch,
 *   • picking a frame (or auto) reports the choice upward,
 *   • a failed catalog fetch renders NOTHING (choice stays auto — a degraded
 *     network never fakes a catalog).
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FramePicker } from "./FramePicker.js";
import type { ApiClient } from "../api/client.js";
import type { FrameCatalog } from "../types/api.js";

const CATALOG: FrameCatalog = {
  version: 1,
  auto: { id: "auto", name: "Let ShipASO pick", sell: "The planner matches a frame to each shot." },
  templates: [
    {
      id: "headline-top",
      name: "Headline up top",
      sell: "The classic converter: the promise first.",
      slots: { headline: { fx: 0.09, fy: 0.06, fw: 0.82, fh: 0.15, align: "center" } },
      deviceFrame: { fx: 0.1, fy: 0.26, fw: 0.8, fh: 0.66 },
    },
    {
      id: "editorial",
      name: "Editorial",
      sell: "Left-aligned copy like a feature card.",
      slots: {
        headline: { fx: 0.09, fy: 0.07, fw: 0.82, fh: 0.14, align: "left" },
        subline: { fx: 0.09, fy: 0.23, fw: 0.82, fh: 0.06, align: "left" },
      },
      deviceFrame: { fx: 0.22, fy: 0.33, fw: 0.72, fh: 0.6 },
    },
  ],
};

function fakeClient(catalog: FrameCatalog | Error = CATALOG): ApiClient {
  return {
    get: async (p: string) => {
      expect(p).toBe("/screenshot-templates");
      if (catalog instanceof Error) throw catalog;
      return catalog;
    },
    post: async () => ({}),
    request: async () => ({}),
  } as unknown as ApiClient;
}

describe("FramePicker", () => {
  it("renders auto + every catalog frame, with the active option's pitch", async () => {
    render(<FramePicker client={fakeClient()} choice="auto" onChoose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("frame-picker")).toBeTruthy());
    expect(screen.getByTestId("frame-auto")).toBeTruthy();
    expect(screen.getByTestId("frame-headline-top")).toBeTruthy();
    expect(screen.getByTestId("frame-editorial")).toBeTruthy();
    expect(screen.getByText("The planner matches a frame to each shot.")).toBeTruthy();
  });

  it("reports a picked frame — and picking auto again — upward", async () => {
    const chosen: string[] = [];
    render(<FramePicker client={fakeClient()} choice="auto" onChoose={(c) => chosen.push(c)} />);
    await waitFor(() => expect(screen.getByTestId("frame-editorial")).toBeTruthy());
    fireEvent.press(screen.getByTestId("frame-editorial"));
    fireEvent.press(screen.getByTestId("frame-auto"));
    expect(chosen).toEqual(["editorial", "auto"]);
  });

  it("shows the picked frame's why-it-converts pitch", async () => {
    render(<FramePicker client={fakeClient()} choice="editorial" onChoose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("frame-picker")).toBeTruthy());
    expect(screen.getByText("Left-aligned copy like a feature card.")).toBeTruthy();
  });

  it("renders nothing when the catalog fetch fails (never a fabricated catalog)", async () => {
    render(
      <FramePicker client={fakeClient(new Error("offline"))} choice="auto" onChoose={() => {}} />,
    );
    // give the rejected fetch a tick to settle, then assert absence
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("frame-picker")).toBeNull();
  });
});

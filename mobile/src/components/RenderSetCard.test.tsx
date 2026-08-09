/**
 * RenderSetCard — pins:
 *   • renders every planned shot through the executor at full store resolution,
 *     including MISSING shots (placeholder render, DRAFT badge),
 *   • the picked background (neutral / a palette color) reaches the renderer,
 *   • a failed render is a stated gap ("N of M failed"), never a blank pass,
 *   • export on a paid tier writes NN-template.png files and shares them,
 *   • export on free/unknown tier opens the native paywall and shares NOTHING.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ApiClient } from "../api/client.js";
import type { ScreenshotPlan } from "../types/api.js";
import type { ShotRender } from "../lib/shotRender.js";

jest.mock("../lib/skiaShotRenderer.js", () => ({
  renderShotToBase64: jest.fn(async () => "UEZha2VQbmc="),
}));
jest.mock("./Paywall.js", () => {
  const { View } = require("react-native");
  return { Paywall: () => <View testID="paywall-stub" /> };
});
jest.mock("expo-sharing", () => ({ shareAsync: jest.fn(async () => undefined) }));

import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { renderShotToBase64 } from "../lib/skiaShotRenderer.js";
import { RenderSetCard } from "./RenderSetCard.js";

const renderMock = renderShotToBase64 as jest.Mock;
const shareMock = Sharing.shareAsync as jest.Mock;
const writeMock = FileSystem.writeAsStringAsync as jest.Mock;

const CATALOG = {
  version: 1,
  auto: { id: "auto", name: "Let ShipASO pick", sell: "Per shot." },
  templates: [
    {
      id: "headline-top",
      name: "Headline up top",
      sell: "The classic converter.",
      slots: { headline: { fx: 0.09, fy: 0.06, fw: 0.82, fh: 0.15, align: "center" } },
      deviceFrame: { fx: 0.1, fy: 0.26, fw: 0.8, fh: 0.66 },
    },
    {
      id: "spotlight",
      name: "Spotlight",
      sell: "One oversized claim.",
      slots: { headline: { fx: 0.09, fy: 0.1, fw: 0.82, fh: 0.2, align: "center" } },
      deviceFrame: { fx: 0.08, fy: 0.4, fw: 0.84, fh: 0.55 },
    },
  ],
};

const PLAN: ScreenshotPlan = {
  narrative: "Hook then proof.",
  shots: [
    { sourceScreen: "frame-1", headline: "Track your rank", templateId: "headline-top", accent: "#34d399" },
    { sourceScreen: "MISSING", missingReason: "only 1 frame selected", headline: "", templateId: "spotlight", needsReview: true },
  ],
  label: "draft — machine-planned, review before shipping",
  degraded: false,
  palette: ["#34d399", "#111621"],
};

const FRAMES = { "frame-1": "file:///cache/frame-1.jpg" };

function fakeClient(): ApiClient {
  return {
    get: async () => CATALOG,
    post: async () => ({}),
    request: async () => ({}),
  } as unknown as ApiClient;
}

async function renderCard(tier?: "free" | "indie") {
  render(
    <RenderSetCard
      client={fakeClient()}
      plan={PLAN}
      frames={FRAMES}
      tier={tier}
      onUnlocked={() => {}}
    />,
  );
  await waitFor(() => expect(screen.getByTestId("render-set-btn")).toBeTruthy());
}

beforeEach(() => {
  jest.clearAllMocks();
  renderMock.mockResolvedValue("UEZha2VQbmc=");
});

describe("RenderSetCard", () => {
  it("renders every shot at full store resolution — MISSING included, badged DRAFT", async () => {
    await renderCard("free");
    fireEvent.press(screen.getByTestId("render-set-btn"));
    await waitFor(() => expect(screen.getByTestId("render-preview-0")).toBeTruthy());

    expect(renderMock).toHaveBeenCalledTimes(2);
    const first = renderMock.mock.calls[0]![0] as ShotRender;
    const second = renderMock.mock.calls[1]![0] as ShotRender;
    expect(first.canvasWidth).toBe(1290);
    expect(first.canvasHeight).toBe(2796);
    expect(first.frameUri).toBe("file:///cache/frame-1.jpg");
    expect(second.frameUri).toBeNull(); // the honest placeholder
    expect(second.needsReview).toBe(true);
    expect(screen.getByTestId("render-draft-1")).toBeTruthy();
    expect(screen.getByText("01-headline-top.png")).toBeTruthy();
    expect(screen.getByText("02-spotlight.png")).toBeTruthy();
  });

  it("the picked palette background reaches the renderer", async () => {
    await renderCard("free");
    fireEvent.press(screen.getByTestId("bg-111621"));
    fireEvent.press(screen.getByTestId("render-set-btn"));
    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    const first = renderMock.mock.calls[0]![0] as ShotRender;
    expect(first.background).toEqual([17, 22, 33]);
  });

  it("a failed render is a stated gap, never a blank pass", async () => {
    renderMock.mockResolvedValueOnce("UEZha2VQbmc=").mockResolvedValueOnce(null);
    await renderCard("indie");
    fireEvent.press(screen.getByTestId("render-set-btn"));
    await waitFor(() => expect(screen.getByTestId("render-note")).toBeTruthy());
    expect(screen.getByText(/1 of 2 shots failed to render/)).toBeTruthy();
    expect(screen.getByTestId("render-failed-1")).toBeTruthy();
  });

  it("paid tier export writes the NN-template.png files and shares them", async () => {
    await renderCard("indie");
    fireEvent.press(screen.getByTestId("render-set-btn"));
    await waitFor(() => expect(screen.getByTestId("export-set-btn")).toBeTruthy());
    fireEvent.press(screen.getByTestId("export-set-btn"));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(2));
    expect(writeMock).toHaveBeenCalledWith(
      "file:///cache/01-headline-top.png",
      "UEZha2VQbmc=",
      { encoding: "base64" },
    );
    expect(shareMock).toHaveBeenCalledWith("file:///cache/02-spotlight.png");
    expect(screen.queryByTestId("render-paywall")).toBeNull();
  });

  it("free tier export opens the native paywall and shares NOTHING", async () => {
    await renderCard("free");
    fireEvent.press(screen.getByTestId("render-set-btn"));
    await waitFor(() => expect(screen.getByTestId("export-set-btn")).toBeTruthy());
    fireEvent.press(screen.getByTestId("export-set-btn"));

    await waitFor(() => expect(screen.getByTestId("render-paywall")).toBeTruthy());
    expect(screen.getByTestId("paywall-stub")).toBeTruthy();
    expect(shareMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });
});

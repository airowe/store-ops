/**
 * Capture kit screen — pins:
 *   • import extracts REAL frames from the recording (one thumbnail call per
 *     sampled timestamp) and failed extractions are a stated gap,
 *   • selecting frames names them in story order (frame-1, frame-2, …) and
 *     those ids become the plan's rawScreens,
 *   • export shares exactly the selected frames' files,
 *   • a canceled import changes nothing.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ApiClient } from "../../src/api/client.js";
import { AuthProvider } from "../../src/auth/AuthProvider.js";
import { setToken } from "../../src/auth/session.js";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ appName: "Weatherly" }),
  Stack: Object.assign(() => null, { Screen: () => null }),
  Redirect: () => null,
}));

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));
jest.mock("expo-video-thumbnails", () => ({
  getThumbnailAsync: jest.fn(async (_uri: string, opts: { time: number }) => ({
    uri: `file:///thumbs/${opts.time}.jpg`,
  })),
}));
jest.mock("expo-sharing", () => ({
  shareAsync: jest.fn(async () => undefined),
}));

import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import * as Sharing from "expo-sharing";
import CaptureKit from "./capture-kit.js";

const pickerMock = ImagePicker.launchImageLibraryAsync as jest.Mock;
const thumbMock = VideoThumbnails.getThumbnailAsync as jest.Mock;
const shareMock = Sharing.shareAsync as jest.Mock;

/** /auth/me keeps AuthProvider authed; POST /plan/screenshots records bodies. */
function fakeClient(bodies: unknown[] = []): ApiClient {
  return {
    get: async (p: string) => {
      if (p === "/auth/me") return { authed: true, via: "session", email: "o@e.com" };
      if (p === "/screenshot-templates") {
        return {
          version: 1,
          auto: { id: "auto", name: "Let ShipASO pick", sell: "Per shot." },
          templates: [
            {
              id: "spotlight",
              name: "Spotlight",
              sell: "One claim.",
              slots: { headline: { fx: 0.09, fy: 0.1, fw: 0.82, fh: 0.2 } },
              deviceFrame: { fx: 0.08, fy: 0.4, fw: 0.84, fh: 0.55 },
            },
          ],
        };
      }
      return {};
    },
    post: async (p: string, body?: unknown) => {
      bodies.push({ path: p, body });
      return {
        narrative: "n",
        shots: [{ sourceScreen: "frame-1", headline: "h", templateId: "spotlight" }],
        label: "draft — machine-planned, review before shipping",
        degraded: false,
      };
    },
    request: async () => ({}),
  } as unknown as ApiClient;
}

async function renderKit(bodies: unknown[] = []) {
  await setToken("test-token");
  const r = render(
    <AuthProvider clientOverride={fakeClient(bodies)}>
      <CaptureKit />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("import-recording-btn")).toBeTruthy());
  return r;
}

const RECORDING = {
  canceled: false,
  assets: [{ uri: "file:///videos/walkthrough.mov", duration: 8000 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  pickerMock.mockResolvedValue({ canceled: true, assets: null });
  thumbMock.mockImplementation(async (_uri: string, opts: { time: number }) => ({
    uri: `file:///thumbs/${opts.time}.jpg`,
  }));
});

describe("CaptureKit", () => {
  it("extracts 8 evenly sampled real frames from an imported recording", async () => {
    pickerMock.mockResolvedValue(RECORDING);
    await renderKit();
    fireEvent.press(screen.getByTestId("import-recording-btn"));
    await waitFor(() => expect(screen.getByTestId("thumb-0")).toBeTruthy());
    expect(thumbMock).toHaveBeenCalledTimes(8);
    // mid-bucket sampling across the 8s recording: first at 500ms, last at 7500ms
    expect(thumbMock.mock.calls[0]![1].time).toBe(500);
    expect(thumbMock.mock.calls[7]![1].time).toBe(7500);
    expect(screen.getByTestId("thumb-7")).toBeTruthy();
  });

  it("a canceled import changes nothing", async () => {
    await renderKit();
    fireEvent.press(screen.getByTestId("import-recording-btn"));
    await waitFor(() => expect(pickerMock).toHaveBeenCalled());
    expect(screen.queryByTestId("thumb-0")).toBeNull();
    expect(thumbMock).not.toHaveBeenCalled();
  });

  it("failed extractions are a stated gap, never a placeholder", async () => {
    pickerMock.mockResolvedValue(RECORDING);
    thumbMock
      .mockRejectedValueOnce(new Error("codec"))
      .mockRejectedValueOnce(new Error("codec"));
    await renderKit();
    fireEvent.press(screen.getByTestId("import-recording-btn"));
    await waitFor(() => expect(screen.getByTestId("extract-gaps")).toBeTruthy());
    expect(screen.getByText(/2 of 8 frames couldn’t be extracted/)).toBeTruthy();
    // only the 6 real frames render
    expect(screen.getByTestId("thumb-5")).toBeTruthy();
    expect(screen.queryByTestId("thumb-6")).toBeNull();
  });

  it("selected frames become the plan's rawScreens in story order", async () => {
    pickerMock.mockResolvedValue(RECORDING);
    const bodies: Array<{ path: string; body: { rawScreens?: string[]; audit?: { recommendedCount: number } } }> = [];
    await renderKit(bodies);
    fireEvent.press(screen.getByTestId("import-recording-btn"));
    await waitFor(() => expect(screen.getByTestId("thumb-0")).toBeTruthy());

    fireEvent.press(screen.getByTestId("thumb-5")); // picked out of order…
    fireEvent.press(screen.getByTestId("thumb-1"));
    await waitFor(() => expect(screen.getByTestId("plan-screenshots-btn")).toBeTruthy());
    fireEvent.press(screen.getByTestId("plan-screenshots-btn"));

    await waitFor(() => expect(bodies.length).toBe(1));
    const plan = bodies.find((b) => b.path === "/plan/screenshots")!;
    // …but named in TIME order: thumb-1 is frame-1, thumb-5 is frame-2
    expect(plan.body.rawScreens).toEqual(["frame-1", "frame-2"]);
    expect(plan.body.audit!.recommendedCount).toBe(2);
  });

  it("export shares the selected frames UNDER the plan's ids (frame-N stems)", async () => {
    const FileSystem = require("expo-file-system/legacy");
    pickerMock.mockResolvedValue(RECORDING);
    await renderKit();
    fireEvent.press(screen.getByTestId("import-recording-btn"));
    await waitFor(() => expect(screen.getByTestId("thumb-0")).toBeTruthy());

    fireEvent.press(screen.getByTestId("thumb-0"));
    fireEvent.press(screen.getByTestId("thumb-3"));
    fireEvent.press(screen.getByTestId("export-frames-btn"));

    // the renderer maps captures by filename stem, so the exported names must
    // be exactly the ids the plan carries — not the thumbnail temp names.
    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(2));
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: "file:///thumbs/500.jpg",
      to: "file:///cache/frame-1.jpg",
    });
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: "file:///thumbs/3500.jpg",
      to: "file:///cache/frame-2.jpg",
    });
    expect(shareMock).toHaveBeenCalledWith("file:///cache/frame-1.jpg");
    expect(shareMock).toHaveBeenCalledWith("file:///cache/frame-2.jpg");
  });
});

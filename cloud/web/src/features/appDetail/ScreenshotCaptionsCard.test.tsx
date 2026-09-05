import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient, CaptionLocalizationResult } from "@shipaso/api";
import { ScreenshotCaptionsCard, captionManifest } from "./ScreenshotCaptionsCard.js";

const RESULT: CaptionLocalizationResult = {
  localized: [
    {
      locale: "de-DE",
      label: "draft — machine-translated, review before shipping",
      needsReview: true,
      slots: [
        { id: "headline", text: "Gewohnheiten, die bleiben", fit: { fontSize: 64, lines: 1, action: "fit" } },
        { id: "sub", text: "Jeden Tag einen kleinen Schritt weiter, ohne Druck", fit: { fontSize: 22, lines: 3, action: "overflow", note: "does not fit at the floor size" } },
      ],
    },
    {
      locale: "fr-FR",
      label: "draft — machine-translated, review before shipping",
      needsReview: false,
      slots: [
        { id: "headline", text: "Des habitudes qui durent", fit: { fontSize: 58, lines: 1, action: "shrunk" } },
        { id: "sub", text: "Un petit pas chaque jour", fit: { fontSize: 28, lines: 1, action: "fit" } },
      ],
    },
  ],
  excluded: [{ locale: "ar-SA", reason: "right-to-left layout is not supported by this renderer yet" }],
};

function makeClient(result: CaptionLocalizationResult | Error = RESULT) {
  const post = vi.fn(async (path: string) => {
    if (path === "/localize/screenshots") {
      if (result instanceof Error) throw result;
      return result;
    }
    throw new Error("unexpected POST " + path);
  });
  return { client: { get: vi.fn(), post, request: vi.fn() } as unknown as ApiClient, post };
}

function renderCard(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScreenshotCaptionsCard client={client} />
    </QueryClientProvider>,
  );
}

function fillAndRun() {
  fireEvent.change(screen.getByTestId("sc-slot-text-0"), { target: { value: "Habits that stick" } });
  fireEvent.click(screen.getByTestId("sc-locale-de-DE"));
  fireEvent.click(screen.getByTestId("sc-locale-fr-FR"));
  fireEvent.click(screen.getByTestId("sc-run"));
}

describe("<ScreenshotCaptionsCard />", () => {
  it("posts the slots, chosen locales and brand tokens; never an empty locale list", async () => {
    const { client, post } = makeClient();
    renderCard(client);
    expect(screen.getByTestId("sc-run")).toBeDisabled();
    fireEvent.change(screen.getByTestId("sc-brand"), { target: { value: "Acme, Acme Habits" } });
    fillAndRun();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const call = post.mock.calls[0] as unknown as [string, { source: { slots: unknown[] }; targetLocales: string[]; brandTokens: string[] }];
    const body = call[1];
    expect(body.targetLocales).toEqual(["de-DE", "fr-FR"]);
    expect(body.brandTokens).toEqual(["Acme", "Acme Habits"]);
    expect(body.source.slots[0]).toMatchObject({ id: "headline", text: "Habits that stick", fontSize: 64, box: { width: 1000, height: 160 } });
  });

  it("renders each locale with its verbatim draft label and flags the one that needs review", async () => {
    const { client } = makeClient();
    renderCard(client);
    fillAndRun();
    await waitFor(() => screen.getByTestId("sc-locale-result-de-DE"));
    expect(screen.getAllByText("draft — machine-translated, review before shipping")).toHaveLength(2);
    expect(screen.getByTestId("sc-review-de-DE")).toHaveTextContent("needs review");
    expect(screen.queryByTestId("sc-review-fr-FR")).toBeNull();
  });

  it("states each slot's fit honestly: overflow with its note, shrunk with the size it landed on", async () => {
    const { client } = makeClient();
    renderCard(client);
    fillAndRun();
    await waitFor(() => screen.getByTestId("sc-fit-de-DE-sub"));
    expect(screen.getByTestId("sc-fit-de-DE-sub")).toHaveTextContent("overflow");
    expect(screen.getByTestId("sc-fit-de-DE-sub")).toHaveTextContent("does not fit at the floor size");
    expect(screen.getByTestId("sc-fit-fr-FR-headline")).toHaveTextContent("shrunk to 58px");
    expect(screen.getByTestId("sc-fit-fr-FR-sub")).toHaveTextContent("fits");
  });

  it("lists excluded locales with the reason rather than dropping them", async () => {
    const { client } = makeClient();
    renderCard(client);
    fillAndRun();
    await waitFor(() => screen.getByTestId("sc-excluded"));
    expect(screen.getByTestId("sc-excluded")).toHaveTextContent("ar-SA");
    expect(screen.getByTestId("sc-excluded")).toHaveTextContent("right-to-left");
  });

  it("surfaces a provider failure verbatim, with no fake translation", async () => {
    const { client } = makeClient(new Error("translation provider refused de-DE: quota"));
    renderCard(client);
    fillAndRun();
    await waitFor(() => screen.getByTestId("sc-error"));
    expect(screen.getByTestId("sc-error")).toHaveTextContent("quota");
    expect(screen.queryByTestId("sc-results")).toBeNull();
  });

  it("adds and removes slot rows", () => {
    const { client } = makeClient();
    renderCard(client);
    expect(screen.getAllByTestId(/^sc-slot-text-/)).toHaveLength(2);
    fireEvent.click(screen.getByTestId("sc-add-slot"));
    expect(screen.getAllByTestId(/^sc-slot-text-/)).toHaveLength(3);
    fireEvent.click(screen.getByTestId("sc-remove-slot-2"));
    expect(screen.getAllByTestId(/^sc-slot-text-/)).toHaveLength(2);
  });
});

describe("captionManifest — the renderer's input, flattened", () => {
  it("is locale → slot → {text, fontSize at the FIT size}, excluded locales absent", () => {
    expect(captionManifest(RESULT)).toEqual({
      "de-DE": {
        headline: { text: "Gewohnheiten, die bleiben", fontSize: 64 },
        sub: { text: "Jeden Tag einen kleinen Schritt weiter, ohne Druck", fontSize: 22 },
      },
      "fr-FR": {
        headline: { text: "Des habitudes qui durent", fontSize: 58 },
        sub: { text: "Un petit pas chaque jour", fontSize: 28 },
      },
    });
  });
});

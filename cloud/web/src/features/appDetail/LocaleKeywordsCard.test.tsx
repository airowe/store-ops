import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient, LocaleKeywordsResult } from "@shipaso/api";
import { LocaleKeywordsCard } from "./LocaleKeywordsCard.js";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const client = {} as ApiClient;

describe("<LocaleKeywordsCard />", () => {
  it("searches the entered market and lists measured candidates with usage counts", async () => {
    const result: LocaleKeywordsResult = {
      market: "de",
      candidates: [
        { term: "wetter", market: "de", usedByCount: 3, usedBy: ["A", "B", "C"] },
        { term: "radar", market: "de", usedByCount: 2, usedBy: ["A", "C"] },
      ],
    };
    const post = vi.spyOn(await import("@shipaso/api"), "getLocaleKeywords").mockResolvedValue(result);

    wrap(<LocaleKeywordsCard client={client} appId="a1" />);
    fireEvent.change(screen.getByTestId("lk-market"), { target: { value: "de" } });
    fireEvent.click(screen.getByTestId("lk-run"));

    await waitFor(() => expect(screen.getByTestId("lk-results")).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith(client, "a1", { market: "de" });
    expect(screen.getByTestId("lk-term-wetter")).toHaveTextContent("wetter");
    expect(screen.getByTestId("lk-term-wetter")).toHaveTextContent("3 apps");
    expect(screen.getByTestId("lk-results")).toHaveTextContent("DE");
    post.mockRestore();
  });

  it("shows the honest empty-state note verbatim (no tracked keywords)", async () => {
    const post = vi.spyOn(await import("@shipaso/api"), "getLocaleKeywords").mockResolvedValue({
      market: "jp",
      candidates: [],
      note: "No tracked keywords yet — run the agent once, or pass `seeds` to search that market.",
    });
    wrap(<LocaleKeywordsCard client={client} appId="a1" />);
    fireEvent.change(screen.getByTestId("lk-market"), { target: { value: "jp" } });
    fireEvent.click(screen.getByTestId("lk-run"));
    await waitFor(() => expect(screen.getByTestId("lk-note")).toBeInTheDocument());
    expect(screen.getByTestId("lk-note")).toHaveTextContent("No tracked keywords yet");
    post.mockRestore();
  });

  it("disables the button until a market is entered", () => {
    wrap(<LocaleKeywordsCard client={client} appId="a1" />);
    expect(screen.getByTestId("lk-run")).toBeDisabled();
    fireEvent.change(screen.getByTestId("lk-market"), { target: { value: "fr" } });
    expect(screen.getByTestId("lk-run")).not.toBeDisabled();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { PlayAuditCard } from "./PlayAuditCard.js";

const RESULT = {
  appId: "com.foo.bar",
  screenshots: { grade: "B", score: 70 },
  findings: [{ id: "play_short_desc", surface: "short_description", severity: "warn", impact: "conversion", title: "Short description is thin", detail: "Use the 80 chars.", fix: "Expand it." }],
  summary: { label: "1 fix available", critical: 0 },
  locks: [],
};

function makeClient({ credentials = [] as unknown[], result = RESULT as unknown } = {}) {
  const get = vi.fn(async (path: string) => {
    if (path === "/account/credentials") return { enabled: true, credentials };
    throw new Error("unexpected GET " + path);
  });
  const post = vi.fn(async (path: string) => {
    if (path.endsWith("/audit-play")) return result;
    throw new Error("unexpected POST " + path);
  });
  return { client: { get, post, request: vi.fn() } as unknown as ApiClient, get, post };
}

function renderCard(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PlayAuditCard client={client} appId="a1" />
    </QueryClientProvider>,
  );
}

describe("<PlayAuditCard />", () => {
  it("no saved key: needs a package id + service account, then runs and renders findings", async () => {
    const { client, post } = makeClient();
    renderCard(client);
    await waitFor(() => expect(screen.getByTestId("play-run")).toBeDisabled());
    fireEvent.change(screen.getByTestId("play-package"), { target: { value: "com.foo.bar" } });
    expect(screen.getByTestId("play-run")).toBeDisabled(); // still needs the SA
    fireEvent.change(screen.getByTestId("play-sa"), { target: { value: '{"client_email":"x"}' } });
    expect(screen.getByTestId("play-run")).toBeEnabled();
    fireEvent.click(screen.getByTestId("play-run"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/apps/a1/audit-play", { packageName: "com.foo.bar", serviceAccount: '{"client_email":"x"}' }));
    expect(await screen.findByTestId("findings-card")).toBeInTheDocument();
    expect(screen.getByText("Short description is thin")).toBeInTheDocument();
    expect(screen.getByText(/grade B/)).toBeInTheDocument();
  });

  it("surfaces the merged Play-specific findings (compliance, vitals, keyless chart rank)", async () => {
    // The audit-play route merges degrade-safe supplements into `findings`:
    // compliance-lint + vitals render as actionable rows; the keyless category
    // chart rank is a measured STATUS fact (context:true) → the "Listing status"
    // strip. This is a web regression guard that all three reach the shared card.
    const result = {
      appId: "com.foo.bar",
      screenshots: { grade: "B", score: 70 },
      findings: [
        { id: "play_title_policy", surface: "title", severity: "warn", impact: "trust", title: "Title uses an emoji", detail: "Play policy discourages it.", fix: "Remove it." },
        { id: "play_crash_rate", surface: "vitals", severity: "critical", impact: "ranking", title: "Crash rate above the bad-behavior threshold", detail: "User-perceived crashes exceed 1.09%.", fix: "Fix top crashes." },
        { id: "play_chart_rank", surface: "chartRank", severity: "good", impact: "ranking", title: "#3 in Weather (Top Free, US) on Google Play", detail: "A measured category-chart position.", fix: "", evidence: "#3 of 100", context: true },
      ],
      summary: { label: "2 fixes available", critical: 1 },
      locks: [],
    };
    const { client } = makeClient({ result });
    renderCard(client);
    await waitFor(() => screen.getByTestId("play-run"));
    fireEvent.change(screen.getByTestId("play-package"), { target: { value: "com.foo.bar" } });
    fireEvent.change(screen.getByTestId("play-sa"), { target: { value: '{"client_email":"x"}' } });
    fireEvent.click(screen.getByTestId("play-run"));
    // compliance + vitals render as actionable finding rows
    expect(await screen.findByTestId("finding-play_title_policy")).toBeInTheDocument();
    expect(screen.getByTestId("finding-play_crash_rate")).toBeInTheDocument();
    // the measured chart rank is a status fact → the "Listing status" strip
    const status = screen.getByTestId("listing-status");
    expect(status).toHaveTextContent("#3 in Weather (Top Free, US) on Google Play");
  });

  it("a saved Play key runs with useStored (no service-account paste box)", async () => {
    const playCred = { id: "p1", appId: "a1", kind: "play", keyId: "svc@x", issuerId: "", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, kekVersion: 1 };
    const { client, post } = makeClient({ credentials: [playCred] });
    renderCard(client);
    await waitFor(() => screen.getByTestId("play-run"));
    expect(screen.queryByTestId("play-sa")).toBeNull();
    fireEvent.change(screen.getByTestId("play-package"), { target: { value: "com.foo.bar" } });
    fireEvent.click(screen.getByTestId("play-run"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/apps/a1/audit-play", { packageName: "com.foo.bar", useStored: true }));
  });
});

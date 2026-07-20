import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { LocalizationCard } from "./LocalizationCard.js";

function makeClient({ draft, approveResult, removeResult }: { draft?: unknown; approveResult?: unknown; removeResult?: unknown } = {}) {
  const post = vi.fn(async (path: string) => {
    if (path.endsWith("/localize")) return draft ?? { locale: "de-DE", copy: { name: "Wetterly", subtitle: "Wetter, ehrlich" }, trimmed: ["subtitle"], validation: { pass: true } };
    if (path.endsWith("/localize/approve")) return approveResult ?? { approved: ["de-DE"] };
    throw new Error("unexpected POST " + path);
  });
  const request = vi.fn(async () => removeResult ?? { approved: [] });
  return { client: { get: vi.fn(), post, request } as unknown as ApiClient, post, request };
}

function renderCard(client: ApiClient, initialLocales: string[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocalizationCard client={client} runId="run1" initialLocales={initialLocales} />
    </QueryClientProvider>,
  );
}

describe("<LocalizationCard />", () => {
  it("seeds the approved list from the run and removes via DELETE", async () => {
    const { client, request } = makeClient({ removeResult: { approved: [] } });
    renderCard(client, ["fr-FR"]);
    expect(screen.getByTestId("loc-fr-FR")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("loc-remove-fr-FR"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/runs/run1/localize/fr-FR", { method: "DELETE" }));
    await waitFor(() => expect(screen.queryByTestId("loc-approved")).toBeNull());
  });

  it("renders the verbatim machine-translation caveat on the draft (honesty)", async () => {
    const CAVEAT = "draft — machine-translated, review before shipping";
    const { client } = makeClient({
      draft: { locale: "de-DE", copy: { name: "Wetterly" }, trimmed: [], validation: { pass: true }, label: CAVEAT },
    });
    renderCard(client);
    fireEvent.change(screen.getByTestId("loc-locale"), { target: { value: "de-DE" } });
    fireEvent.click(screen.getByTestId("loc-generate"));
    const caveat = await screen.findByTestId("loc-caveat");
    // the caveat rides through verbatim — never softened, never omitted.
    expect(caveat).toHaveTextContent(CAVEAT);
  });

  it("generate → shows the draft + trimmed note → approve adds the locale", async () => {
    const { client, post } = makeClient();
    renderCard(client);
    expect(screen.getByTestId("loc-generate")).toBeDisabled(); // needs a locale
    fireEvent.change(screen.getByTestId("loc-locale"), { target: { value: "de-DE" } });
    fireEvent.click(screen.getByTestId("loc-generate"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/runs/run1/localize", { locale: "de-DE" }));
    expect(await screen.findByTestId("loc-draft")).toHaveTextContent("Wetterly");
    expect(screen.getByTestId("loc-trimmed")).toHaveTextContent("Trimmed to fit: subtitle.");
    fireEvent.click(screen.getByTestId("loc-approve"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/runs/run1/localize/approve", { locale: "de-DE", copy: { name: "Wetterly", subtitle: "Wetter, ehrlich" } }),
    );
    await waitFor(() => expect(screen.getByTestId("loc-de-DE")).toBeInTheDocument()); // now approved
    expect(screen.queryByTestId("loc-draft")).toBeNull(); // draft cleared after approve
  });
});

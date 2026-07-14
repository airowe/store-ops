import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "../../src/api/client.js";
import type { PreviewResult } from "../../src/types/api.js";
import Preview from "./preview.js";

/** The real app supplies this from _layout; a standalone mount must too. */
function renderPreview(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Preview client={client} />
    </QueryClientProvider>,
  );
}

const pushed: string[] = [];
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

/** Records every POST and replies with the queued PreviewResult. */
function fakeClient(replies: PreviewResult[], calls: Array<{ path: string; body: unknown }> = []) {
  const post = async <T,>(path: string, body?: unknown) => {
    calls.push({ path, body });
    return (replies.shift() ?? {}) as T;
  };
  return { calls, client: { get: post, post, request: post } as unknown as ApiClient };
}

beforeEach(() => {
  pushed.length = 0;
});

describe("Preview screen — try-before-signup", () => {
  it("audits a query and shows the REAL grade (never an inflated one)", async () => {
    const { client, calls } = fakeClient([
      { preview: { grade: "C", summary: "Weak subtitle.", findings: ["Add a keyword", "Fix shot 1"] } },
    ]);
    renderPreview(client);

    fireEvent.changeText(screen.getByTestId("preview-query"), "Paprika");
    fireEvent.press(screen.getByTestId("preview-search"));

    await waitFor(() => expect(screen.getByTestId("preview-grade")).toBeTruthy());
    // The honest grade the Worker returned — not a marketing-friendly one.
    expect(screen.getByTestId("preview-grade")).toHaveTextContent("C");
    expect(screen.getByText("Weak subtitle.")).toBeTruthy();
    expect(calls[0]).toEqual({ path: "/preview", body: { query: "Paprika" } });
  });

  it("an ambiguous query returns a pick-list; choosing one re-posts its bundle_id", async () => {
    const { client, calls } = fakeClient([
      {
        needsChoice: true,
        candidates: [
          { bundle_id: "com.a.one", name: "App One" },
          { bundle_id: "com.b.two", name: "App Two" },
        ],
      },
      { preview: { grade: "B", summary: "Solid." } },
    ]);
    renderPreview(client);

    fireEvent.changeText(screen.getByTestId("preview-query"), "recipe");
    fireEvent.press(screen.getByTestId("preview-search"));

    await waitFor(() => expect(screen.getByTestId("pcand-com.b.two")).toBeTruthy());
    fireEvent.press(screen.getByTestId("pcand-com.b.two"));

    // The disambiguating re-post is the whole reason this screen needs the
    // bundle_id form of the endpoint — the old stub could not do this.
    await waitFor(() => expect(screen.getByTestId("preview-grade")).toBeTruthy());
    expect(calls[1]).toEqual({ path: "/preview", body: { bundle_id: "com.b.two" } });
  });

  it("gates signup at VALUE — the sign-in CTA appears only after a result", async () => {
    const { client } = fakeClient([{ preview: { grade: "A", summary: "Strong." } }]);
    renderPreview(client);

    // Cold open: no login wall. The visitor can audit before being asked to sign up.
    expect(screen.queryByTestId("preview-signin")).toBeNull();

    fireEvent.changeText(screen.getByTestId("preview-query"), "Paprika");
    fireEvent.press(screen.getByTestId("preview-search"));

    await waitFor(() => expect(screen.getByTestId("preview-signin")).toBeTruthy());
    fireEvent.press(screen.getByTestId("preview-signin"));
    expect(pushed).toContain("/(public)/login");
  });

  it("surfaces an honest note when nothing matches", async () => {
    const { client } = fakeClient([{ needsChoice: true, candidates: [] }]);
    renderPreview(client);

    fireEvent.changeText(screen.getByTestId("preview-query"), "zzzz");
    fireEvent.press(screen.getByTestId("preview-search"));

    await waitFor(() => expect(screen.getByTestId("preview-note")).toBeTruthy());
    expect(screen.queryByTestId("preview-grade")).toBeNull();
  });
});

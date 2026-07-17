import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "../../src/api/client.js";
import type { PreviewResult } from "../../src/types/api.js";
import Preview from "./preview.js";
import { palette } from "../../src/theme/index.js";

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
      { preview: { appName: "Paprika", auditGrade: "C", leadKeyword: "recipes", leadRank: 7,
        keywordsChecked: 12, inTop10: 2, sample: [{ keyword: "recipes", rank: 7 }, { keyword: "pantry", rank: null }] } },
    ]);
    renderPreview(client);

    fireEvent.changeText(screen.getByTestId("preview-query"), "Paprika");
    fireEvent.press(screen.getByTestId("preview-search"));

    await waitFor(() => expect(screen.getByTestId("preview-grade")).toBeTruthy());
    // The honest grade the Worker returned — not a marketing-friendly one.
    expect(screen.getByTestId("preview-grade")).toHaveTextContent("C");

    // Grade-pill parity with the web .grade: the grade text sits inside a pill
    // View with the signal-glow background and rounded corners.
    const pill = screen.getByTestId("preview-grade-pill");
    const flatPill = Object.assign({}, ...[].concat(pill.props.style as never));
    expect(flatPill.borderRadius).toBe(8);
    expect(flatPill.backgroundColor).toBe(palette.signalGlow);

    // The teaser must actually SHOW the value, not just the signup CTA. These
    // field names are the wire contract (AppPreview); reading a field the server
    // never sends renders an empty card that still type-checks — which is exactly
    // the bug this pins.
    // Regex, not a bare string — RN's toHaveTextContent matches the flattened
    // text exactly, so a substring assertion needs an explicit pattern.
    expect(screen.getByTestId("preview-summary")).toHaveTextContent(/#7/);
    expect(screen.getByTestId("preview-summary")).toHaveTextContent(/recipes/);
    expect(screen.getByTestId("preview-sample")).toBeTruthy();
    // An unmeasured rank is an em-dash, never a fabricated number.
    expect(screen.getByText("—")).toBeTruthy();
    // Grid-line parity with the web's .move-row: a hairline separates rows,
    // and the LAST row drops it (mirrors .move-row:last-child { border-bottom: 0 }).
    const firstRow = screen.getByTestId("preview-row-recipes"); // non-last
    const lastRow = screen.getByTestId("preview-row-pantry");   // last of 2
    const flat = (s: unknown) => Object.assign({}, ...[].concat(s as never));
    expect(flat(firstRow.props.style).borderBottomWidth).toBe(1);
    expect(flat(lastRow.props.style).borderBottomWidth).toBe(0);
    // Option C: a top-10 progress ring reflects the real counts.
    expect(screen.getByTestId("preview-topten-ring")).toBeTruthy();
    // A measured row shows a rank bar; the unmeasured row shows NO bar (honesty).
    const measuredRow = screen.getByTestId("preview-row-recipes");
    const unmeasuredRow = screen.getByTestId("preview-row-pantry");
    expect(within(measuredRow).queryByTestId("rank-bar")).toBeTruthy();
    expect(within(unmeasuredRow).queryByTestId("rank-bar")).toBeNull();
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
      { preview: { appName: "App Two", auditGrade: "B", leadKeyword: "two", leadRank: 3,
        keywordsChecked: 5, inTop10: 1, sample: [] } },
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
    const { client } = fakeClient([{ preview: { appName: "Paprika", auditGrade: "A", leadKeyword: "recipes", leadRank: 1,
      keywordsChecked: 9, inTop10: 4, sample: [] } }]);
    renderPreview(client);

    // Cold open: no login wall. The visitor can audit before being asked to sign up.
    expect(screen.queryByTestId("preview-signin")).toBeNull();

    fireEvent.changeText(screen.getByTestId("preview-query"), "Paprika");
    fireEvent.press(screen.getByTestId("preview-search"));

    await waitFor(() => expect(screen.getByTestId("preview-signin")).toBeTruthy());
    fireEvent.press(screen.getByTestId("preview-signin"));
    expect(pushed).toContain("/(public)/login");
  });

  it("a no-match surfaces the server's message instead of failing silently", async () => {
    // The Worker answers an unknown query with HTTP 404 + { error }, so the API
    // client THROWS and onSuccess never runs. Without an onError the failure path
    // was silent — a typo produced no feedback at all.
    const client = {
      get: async () => ({}),
      post: async () => {
        throw new Error('no app found for "zzzz"');
      },
      request: async () => ({}),
    } as unknown as ApiClient;
    renderPreview(client);

    fireEvent.changeText(screen.getByTestId("preview-query"), "zzzz");
    fireEvent.press(screen.getByTestId("preview-search"));

    await waitFor(() => expect(screen.getByTestId("preview-note")).toBeTruthy());
    expect(screen.getByTestId("preview-note")).toHaveTextContent(/no app found/);
    expect(screen.queryByTestId("preview-grade")).toBeNull();
  });
});

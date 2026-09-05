import React from "react";
import { useColorScheme } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Proof from "./proof.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
const mockColorScheme = useColorScheme as unknown as jest.Mock;
jest.mock("expo-router", () => ({ Stack: Object.assign(() => null, { Screen: () => null }) }));

/** Proof builds its own token-free client on globalThis.fetch. */
function fakeFetch(body: unknown) {
  return jest.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
}

function renderProof() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Proof />
    </QueryClientProvider>,
  );
}

describe("Proof screen", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => mockColorScheme.mockReturnValue("dark"));
  afterEach(() => { globalThis.fetch = realFetch; });

  it("shows the measured receipts, with the eyebrow and the numbers the API returned", async () => {
    globalThis.fetch = fakeFetch({ appsWithWins: 1, totalWins: 1, bestImprovement: 4, medianImprovement: 4 }) as unknown as typeof fetch;
    renderProof();
    expect(await screen.findByText("The receipts")).toBeTruthy();
    expect(screen.getByText(/proof, not promises/i)).toBeTruthy();
    expect(screen.getAllByText("4 places")).toHaveLength(2);
    expect(screen.getAllByText("1")).toHaveLength(2);
  });

  it("says so when there are no wins — never invents a number", async () => {
    globalThis.fetch = fakeFetch({ appsWithWins: 0, totalWins: 0, bestImprovement: 0, medianImprovement: 0 }) as unknown as typeof fetch;
    renderProof();
    expect(await screen.findByText(/No measured wins to show yet/)).toBeTruthy();
    expect(screen.queryByText("0 places")).toBeNull();
  });
});

import { headerOptions } from "./proof.js";
import { palette as darkPalette } from "../../src/theme/tokens.js";
import { typeface } from "../../src/theme/fonts.js";

it("themes the native header to the palette — never the default white bar over a dark screen", () => {
  const o = headerOptions(darkPalette);
  expect(o.headerShown).toBe(true);
  expect(o.headerStyle.backgroundColor).toBe(darkPalette.bg);
  expect(o.headerTintColor).toBe(darkPalette.ink);
  expect(o.headerTitleStyle.fontFamily).toBe(typeface.title);
  expect(o.headerShadowVisible).toBe(false);
});

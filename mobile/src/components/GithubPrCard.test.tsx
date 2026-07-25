/**
 * GithubPrCard (#8) — the honesty invariants:
 *   • absent unless the run is approved AND a repo is connected (never a dead
 *     button that can't work);
 *   • a successful PR surfaces the real URL (opened via Linking), the number,
 *     and the branch — the user reviews + merges it themselves;
 *   • a refusal is shown verbatim, never swallowed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import type { ApiClient } from "../api/client.js";
import type { GithubPrResult } from "../types/api.js";
import { GithubPrCard } from "./GithubPrCard.js";
import { useColorScheme } from "react-native";
import { ThemeProvider } from "../theme/index.js";
import { lightPalette, palette } from "../theme/tokens.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
const mockColorScheme = useColorScheme as unknown as jest.Mock;

/** Flatten RN's style prop (array | object) into one resolved object. */
function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  const flatten = (s: unknown): Record<string, unknown> =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : ((s ?? {}) as Record<string, unknown>);
  return flatten(node.props.style);
}

/** A client whose POST throws — the only path to the card's error line. */
function errClient(message: string): ApiClient {
  return {
    get: async () => ({}),
    post: async () => {
      throw new Error(message);
    },
    request: async () => ({}),
  } as unknown as ApiClient;
}

function fakeClient(result: GithubPrResult): ApiClient {
  return {
    get: async () => ({}),
    post: async () => result,
    request: async () => ({}),
  } as unknown as ApiClient;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockColorScheme.mockReturnValue("dark"); // default scheme for every other test in this file
});

const OK: GithubPrResult = { ok: true, url: "https://github.com/acme/app/pull/7", number: 7, branch: "shipaso/metadata" };

describe("GithubPrCard", () => {
  it("renders nothing until the run is approved", () => {
    const { toJSON } = render(
      <GithubPrCard client={fakeClient(OK)} runId="r1" approved={false} connected={true} repo="acme/app" />,
    );
    expect(toJSON()).toBeNull();
  });

  it("renders nothing when no repo is connected (never a dead button)", () => {
    const { toJSON } = render(
      <GithubPrCard client={fakeClient(OK)} runId="r1" approved={true} connected={false} repo={null} />,
    );
    expect(toJSON()).toBeNull();
  });

  it("opens a PR and surfaces the real URL, number, and branch — opened via Linking", async () => {
    render(<GithubPrCard client={fakeClient(OK)} runId="r1" approved={true} connected={true} repo="acme/app" />);
    fireEvent.press(screen.getByTestId("github-pr"));
    await waitFor(() => expect(screen.getByTestId("github-pr-result")).toHaveTextContent(/#7/));
    expect(screen.getByTestId("github-pr-result")).toHaveTextContent(/shipaso\/metadata/);
    fireEvent.press(screen.getByTestId("github-pr-open"));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(OK.url));
  });

  it("shows GitHub's refusal verbatim, never swallowed", async () => {
    const refusal: GithubPrResult = { ok: false, reason: "the connected repo has no fastlane/metadata directory" };
    render(<GithubPrCard client={fakeClient(refusal)} runId="r1" approved={true} connected={true} repo="acme/app" />);
    fireEvent.press(screen.getByTestId("github-pr"));
    await waitFor(() =>
      expect(screen.getByTestId("github-pr-result")).toHaveTextContent(/no fastlane\/metadata directory/),
    );
    expect(screen.queryByTestId("github-pr-open")).toBeNull();
  });

  it("paints the error line from the LIVE palette (light provider → light bad)", async () => {
    mockColorScheme.mockReturnValue("light");
    render(
      <ThemeProvider>
        <GithubPrCard client={errClient("boom")} runId="r1" approved={true} connected={true} repo="acme/app" />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByTestId("github-pr"));
    await waitFor(() => expect(screen.getByTestId("github-pr-error")).toBeTruthy());
    expect(flatStyle(screen.getByTestId("github-pr-error")).color).toBe(lightPalette.bad);
    expect(lightPalette.bad).not.toBe(palette.bad);
  });
});

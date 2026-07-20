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

function fakeClient(result: GithubPrResult): ApiClient {
  return {
    get: async () => ({}),
    post: async () => result,
    request: async () => ({}),
  } as unknown as ApiClient;
}

beforeEach(() => jest.clearAllMocks());

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
});

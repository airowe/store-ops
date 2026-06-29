import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import type { ApiClient } from "../api/client.js";
import type { AppCandidate, ResolveResult } from "../types/api.js";
import { ConnectPicker } from "./ConnectPicker.js";

function cand(name: string, bundleId: string): AppCandidate {
  return { name, bundleId, publisher: "Acme", genres: [], trackId: null, iconUrl: null };
}

/** A fake client whose /resolve returns queued results in order. */
function fakeClient(queue: ResolveResult[]): ApiClient {
  let i = 0;
  const client = {
    async post<T>() {
      return (queue[Math.min(i++, queue.length - 1)] as unknown) as T;
    },
    async get<T>() {
      return undefined as T;
    },
    async request<T>() {
      return undefined as T;
    },
  };
  return client as unknown as ApiClient;
}

describe("ConnectPicker", () => {
  it("an exact resolve connects immediately", async () => {
    const onConnect = jest.fn();
    const client = fakeClient([
      { kind: "resolved", query: { kind: "bundle-id", id: "com.a" }, candidates: [cand("App A", "com.a")], offset: 0, hasMore: false },
    ]);
    render(<ConnectPicker client={client} onConnect={onConnect} />);

    fireEvent.changeText(screen.getByTestId("connect-input"), "com.a");
    fireEvent.press(screen.getByText("Search"));

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ bundleId: "com.a" })));
  });

  it("candidates render and a pick fires onConnect", async () => {
    const onConnect = jest.fn();
    const client = fakeClient([
      {
        kind: "candidates",
        query: { kind: "name", term: "weather" },
        candidates: [cand("Weather One", "com.w1"), cand("Weather Two", "com.w2")],
        offset: 0,
        hasMore: false,
      },
    ]);
    render(<ConnectPicker client={client} onConnect={onConnect} />);

    fireEvent.changeText(screen.getByTestId("connect-input"), "weather");
    fireEvent.press(screen.getByText("Search"));

    await waitFor(() => expect(screen.getByText("Weather One")).toBeTruthy());
    expect(screen.getByText("Weather Two")).toBeTruthy();
    expect(screen.getByText("End of results")).toBeTruthy();

    fireEvent.press(screen.getByTestId("candidate-com.w2"));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ bundleId: "com.w2" }));
  });

  it("not-found shows an honest nudge, no candidates", async () => {
    const onConnect = jest.fn();
    const client = fakeClient([
      { kind: "not-found", query: { kind: "name", term: "zzzz" }, candidates: [], offset: 0, hasMore: false },
    ]);
    render(<ConnectPicker client={client} onConnect={onConnect} />);

    fireEvent.changeText(screen.getByTestId("connect-input"), "zzzz");
    fireEvent.press(screen.getByText("Search"));

    await waitFor(() => expect(screen.getByText(/No connectable app matched/)).toBeTruthy());
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("paging appends the next page and hides 'show more' at the end", async () => {
    const onConnect = jest.fn();
    const client = fakeClient([
      {
        kind: "candidates",
        query: { kind: "name", term: "w" },
        candidates: [cand("W1", "com.w1")],
        offset: 0,
        hasMore: true,
      },
      {
        kind: "candidates",
        query: { kind: "name", term: "w" },
        candidates: [cand("W2", "com.w2")],
        offset: 1,
        hasMore: false,
      },
    ]);
    render(<ConnectPicker client={client} onConnect={onConnect} />);

    fireEvent.changeText(screen.getByTestId("connect-input"), "w");
    fireEvent.press(screen.getByText("Search"));
    await waitFor(() => expect(screen.getByText("W1")).toBeTruthy());
    expect(screen.getByTestId("show-more")).toBeTruthy();

    fireEvent.press(screen.getByTestId("show-more"));
    await waitFor(() => expect(screen.getByText("W2")).toBeTruthy());
    expect(screen.getByText("W1")).toBeTruthy(); // appended, not replaced
    expect(screen.queryByTestId("show-more")).toBeNull();
    expect(screen.getByText("End of results")).toBeTruthy();
  });
});

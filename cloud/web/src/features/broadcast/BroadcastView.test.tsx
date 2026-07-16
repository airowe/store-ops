import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { BroadcastView } from "./BroadcastView.js";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function client(over: Record<string, unknown> = {}): ApiClient {
  return {
    get: vi.fn(async (_path: string) => ({ active: 5, unsubscribed: 1 })),
    post: vi.fn(async (_path: string) => ({ ok: true })),
    request: vi.fn(),
    ...over,
  } as unknown as ApiClient;
}

describe("<BroadcastView />", () => {
  it("gates on the owner token: counts load only after a token is entered", async () => {
    const get = vi.fn(async (_path: string) => ({ active: 5, unsubscribed: 1 }));
    wrap(<BroadcastView client={client({ get })} />);
    fireEvent.change(screen.getByTestId("bc-token"), { target: { value: "tok" } });
    fireEvent.click(screen.getByTestId("bc-load"));
    await waitFor(() => expect(screen.getByTestId("bc-count")).toHaveTextContent("5"));
    expect(get).toHaveBeenCalledWith("/broadcast/subscribers", { "x-broadcast-token": "tok" });
  });

  it("shows a live preview of the markdown", () => {
    wrap(<BroadcastView client={client()} />);
    fireEvent.change(screen.getByTestId("bc-markdown"), { target: { value: "# Hello" } });
    expect(screen.getByTestId("bc-preview").innerHTML).toContain("<h1>Hello</h1>");
  });

  it("disables the real send until the confirm box is checked", () => {
    wrap(<BroadcastView client={client()} />);
    fireEvent.change(screen.getByTestId("bc-token"), { target: { value: "tok" } });
    fireEvent.change(screen.getByTestId("bc-subject"), { target: { value: "Launch" } });
    fireEvent.change(screen.getByTestId("bc-markdown"), { target: { value: "# Hi" } });
    expect(screen.getByTestId("bc-send")).toBeDisabled();
    fireEvent.click(screen.getByTestId("bc-confirm"));
    expect(screen.getByTestId("bc-send")).not.toBeDisabled();
  });
});

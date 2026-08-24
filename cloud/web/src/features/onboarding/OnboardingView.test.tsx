import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@shipaso/api";
import { OnboardingView } from "./OnboardingView.js";
import { emptyState, type OnboardingState } from "./onboardingModel.js";

/** A fully-answered fixture. Test data belongs in the test, never in the model. */
const answered = (): OnboardingState => ({
  stepIndex: 2,
  store: "app-store",
  app: { name: "Acme Fitness" },
  rivals: ["MyFitnessPal"],
  suggested: ["Lifesum"],
});

function apiClient(post: any = vi.fn(async () => ({ candidates: [] }))) {
  return { get: vi.fn(async () => ({ competitors: [] })), post, request: vi.fn() } as unknown as ApiClient;
}

function renderOnb(props: Partial<React.ComponentProps<typeof OnboardingView>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OnboardingView
        client={apiClient()}
        appId={null}
        onAppConnected={vi.fn()}
        onDone={vi.fn()}
        onSkip={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("<OnboardingView /> — guided setup stepper (1a)", () => {
  it("offers App Store as the only selectable store, Play visibly unavailable", () => {
    renderOnb();
    expect(screen.getByTestId("onb-store-app-store")).toBeEnabled();
    const play = screen.getByTestId("onb-store-google-play");
    expect(play).toBeDisabled();
    expect(play).toHaveTextContent(/coming soon/i);
  });

  it("choosing a store opens the connect step", () => {
    renderOnb();
    fireEvent.click(screen.getByTestId("onb-store-app-store"));
    expect(screen.getByTestId("connect-input")).toBeInTheDocument();
  });

  it("connecting an app records it and hands the id up", async () => {
    const onAppConnected = vi.fn();
    const post = vi.fn(async (path: string, body: any) => {
      if (path === "/resolve") return { candidates: [{ bundle_id: "com.x.y", name: "XY" }] };
      if (path === "/apps") return { id: "new1", name: body.name, bundleId: body.bundle_id };
      return { competitors: [] };
    });
    renderOnb({ client: apiClient(post), onAppConnected });

    fireEvent.click(screen.getByTestId("onb-store-app-store"));
    fireEvent.change(screen.getByTestId("connect-input"), { target: { value: "xy" } });
    fireEvent.click(screen.getByTestId("connect-search"));
    await waitFor(() => screen.getByTestId("cand-com.x.y"));
    fireEvent.click(screen.getByTestId("cand-com.x.y"));

    await waitFor(() => expect(onAppConnected).toHaveBeenCalledWith("new1"));
    await waitFor(() => expect(screen.getByTestId("onb-answer-app")).toHaveTextContent("XY"));
  });

  // Step 3 over the real endpoints. The rivals a user confirms here must feed
  // their runs; the old implementation kept chips in local state and threw them
  // away on Continue.
  const atRivals = { stepIndex: 2, store: "app-store" as const, app: { name: "Acme" }, rivals: [], suggested: [] };

  function rivalsClient(over: { get?: any; post?: any; request?: any } = {}) {
    return {
      get: over.get ?? vi.fn(async () => ({ competitors: [] })),
      post: over.post ?? vi.fn(async () => ({ competitors: [] })),
      request: over.request ?? vi.fn(async () => ({ competitors: [] })),
    } as unknown as ApiClient;
  }

  it("seeds rivals from real discovery and confirms through the API", async () => {
    const suggested = { key: "k1", name: "Rival One", source: "itunes", status: "suggested" };
    const post = vi.fn(async (path: string) => {
      if (path.endsWith("/competitors/discover")) return { competitors: [suggested], discovered: 1 };
      if (path.endsWith("/competitors/k1/confirm")) return { competitors: [{ ...suggested, status: "confirmed" }] };
      return { competitors: [] };
    });
    renderOnb({ initial: atRivals, appId: "app-1", client: rivalsClient({ post }) });

    fireEvent.click(await screen.findByTestId("onb-suggest-k1"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/app-1/competitors/k1/confirm"),
    );
    await waitFor(() => expect(screen.getByTestId("onb-rival-k1")).toBeInTheDocument());
  });

  it("says there are no suggestions yet rather than inventing seeds", async () => {
    const post = vi.fn(async () => ({
      competitors: [],
      discovered: 0,
      note: "No tracked keywords yet — add a rival by name.",
    }));
    renderOnb({ initial: atRivals, appId: "app-1", client: rivalsClient({ post }) });

    expect(await screen.findByTestId("onb-rivals-empty")).toHaveTextContent(
      "No tracked keywords yet — add a rival by name.",
    );
    expect(screen.queryByTestId(/^onb-suggest-/)).toBeNull();
  });

  it("adds a typed rival through the API", async () => {
    const post = vi.fn(async (path: string) => {
      if (path.endsWith("/competitors/discover")) return { competitors: [] };
      return { competitors: [{ key: "k9", name: "Typed", source: "manual", status: "confirmed" }] };
    });
    renderOnb({ initial: atRivals, appId: "app-1", client: rivalsClient({ post }) });

    await screen.findByTestId("onb-rival-input");
    fireEvent.change(screen.getByTestId("onb-rival-input"), { target: { value: "Typed" } });
    fireEvent.click(screen.getByTestId("onb-rival-add"));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/apps/app-1/competitors", { name: "Typed" }),
    );
  });

  it("claims no audit grade for a freshly connected app", async () => {
    renderOnb({ initial: { stepIndex: 2, store: "app-store", app: { name: "Acme" }, rivals: [], suggested: [] } });
    expect(screen.getByTestId("onb-answer-app")).toHaveTextContent("Acme");
    expect(screen.queryByText(/Audited:/)).toBeNull();
  });

  it("keeps prior answers visible: the store and the connected app", () => {
    renderOnb({onDone: vi.fn(), onSkip: vi.fn(), initial: answered()});
    expect(screen.getByTestId("onb-answer-store")).toHaveTextContent("App Store");
    expect(screen.getByTestId("onb-answer-app")).toHaveTextContent("Acme Fitness");
  });

  // The negative control. The previous version of the test above asserted
  // toHaveTextContent("A−") under a comment reading "never faked" — while
  // pinning a hardcoded fake in place. A default that invents a plausible app
  // and grade is indistinguishable, to the user, from a measured one.
  it("invents no app and no grade when nothing has been answered", () => {
    renderOnb({onDone: vi.fn(), onSkip: vi.fn()});
    expect(screen.queryByText(/Cal AI/)).toBeNull();
    expect(screen.queryByText(/A−/)).toBeNull();
    expect(screen.queryByText(/Audited:/)).toBeNull();
    expect(screen.queryByTestId("onb-answer-app")).toBeNull();
    expect(screen.queryByTestId("onb-answer-store")).toBeNull();
  });

  it("renders a 4-segment progress bar with 3 filled at step 3", () => {
    renderOnb({onDone: vi.fn(), onSkip: vi.fn(), initial: answered()});
    const segs = screen.getAllByTestId(/^onb-seg-/);
    expect(segs).toHaveLength(4);
    expect(segs.filter((s) => s.dataset.filled === "true")).toHaveLength(3);
  });



  it("Continue → calls onDone with the collected answers", () => {
    const onDone = vi.fn();
    renderOnb({onDone: onDone, onSkip: vi.fn(), initial: answered()});
    fireEvent.click(screen.getByTestId("onb-continue"));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ store: "app-store" }));
  });

  it("both the header exit and the footer skip call onSkip", () => {
    const onSkip = vi.fn();
    renderOnb({onDone: vi.fn(), onSkip: onSkip, initial: answered()});
    fireEvent.click(screen.getByTestId("onb-skip-setup"));
    fireEvent.click(screen.getByTestId("onb-skip-step"));
    expect(onSkip).toHaveBeenCalledTimes(2);
  });

  it("preserves the honest 'nothing ships on its own' guarantee", () => {
    renderOnb({onDone: vi.fn(), onSkip: vi.fn(), initial: answered()});
    expect(screen.getByText(/nothing ships on its own/i)).toBeInTheDocument();
  });

  it("shows the dimmed, optional upcoming step (connect a key)", () => {
    renderOnb({onDone: vi.fn(), onSkip: vi.fn(), initial: answered()});
    const upcoming = screen.getByTestId("onb-upcoming");
    expect(upcoming).toHaveTextContent(/connect a key/i);
    expect(upcoming).toHaveTextContent(/optional/i);
  });
});

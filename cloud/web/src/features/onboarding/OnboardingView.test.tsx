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

  it("asks the active question and lets a suggestion be confirmed as a rival", () => {
    renderOnb({onDone: vi.fn(), onSkip: vi.fn(), initial: answered()});
    expect(screen.getByTestId("onb-question")).toHaveTextContent("Who are your top rivals?");
    // Lifesum starts as a suggestion, not a confirmed rival
    expect(screen.queryByTestId("onb-rival-Lifesum")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("onb-suggest-Lifesum"));
    expect(screen.getByTestId("onb-rival-Lifesum")).toBeInTheDocument();
    // and it leaves the suggestion list
    expect(screen.queryByTestId("onb-suggest-Lifesum")).not.toBeInTheDocument();
  });

  it("removes a confirmed rival when its × is clicked", () => {
    renderOnb({onDone: vi.fn(), onSkip: vi.fn(), initial: answered()});
    expect(screen.getByTestId("onb-rival-MyFitnessPal")).toBeInTheDocument();
    const chip = screen.getByTestId("onb-rival-MyFitnessPal");
    fireEvent.click(within(chip).getByRole("button", { name: /remove/i }));
    expect(screen.queryByTestId("onb-rival-MyFitnessPal")).not.toBeInTheDocument();
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

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { OnboardingView } from "./OnboardingView.js";
import { sampleState } from "./onboardingModel.js";

describe("<OnboardingView /> — guided setup stepper (1a)", () => {
  it("keeps prior answers visible: the store and the audited app with its grade", () => {
    render(<OnboardingView onDone={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByTestId("onb-answer-store")).toHaveTextContent("App Store");
    const app = screen.getByTestId("onb-answer-app");
    expect(app).toHaveTextContent("Cal AI");
    // the honest live-audit grade rides along as a pill — never faked
    expect(app).toHaveTextContent("A−");
  });

  it("renders a 4-segment progress bar with 3 filled at step 3", () => {
    render(<OnboardingView onDone={vi.fn()} onSkip={vi.fn()} />);
    const segs = screen.getAllByTestId(/^onb-seg-/);
    expect(segs).toHaveLength(4);
    expect(segs.filter((s) => s.dataset.filled === "true")).toHaveLength(3);
  });

  it("asks the active question and lets a suggestion be confirmed as a rival", () => {
    render(<OnboardingView onDone={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByTestId("onb-question")).toHaveTextContent("Who are your top rivals?");
    // Lifesum starts as a suggestion, not a confirmed rival
    expect(screen.queryByTestId("onb-rival-Lifesum")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("onb-suggest-Lifesum"));
    expect(screen.getByTestId("onb-rival-Lifesum")).toBeInTheDocument();
    // and it leaves the suggestion list
    expect(screen.queryByTestId("onb-suggest-Lifesum")).not.toBeInTheDocument();
  });

  it("removes a confirmed rival when its × is clicked", () => {
    render(<OnboardingView onDone={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByTestId("onb-rival-MyFitnessPal")).toBeInTheDocument();
    const chip = screen.getByTestId("onb-rival-MyFitnessPal");
    fireEvent.click(within(chip).getByRole("button", { name: /remove/i }));
    expect(screen.queryByTestId("onb-rival-MyFitnessPal")).not.toBeInTheDocument();
  });

  it("Continue → calls onDone with the collected answers", () => {
    const onDone = vi.fn();
    render(<OnboardingView onDone={onDone} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByTestId("onb-continue"));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ store: "app-store" }));
  });

  it("both the header exit and the footer skip call onSkip", () => {
    const onSkip = vi.fn();
    render(<OnboardingView onDone={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByTestId("onb-skip-setup"));
    fireEvent.click(screen.getByTestId("onb-skip-step"));
    expect(onSkip).toHaveBeenCalledTimes(2);
  });

  it("preserves the honest 'nothing ships on its own' guarantee", () => {
    render(<OnboardingView onDone={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText(/nothing ships on its own/i)).toBeInTheDocument();
  });

  it("shows the dimmed, optional upcoming step (connect a key)", () => {
    render(<OnboardingView onDone={vi.fn()} onSkip={vi.fn()} initial={sampleState()} />);
    const upcoming = screen.getByTestId("onb-upcoming");
    expect(upcoming).toHaveTextContent(/connect a key/i);
    expect(upcoming).toHaveTextContent(/optional/i);
  });
});

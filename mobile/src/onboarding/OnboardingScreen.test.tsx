import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { OnboardingScreen } from "./OnboardingScreen.js";
import type { OnboardingState } from "./model.js";

const midFlow: OnboardingState = {
  stepIndex: 2,
  store: "app-store",
  app: { name: "Cal AI", grade: "A−" },
  rivals: ["MyFitnessPal"],
  suggested: ["Lifesum", "Yazio"],
};

describe("<OnboardingScreen />", () => {
  it("starts on the store step with a 4-segment bar, one filled", () => {
    render(<OnboardingScreen onDone={() => {}} onSkip={() => {}} />);
    expect(screen.getByTestId("onb-question")).toHaveTextContent("Which store should we start with?");
    expect(screen.getByTestId("onb-step-count")).toHaveTextContent("1 / 4");
    expect(screen.getByTestId("onb-seg-store").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("onb-seg-app").props.accessibilityState.selected).toBe(false);
  });

  it("choosing a store advances to the next step", () => {
    render(<OnboardingScreen onDone={() => {}} onSkip={() => {}} />);
    fireEvent.press(screen.getByTestId("onb-store-google-play"));
    expect(screen.getByTestId("onb-step-count")).toHaveTextContent("2 / 4");
  });

  it("keeps prior answers pinned as chips on a later step", () => {
    render(<OnboardingScreen onDone={() => {}} onSkip={() => {}} initial={midFlow} />);
    expect(screen.getByTestId("onb-answer-App Store")).toBeTruthy();
    expect(screen.getByTestId("onb-answer-Cal AI · A−")).toBeTruthy();
  });

  it("confirms a suggested rival and drops it from the suggestions", () => {
    render(<OnboardingScreen onDone={() => {}} onSkip={() => {}} initial={midFlow} />);
    expect(screen.queryByTestId("onb-rival-Lifesum")).toBeNull();
    fireEvent.press(screen.getByTestId("onb-suggest-Lifesum"));
    expect(screen.getByTestId("onb-rival-Lifesum")).toBeTruthy();
    expect(screen.queryByTestId("onb-suggest-Lifesum")).toBeNull();
  });

  it("removes a confirmed rival when its chip is pressed", () => {
    render(<OnboardingScreen onDone={() => {}} onSkip={() => {}} initial={midFlow} />);
    fireEvent.press(screen.getByTestId("onb-rival-MyFitnessPal"));
    expect(screen.queryByTestId("onb-rival-MyFitnessPal")).toBeNull();
  });

  it("Continue hands back the collected answers", () => {
    const onDone = jest.fn();
    render(<OnboardingScreen onDone={onDone} onSkip={() => {}} initial={midFlow} />);
    fireEvent.press(screen.getByTestId("onb-continue"));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ store: "app-store" }));
  });

  it("Skip bails out from any step", () => {
    const onSkip = jest.fn();
    render(<OnboardingScreen onDone={() => {}} onSkip={onSkip} />);
    fireEvent.press(screen.getByTestId("onb-skip"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("keeps the honest promise on every step", () => {
    render(<OnboardingScreen onDone={() => {}} onSkip={() => {}} />);
    expect(screen.getByTestId("onb-promise")).toHaveTextContent(/nothing ships on its own/i);
  });

  it("offers no Continue on the store step — the choice itself advances", () => {
    render(<OnboardingScreen onDone={() => {}} onSkip={() => {}} />);
    expect(screen.queryByTestId("onb-continue")).toBeNull();
  });
});

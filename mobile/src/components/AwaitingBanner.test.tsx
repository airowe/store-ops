import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { AwaitingBanner } from "./AwaitingBanner.js";

describe("<AwaitingBanner />", () => {
  it("renders nothing at zero — no '0 runs ready', which would imply work that isn't there", () => {
    render(<AwaitingBanner count={0} onReview={() => {}} />);
    expect(screen.queryByTestId("awaiting-banner")).toBeNull();
  });

  it("uses the singular for exactly one waiting run", () => {
    render(<AwaitingBanner count={1} onReview={() => {}} />);
    expect(screen.getByTestId("awaiting-banner")).toHaveTextContent(/1 run ready to review/);
  });

  it("uses the plural beyond one", () => {
    render(<AwaitingBanner count={3} onReview={() => {}} />);
    expect(screen.getByTestId("awaiting-banner")).toHaveTextContent(/3 runs ready to review/);
  });

  it("keeps the honest never-ships note", () => {
    render(<AwaitingBanner count={2} onReview={() => {}} />);
    expect(screen.getByTestId("awaiting-banner")).toHaveTextContent(/never ships anything/i);
  });

  it("calls back when reviewed", () => {
    const onReview = jest.fn();
    render(<AwaitingBanner count={2} onReview={onReview} />);
    fireEvent.press(screen.getByTestId("awaiting-banner"));
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
